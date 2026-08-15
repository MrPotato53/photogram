import { create } from 'zustand';
import { importMediaFiles, updateProject } from '../services/tauri';
import { useProjectStore } from './projectStore';

/** One entry of the backend's `thumbnails-ready` event payload. */
export interface ThumbnailUpdate {
  mediaId: string;
  thumbnailPath: string;
}

interface MediaState {
  selectedMediaIds: string[];
  lastSelectedMediaId: string | null;
  draggingMediaId: string | null;
  dragPosition: { x: number; y: number } | null;
  /**
   * Per-media cache-bust counter. Thumbnails regenerate at the SAME path on
   * disk (the fast pass is overwritten by the quality pass, and relink /
   * resolution backfills reuse the path too), so the webview would keep
   * serving the stale bytes without a changing URL.
   *
   * Lives in the store rather than in the panel: the panel unmounts whenever
   * the user closes it, and losing these would strand tiles on old bytes.
   */
  thumbnailVersions: Record<string, number>;

  selectMedia: (id: string | null, options?: { shift?: boolean; ctrl?: boolean }) => void;
  clearMediaSelection: () => void;
  importMedia: (filePaths: string[]) => Promise<void>;
  /**
   * Merge backend-generated thumbnail paths into the in-memory project.
   *
   * The backend writes these paths into the project file itself, so this is
   * a sync of derived state, NOT a user edit: it goes in silently (no
   * history entry, no write-back). Skipping this step is what left freshly
   * imported media stuck on the loading placeholder forever — the pool only
   * ever saw `thumbnailPath: null` until the project was reopened.
   */
  applyThumbnailUpdates: (updates: ThumbnailUpdate[]) => void;
  /**
   * Cache-bust without a path change. For callers that already hold the new
   * project (relink returns it), where only the bytes at an unchanged URL
   * are stale.
   */
  bumpThumbnailVersions: (mediaIds: string[]) => void;
  removeMedia: (mediaId: string) => Promise<void>;
  removeSelectedMedia: () => Promise<void>;
  isMediaInUse: (mediaId: string) => boolean;
  setDraggingMedia: (mediaId: string | null) => void;
  setDragPosition: (position: { x: number; y: number } | null) => void;
}

