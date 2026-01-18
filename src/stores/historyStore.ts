import { create } from 'zustand';
import type { Project } from '../types';
import type {
  HistoryEntry,
  HistorySnapshot,
  HistoryOperationContext,
  HistoryConfig,
  DeletedAssetInfo,
} from '../types/history';
import { updateProject } from '../services/tauri';
import {
  softDeleteAsset,
  restoreAsset,
  scheduleAssetCleanup,
  clearPendingDeletions,
  setCurrentProjectId,
} from '../services/assetRetention';

// Lazy getter to avoid circular dependency - set by projectStore on init
let getProjectStore: (() => {
  project: Project | null;
  setProjectSilent: (project: Project) => void;
}) | null = null;

export function setProjectStoreGetter(getter: typeof getProjectStore) {
  getProjectStore = getter;
}

interface HistoryState {
  // State
  entries: HistoryEntry[];
  currentIndex: number;
  isUndoRedoInProgress: boolean;
  config: HistoryConfig;
  deletedAssets: Map<string, DeletedAssetInfo>;

  // Pending state for debouncing transforms
  pendingSnapshot: HistorySnapshot | null;
  pendingContext: HistoryOperationContext | null;

  // Actions
  pushState: (project: Project, context: HistoryOperationContext) => void;
  commitPending: () => void;
  undo: () => void;
  redo: () => void;
  clear: () => void;
  setConfig: (config: Partial<HistoryConfig>) => void;

  // Asset management
  trackDeletedAsset: (info: DeletedAssetInfo) => void;
  restoreDeletedAsset: (assetPath: string) => void;

  // Internal helpers
  _setUndoRedoInProgress: (value: boolean) => void;
}

const DEFAULT_CONFIG: HistoryConfig = {
  maxEntries: 50,
  debounceMs: 300,
  hotTierSize: 5,
};

// Debounce timeout reference (module level to persist across renders)
let debounceTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Generate human-readable label for history entry
 */
function generateLabel(context: HistoryOperationContext): string {
  const actionLabels: Record<string, string> = {
    add: 'Add',
    update: 'Update',
    delete: 'Delete',
    move: 'Move',
    resize: 'Resize',
    rotate: 'Rotate',
    crop: 'Crop',
    flip: 'Flip',
    reorder: 'Reorder',
    duplicate: 'Duplicate',
    paste: 'Paste',
    apply: 'Apply',
  };

  const sourceLabels: Record<string, string> = {
    element: 'element',
    slide: 'slide',
    media: 'media',
    transform: 'element',
    crop: 'crop',
    reorder: 'layers',
    paste: 'element',
    template: 'template',
  };

  const action = actionLabels[context.actionType] || context.actionType;
  const source = sourceLabels[context.source] || context.source;

  return `${action} ${source}`;
}

/**
 * Create a lightweight snapshot from a project
 * Only includes JSON-serializable data, NO image instances
 */
function createSnapshot(project: Project): HistorySnapshot {
  return {
    elements: JSON.parse(JSON.stringify(project.elements)),
    slides: JSON.parse(JSON.stringify(project.slides)),
    mediaPool: JSON.parse(JSON.stringify(project.mediaPool)),
  };
}

/**
 * Apply a snapshot back to a project
 */
function applySnapshot(project: Project, snapshot: HistorySnapshot): Project {
  return {
    ...project,
    elements: snapshot.elements,
    slides: snapshot.slides,
    mediaPool: snapshot.mediaPool,
  };
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  entries: [],
  currentIndex: -1,
  isUndoRedoInProgress: false,
  config: DEFAULT_CONFIG,
  deletedAssets: new Map(),
  pendingSnapshot: null,
  pendingContext: null,

  pushState: (project: Project, context: HistoryOperationContext) => {
    const { isUndoRedoInProgress, config } = get();

    // Don't track changes during undo/redo operations
    if (isUndoRedoInProgress) return;

    const snapshot = createSnapshot(project);

    // For transform operations, debounce the commit
    if (context.source === 'transform') {
      // Store pending snapshot
      set({ pendingSnapshot: snapshot, pendingContext: context });

      // Clear existing timeout
      if (debounceTimeout) {
        clearTimeout(debounceTimeout);
      }

      // Set new timeout
      debounceTimeout = setTimeout(() => {
        get().commitPending();
      }, config.debounceMs);

      return;
    }

    // For non-transform operations, commit immediately
    // First, commit any pending transform
    if (debounceTimeout) {
      clearTimeout(debounceTimeout);
      debounceTimeout = null;
    }
    const { pendingSnapshot, pendingContext } = get();
    if (pendingSnapshot && pendingContext) {
      // Commit pending first
      commitEntry(pendingSnapshot, pendingContext, get, set);
    }

    // Then commit the new entry
    commitEntry(snapshot, context, get, set);
    set({ pendingSnapshot: null, pendingContext: null });
  },

  commitPending: () => {
    const { pendingSnapshot, pendingContext } = get();
    if (!pendingSnapshot || !pendingContext) return;

    if (debounceTimeout) {
      clearTimeout(debounceTimeout);
      debounceTimeout = null;
    }

    commitEntry(pendingSnapshot, pendingContext, get, set);
    set({ pendingSnapshot: null, pendingContext: null });
  },

  undo: () => {
    const { entries, currentIndex, isUndoRedoInProgress } = get();

    // Can't undo if already in progress or at the beginning
    if (isUndoRedoInProgress || currentIndex <= 0) return;

    const targetIndex = currentIndex - 1;
    const targetEntry = entries[targetIndex];

    // Mark as in progress to prevent recursive tracking
    set({ isUndoRedoInProgress: true });

    // Immediately update local state for instant UI feedback
    set({ currentIndex: targetIndex });

    // Check if we need to restore any deleted assets
    const currentSnapshot = entries[currentIndex]?.snapshot;
    if (currentSnapshot && targetEntry.snapshot) {
      // Find assets that exist in target but not in current (were deleted)
      const currentAssetPaths = new Set(
        currentSnapshot.elements
          .filter((el) => el.assetPath)
          .map((el) => el.assetPath!)
      );
      const targetAssetPaths = targetEntry.snapshot.elements
        .filter((el) => el.assetPath)
        .map((el) => el.assetPath!);

      for (const assetPath of targetAssetPaths) {
        if (!currentAssetPaths.has(assetPath)) {
          // This asset was deleted - restore tracking
          restoreAsset(assetPath);
          get().restoreDeletedAsset(assetPath);
        }
      }
    }

    // Async: persist to backend (non-blocking)
    if (!getProjectStore) {
      set({ isUndoRedoInProgress: false });
      return;
    }
    const projectStore = getProjectStore();
    const project = projectStore.project;

    if (project) {
      const restoredProject = applySnapshot(project, targetEntry.snapshot);

      // Update local store immediately
      projectStore.setProjectSilent(restoredProject);

      // Async backend sync
      queueMicrotask(() => {
        updateProject(restoredProject)
          .catch((err) => console.error('Failed to persist undo:', err))
          .finally(() => {
            set({ isUndoRedoInProgress: false });
          });
      });
    } else {
      set({ isUndoRedoInProgress: false });
    }
  },

  redo: () => {
    const { entries, currentIndex, isUndoRedoInProgress } = get();

    // Can't redo if already in progress or at the end
    if (isUndoRedoInProgress || currentIndex >= entries.length - 1) return;

    const targetIndex = currentIndex + 1;
    const targetEntry = entries[targetIndex];

    // Mark as in progress
    set({ isUndoRedoInProgress: true });

    // Immediately update local state
    set({ currentIndex: targetIndex });

    // Async: persist to backend
    if (!getProjectStore) {
      set({ isUndoRedoInProgress: false });
      return;
    }
    const projectStore = getProjectStore();
    const project = projectStore.project;

    if (project) {
      const restoredProject = applySnapshot(project, targetEntry.snapshot);

      // Update local store immediately
      projectStore.setProjectSilent(restoredProject);

      // Async backend sync
      queueMicrotask(() => {
        updateProject(restoredProject)
          .catch((err) => console.error('Failed to persist redo:', err))
          .finally(() => {
            set({ isUndoRedoInProgress: false });
          });
      });
    } else {
      set({ isUndoRedoInProgress: false });
    }
  },

  clear: () => {
    if (debounceTimeout) {
      clearTimeout(debounceTimeout);
      debounceTimeout = null;
    }

    // Clear pending deletions (files stay on disk until project closes)
    clearPendingDeletions(false);

    set({
      entries: [],
      currentIndex: -1,
      pendingSnapshot: null,
      pendingContext: null,
      deletedAssets: new Map(),
    });
  },

  setConfig: (newConfig: Partial<HistoryConfig>) => {
    set((state) => ({
      config: { ...state.config, ...newConfig },
    }));
  },

  trackDeletedAsset: (info: DeletedAssetInfo) => {
    softDeleteAsset(info);
    set((state) => {
      const newMap = new Map(state.deletedAssets);
      newMap.set(info.assetPath, info);
      return { deletedAssets: newMap };
    });
  },

  restoreDeletedAsset: (assetPath: string) => {
    restoreAsset(assetPath);
    set((state) => {
      const newMap = new Map(state.deletedAssets);
      newMap.delete(assetPath);
      return { deletedAssets: newMap };
    });
  },

  _setUndoRedoInProgress: (value: boolean) => {
    set({ isUndoRedoInProgress: value });
  },
}));