export const useMediaStore = create<MediaState>((set, get) => ({
  selectedMediaIds: [],
  lastSelectedMediaId: null,
  draggingMediaId: null,
  dragPosition: null,
  thumbnailVersions: {},

  selectMedia: (id: string | null, options = {}) => {
    const project = useProjectStore.getState().project;
    if (!project) return;

    const { selectedMediaIds, lastSelectedMediaId } = get();

    if (id === null) {
      set({ selectedMediaIds: [], lastSelectedMediaId: null });
      return;
    }

    const mediaPool = project.mediaPool;
    const clickedIndex = mediaPool.findIndex((m) => m.id === id);

    if (options.shift && lastSelectedMediaId) {
      // Shift+click: select range from last selected to current
      const lastIndex = mediaPool.findIndex((m) => m.id === lastSelectedMediaId);
      if (lastIndex !== -1 && clickedIndex !== -1) {
        const start = Math.min(lastIndex, clickedIndex);
        const end = Math.max(lastIndex, clickedIndex);
        const rangeIds = mediaPool.slice(start, end + 1).map((m) => m.id);
        // Merge with existing selection
        const newSelection = [...new Set([...selectedMediaIds, ...rangeIds])];
        set({ selectedMediaIds: newSelection });
      }
    } else if (options.ctrl) {
      // Ctrl/Cmd+click: toggle selection
      if (selectedMediaIds.includes(id)) {
        set({
          selectedMediaIds: selectedMediaIds.filter((mid) => mid !== id),
          lastSelectedMediaId: id,
        });
      } else {
        set({
          selectedMediaIds: [...selectedMediaIds, id],
          lastSelectedMediaId: id,
        });
      }
    } else {
      // Normal click: single select
      set({ selectedMediaIds: [id], lastSelectedMediaId: id });
    }
  },

  clearMediaSelection: () => {
    set({ selectedMediaIds: [], lastSelectedMediaId: null });
  },

  importMedia: async (filePaths: string[]) => {
    const projectId = useProjectStore.getState().project?.id;
    if (!projectId) return;

    try {
      const newItems = await importMediaFiles(projectId, filePaths);
      if (newItems.length === 0) return;

      // Re-read the project AFTER the await. The import round-trip is long
      // enough for other work (a concurrent import, a thumbnail sync, an
      // element edit) to have landed; merging into a copy captured before
      // the call would silently discard it.
      const current = useProjectStore.getState().project;
      if (!current || current.id !== projectId) return;

      // Merge new media into current project without a full reload so
      // UI state (zoom, aspect-ratio toggle, scroll position) is preserved.
      const known = new Set(current.mediaPool.map((m) => m.id));
      const merged = [...current.mediaPool, ...newItems.filter((m) => !known.has(m.id))];
      if (merged.length === current.mediaPool.length) return;

      useProjectStore.getState().setProject(
        { ...current, mediaPool: merged },
        { source: 'media', actionType: 'add' }
      );
    } catch (error) {
      console.error('Failed to import media:', error);
    }
  },

  bumpThumbnailVersions: (mediaIds: string[]) => {
    if (mediaIds.length === 0) return;
    set((state) => {
      const versions = { ...state.thumbnailVersions };
      for (const id of mediaIds) versions[id] = (versions[id] ?? 0) + 1;
      return { thumbnailVersions: versions };
    });
  },

  applyThumbnailUpdates: (updates: ThumbnailUpdate[]) => {
    if (updates.length === 0) return;

    get().bumpThumbnailVersions(updates.map((u) => u.mediaId));

    const project = useProjectStore.getState().project;
    if (!project) return;

    const byId = new Map(updates.map((u) => [u.mediaId, u.thumbnailPath]));
    let changed = false;
    const mediaPool = project.mediaPool.map((media) => {
      const path = byId.get(media.id);
      // The quality pass re-emits the SAME path over the fast pass; that is
      // a bytes-only change, already handled by the version bump above.
      if (path === undefined || media.thumbnailPath === path) return media;
      changed = true;
      return { ...media, thumbnailPath: path };
    });

    // Silent: history snapshots share these objects by reference, and a
    // thumbnail arriving is not an undoable user action.
    if (changed) {
      useProjectStore.getState().setProjectSilent({ ...project, mediaPool });
    }
  },

  removeMedia: async (mediaId: string) => {
    const project = useProjectStore.getState().project;
    const { selectedMediaIds } = get();
    if (!project) return;

    // Soft delete: remove from mediaPool but keep file on disk for undo
    const updatedProject = {
      ...project,
      mediaPool: project.mediaPool.filter((m) => m.id !== mediaId),
    };

    try {
      const savedProject = await updateProject(updatedProject);
      useProjectStore.getState().setProject(savedProject, {
        source: 'media',
        actionType: 'delete',
      });
      set({
        selectedMediaIds: selectedMediaIds.filter((id) => id !== mediaId),
      });
    } catch (error) {
      console.error('Failed to remove media:', error);
    }
  },

  removeSelectedMedia: async () => {
    const project = useProjectStore.getState().project;
    const { selectedMediaIds } = get();
    if (!project || selectedMediaIds.length === 0) return;

    // Soft delete: remove all selected from mediaPool
    const selectedIdSet = new Set(selectedMediaIds);
    const updatedProject = {
      ...project,
      mediaPool: project.mediaPool.filter((m) => !selectedIdSet.has(m.id)),
    };

    try {
      const savedProject = await updateProject(updatedProject);
      useProjectStore.getState().setProject(savedProject, {
        source: 'media',
        actionType: 'delete',
      });
      set({
        selectedMediaIds: [],
        lastSelectedMediaId: null,
      });
    } catch (error) {
      console.error('Failed to remove selected media:', error);
    }
  },

  isMediaInUse: (mediaId: string) => {
    const project = useProjectStore.getState().project;
    if (!project) return false;

    return project.elements.some((element) => element.mediaId === mediaId);
  },

  setDraggingMedia: (mediaId: string | null) => {
    set({ draggingMediaId: mediaId });
  },

  setDragPosition: (position: { x: number; y: number } | null) => {
    set({ dragPosition: position });
  },
}));