/**
 * Helper to commit an entry to history
 */
function commitEntry(
  snapshot: HistorySnapshot,
  context: HistoryOperationContext,
  get: () => HistoryState,
  set: (partial: Partial<HistoryState> | ((state: HistoryState) => Partial<HistoryState>)) => void
) {
  const { entries, currentIndex, config, deletedAssets } = get();

  const newEntry: HistoryEntry = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    label: generateLabel(context),
    snapshot,
  };

  // Truncate any redo entries (we're branching from current point)
  const truncatedEntries = entries.slice(0, currentIndex + 1);

  // Find assets in truncated entries that need cleanup
  const assetsToCleanup: string[] = [];
  const truncatedAssetPaths = new Set<string>();

  // Collect all asset paths in remaining history
  for (const entry of truncatedEntries) {
    for (const el of entry.snapshot.elements) {
      if (el.assetPath) truncatedAssetPaths.add(el.assetPath);
    }
  }
  // Also include new entry
  for (const el of snapshot.elements) {
    if (el.assetPath) truncatedAssetPaths.add(el.assetPath);
  }

  // Find deleted assets that are no longer referenced
  for (const [assetPath] of deletedAssets) {
    if (!truncatedAssetPaths.has(assetPath)) {
      assetsToCleanup.push(assetPath);
    }
  }

  // Add new entry
  const newEntries = [...truncatedEntries, newEntry];

  // Enforce max entries limit - prune oldest if needed
  let finalEntries = newEntries;
  if (newEntries.length > config.maxEntries) {
    const prunedEntries = newEntries.slice(0, newEntries.length - config.maxEntries);

    // Find assets in pruned entries that need cleanup
    const remainingAssetPaths = new Set<string>();
    for (const entry of newEntries.slice(-config.maxEntries)) {
      for (const el of entry.snapshot.elements) {
        if (el.assetPath) remainingAssetPaths.add(el.assetPath);
      }
    }

    for (const entry of prunedEntries) {
      for (const el of entry.snapshot.elements) {
        if (el.assetPath && !remainingAssetPaths.has(el.assetPath)) {
          // Check if this asset is in deletedAssets (was deleted by user)
          if (deletedAssets.has(el.assetPath)) {
            assetsToCleanup.push(el.assetPath);
          }
        }
      }
    }

    finalEntries = newEntries.slice(-config.maxEntries);
  }

  // Schedule async cleanup if needed
  if (assetsToCleanup.length > 0) {
    scheduleAssetCleanup(assetsToCleanup);
  }

  set({
    entries: finalEntries,
    currentIndex: finalEntries.length - 1,
  });
}

// Selector hooks for computed values
export const useCanUndo = () =>
  useHistoryStore((state) => !state.isUndoRedoInProgress && state.currentIndex > 0);

export const useCanRedo = () =>
  useHistoryStore(
    (state) => !state.isUndoRedoInProgress && state.currentIndex < state.entries.length - 1
  );

// Export for setting project context
export { setCurrentProjectId };
