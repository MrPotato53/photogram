import { create } from 'zustand';
import type { Element } from '../types';
import { updateProject, embedElementAsset } from '../services/tauri';
import { useProjectStore } from './projectStore';
import { useCropStore } from './cropStore';
import { useClipboardStore } from './clipboardStore';
import { useHistoryStore } from './historyStore';

interface ElementState {
  selectedElementId: string | null;
  // Monotonic counter. Incremented whenever a caller requests the canvas
  // to scroll/center on the currently-selected element (e.g. double-click
  // in the layers panel). CanvasArea watches this and runs its focus logic.
  focusRequestId: number;

  selectElement: (id: string | null) => void;
  focusElement: (id: string) => void;
  addElement: (element: Element) => Promise<void>;
  updateElement: (elementId: string, updates: Partial<Element>) => Promise<void>;
  // Local-only element update: mutates the in-memory project via
  // setProjectSilent without persisting to the backend and without pushing
  // a history entry. Used for transient state (e.g. crop-mode shift+pan)
  // that should be discarded on cancel and committed as a single entry
  // on confirm.
  updateElementLocal: (elementId: string, updates: Partial<Element>) => void;
  removeElement: (elementId: string) => Promise<void>;
  reorderElements: (orderedIds: string[]) => Promise<void>;
  // Local-only reorder for live preview during layer drag. Same zIndex
  // math as reorderElements but skips the backend round-trip and history
  // push — commit the final order via reorderElements on drag end.
  reorderElementsLocal: (orderedIds: string[]) => void;
  sendToFront: (elementId: string) => Promise<void>;
  sendToBack: (elementId: string) => Promise<void>;
  // Move one layer toward front/back (swap zIndex with neighbor).
  moveLayerForward: (elementId: string) => Promise<void>;
  moveLayerBackward: (elementId: string) => Promise<void>;
  copySelectedElement: () => void;
  pasteElements: (options?: { centerX?: number; centerY?: number }) => Promise<string[]>;
  // In-place duplicate (Cmd+D). Does not touch the clipboard.
  duplicateSelectedElement: () => Promise<string | null>;
}

export const useElementStore = create<ElementState>((set, get) => ({
  selectedElementId: null,
  focusRequestId: 0,

  selectElement: (id: string | null) => {
    set({ selectedElementId: id });
  },

  focusElement: (id: string) => {
    set((state) => ({
      selectedElementId: id,
      focusRequestId: state.focusRequestId + 1,
    }));
  },

  addElement: async (element: Element) => {
    const project = useProjectStore.getState().project;
    if (!project) return;

    let elementWithAsset = { ...element };

    // For photo elements, embed the source image as a project asset
    if (element.type === 'photo' && element.mediaId) {
      const media = project.mediaPool.find((m) => m.id === element.mediaId);
      if (media) {
        try {
          const assetPath = await embedElementAsset(project.id, element.id, media.filePath);
          elementWithAsset.assetPath = assetPath;
        } catch (error) {
          console.error('Failed to embed asset:', error);
          // Continue without embedded asset - will fall back to media pool reference
        }
      }
    }

    const updatedProject = {
      ...project,
      elements: [...project.elements, elementWithAsset],
    };

    try {
      const savedProject = await updateProject(updatedProject);
      useProjectStore.getState().setProject(savedProject, {
        source: 'element',
        actionType: 'add',
        elementId: element.id,
      });
      set({ selectedElementId: element.id });
    } catch (error) {
      console.error('Failed to add element:', error);
    }
  },

  updateElementLocal: (elementId: string, updates: Partial<Element>) => {
    const project = useProjectStore.getState().project;
    if (!project) return;

    const elementIndex = project.elements.findIndex((e) => e.id === elementId);
    if (elementIndex === -1) return;

    const updatedElements = [...project.elements];
    updatedElements[elementIndex] = {
      ...updatedElements[elementIndex],
      ...updates,
    };

    useProjectStore.getState().setProjectSilent({
      ...project,
      elements: updatedElements,
    });
  },

  updateElement: async (elementId: string, updates: Partial<Element>) => {
    const project = useProjectStore.getState().project;
    if (!project) return;

    const elementIndex = project.elements.findIndex((e) => e.id === elementId);
    if (elementIndex === -1) return;

    const updatedElements = [...project.elements];
    updatedElements[elementIndex] = {
      ...updatedElements[elementIndex],
      ...updates,
    };

    const updatedProject = { ...project, elements: updatedElements };

    // Optimistic write: swap in-memory state + push history synchronously so
    // cmd-z works immediately on drag end instead of waiting for the backend
    // round-trip. Backend update_project only mutates updated_at (metadata),
    // so we skip the savedProject echo — no reconciliation needed.
    useProjectStore.getState().setProject(updatedProject, {
      source: 'transform',
      actionType: 'update',
      elementId,
    });

    updateProject(updatedProject).catch((error) => {
      console.error('Failed to persist element update:', error);
    });
  },

  removeElement: async (elementId: string) => {
    const project = useProjectStore.getState().project;
    const { selectedElementId } = get();
    const { cropModeElementId } = useCropStore.getState();
    if (!project) return;

    // Find the element to get its asset path before removing
    const elementToRemove = project.elements.find((e) => e.id === elementId);

    const updatedProject = {
      ...project,
      elements: project.elements.filter((e) => e.id !== elementId),
    };

    try {
      const savedProject = await updateProject(updatedProject);
      useProjectStore.getState().setProject(savedProject, {
        source: 'element',
        actionType: 'delete',
        elementId,
      });
      set({
        selectedElementId: selectedElementId === elementId ? null : selectedElementId,
      });

      // Exit crop mode if the deleted element was being cropped
      if (cropModeElementId === elementId) {
        useCropStore.getState().exitCropMode();
      }

      // Track deleted asset for undo support (don't delete file yet)
      // File will be deleted when entry falls off history stack
      if (elementToRemove?.assetPath) {
        const historyStore = useHistoryStore.getState();
        const currentEntry = historyStore.entries[historyStore.currentIndex];
        historyStore.trackDeletedAsset({
          assetPath: elementToRemove.assetPath,
          mediaId: elementToRemove.mediaId || '',
          deletedAt: Date.now(),
          historyEntryId: currentEntry?.id || '',
        });
      }
    } catch (error) {
      console.error('Failed to remove element:', error);
    }
  },

  reorderElements: async (orderedIds: string[]) => {
    const project = useProjectStore.getState().project;
    if (!project) return;

    // Create a map of elements by ID
    const elementMap = new Map(project.elements.map((e) => [e.id, e]));

    // Rebuild elements array with new zIndex values
    // orderedIds is in visual order (top to bottom), so reverse for zIndex (higher = on top)
    const reorderedElements = orderedIds
      .map((id, index) => {
        const element = elementMap.get(id);
        if (!element) return null;
        return { ...element, zIndex: orderedIds.length - 1 - index };
      })
      .filter((e): e is Element => e !== null);

    // Add back any elements not in orderedIds (shouldn't happen but safety)
    const orderedIdSet = new Set(orderedIds);
    const remainingElements = project.elements.filter((e) => !orderedIdSet.has(e.id));

    const updatedProject = {
      ...project,
      elements: [...reorderedElements, ...remainingElements],
    };

    try {
      const savedProject = await updateProject(updatedProject);
      useProjectStore.getState().setProject(savedProject, {
        source: 'reorder',
        actionType: 'reorder',
      });
    } catch (error) {
      console.error('Failed to reorder elements:', error);
    }
  },

  reorderElementsLocal: (orderedIds: string[]) => {
    const project = useProjectStore.getState().project;
    if (!project) return;

    // Build id → new zIndex map.
    const newZIndex = new Map<string, number>();
    for (let i = 0; i < orderedIds.length; i++) {
      newZIndex.set(orderedIds[i], orderedIds.length - 1 - i);
    }

    // Preserve object references for elements whose zIndex didn't change —
    // React.memo on CanvasElementRenderer relies on prop identity, so
    // rebuilding every element (as we used to) would re-render the entire
    // canvas on each live-reorder tick.
    let changed = false;
    const updatedElements = project.elements.map((el) => {
      const z = newZIndex.get(el.id);
      if (z === undefined || z === el.zIndex) return el;
      changed = true;
      return { ...el, zIndex: z };
    });

    if (!changed) return;

    useProjectStore.getState().setProjectSilent({
      ...project,
      elements: updatedElements,
    });
  },

  sendToFront: async (elementId: string) => {
    const project = useProjectStore.getState().project;
    if (!project) return;

    const elements = [...project.elements].sort((a, b) => b.zIndex - a.zIndex);
    const currentIndex = elements.findIndex((e) => e.id === elementId);

    if (currentIndex <= 0) return; // Already at front

    // Move to front (index 0 in sorted array = highest zIndex)
    const [element] = elements.splice(currentIndex, 1);
    elements.unshift(element);

    const orderedIds = elements.map((e) => e.id);
    await get().reorderElements(orderedIds);
  },

  sendToBack: async (elementId: string) => {
    const project = useProjectStore.getState().project;
    if (!project) return;

    const elements = [...project.elements].sort((a, b) => b.zIndex - a.zIndex);
    const currentIndex = elements.findIndex((e) => e.id === elementId);

    if (currentIndex === elements.length - 1) return; // Already at back

    // Move to back (last index in sorted array = lowest zIndex)
    const [element] = elements.splice(currentIndex, 1);
    elements.push(element);

    const orderedIds = elements.map((e) => e.id);
    await get().reorderElements(orderedIds);
  },

  moveLayerForward: async (elementId: string) => {
    const project = useProjectStore.getState().project;
    if (!project) return;

    // Sort front-to-back (highest zIndex first) so index 0 = frontmost.
    const sorted = [...project.elements].sort((a, b) => b.zIndex - a.zIndex);
    const idx = sorted.findIndex((e) => e.id === elementId);
    if (idx <= 0) return; // already at or past front

    [sorted[idx - 1], sorted[idx]] = [sorted[idx], sorted[idx - 1]];
    await get().reorderElements(sorted.map((e) => e.id));
  },

  moveLayerBackward: async (elementId: string) => {
    const project = useProjectStore.getState().project;
    if (!project) return;

    const sorted = [...project.elements].sort((a, b) => b.zIndex - a.zIndex);
    const idx = sorted.findIndex((e) => e.id === elementId);
    if (idx === -1 || idx === sorted.length - 1) return; // already at back

    [sorted[idx], sorted[idx + 1]] = [sorted[idx + 1], sorted[idx]];
    await get().reorderElements(sorted.map((e) => e.id));
  },

  copySelectedElement: () => {
    const project = useProjectStore.getState().project;
    const { selectedElementId } = get();
    if (!project || !selectedElementId) return;

    const element = project.elements.find((e) => e.id === selectedElementId);
    if (!element) return;

    useClipboardStore.getState().copyElements([element]);
  },

  pasteElements: async (options?: { centerX?: number; centerY?: number }) => {
    const clipboardData = useClipboardStore.getState().paste();
    if (!clipboardData || clipboardData.length === 0) return [];

    const project = useProjectStore.getState().project;
    if (!project) return [];

    const PASTE_OFFSET = 20; // pixels for keyboard paste offset

    // Calculate the center point of the original elements
    const originalElements = clipboardData;
    const bounds = originalElements.reduce(
      (acc, el) => ({
        minX: Math.min(acc.minX, el.x),
        minY: Math.min(acc.minY, el.y),
        maxX: Math.max(acc.maxX, el.x + el.width),
        maxY: Math.max(acc.maxY, el.y + el.height),
      }),
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
    );
    const originalCenterX = (bounds.minX + bounds.maxX) / 2;
    const originalCenterY = (bounds.minY + bounds.maxY) / 2;

    // Determine paste position
    let targetCenterX: number;
    let targetCenterY: number;

    if (options?.centerX !== undefined && options?.centerY !== undefined) {
      // Right-click paste: use provided cursor position as center
      targetCenterX = options.centerX;
      targetCenterY = options.centerY;
    } else {
      // Keyboard paste: offset from original position
      targetCenterX = originalCenterX + PASTE_OFFSET;
      targetCenterY = originalCenterY + PASTE_OFFSET;
    }

    // Calculate offset to apply to all elements
    const offsetX = targetCenterX - originalCenterX;
    const offsetY = targetCenterY - originalCenterY;

    // Generate new IDs and apply position offset
    const maxZIndex = project.elements.length > 0
      ? Math.max(...project.elements.map((e) => e.zIndex))
      : -1;

    const newElements: Element[] = clipboardData.map((element, index) => ({
      ...element,
      id: crypto.randomUUID(),
      x: element.x + offsetX,
      y: element.y + offsetY,
      zIndex: maxZIndex + 1 + index,
    }));

    // Batch add all elements and embed assets
    const elementsWithAssets: Element[] = [];
    for (const element of newElements) {
      let elementWithAsset = { ...element };

      // For photo elements, embed the source image as a project asset
      if (element.type === 'photo' && element.mediaId) {
        const media = project.mediaPool.find((m) => m.id === element.mediaId);
        if (media) {
          try {
            const assetPath = await embedElementAsset(project.id, element.id, media.filePath);
            elementWithAsset.assetPath = assetPath;
          } catch (error) {
            console.error('Failed to embed asset:', error);
          }
        }
      }

      elementsWithAssets.push(elementWithAsset);
    }

    // Single project update with all pasted elements
    const updatedProject = {
      ...project,
      elements: [...project.elements, ...elementsWithAssets],
    };

    try {
      const savedProject = await updateProject(updatedProject);
      // Single history entry for all pasted elements
      useProjectStore.getState().setProject(savedProject, {
        source: 'paste',
        actionType: 'paste',
      });

      // Select the first pasted element
      if (newElements.length > 0) {
        set({ selectedElementId: newElements[0].id });
      }

      return newElements.map((e) => e.id);
    } catch (error) {
      console.error('Failed to paste elements:', error);
      return [];
    }
  },

  duplicateSelectedElement: async () => {
    const project = useProjectStore.getState().project;
    const { selectedElementId } = get();
    if (!project || !selectedElementId) return null;

    const element = project.elements.find((e) => e.id === selectedElementId);
    if (!element) return null;

    const PASTE_OFFSET = 20;
    const maxZIndex = project.elements.length > 0
      ? Math.max(...project.elements.map((e) => e.zIndex))
      : -1;

    const newElement: Element = {
      ...element,
      id: crypto.randomUUID(),
      x: element.x + PASTE_OFFSET,
      y: element.y + PASTE_OFFSET,
      zIndex: maxZIndex + 1,
    };

    // Photo elements need their own embedded asset copy so the two elements
    // don't share a file path (deleting one would dangle the other).
    if (newElement.type === 'photo' && newElement.mediaId) {
      const media = project.mediaPool.find((m) => m.id === newElement.mediaId);
      if (media) {
        try {
          const assetPath = await embedElementAsset(project.id, newElement.id, media.filePath);
          newElement.assetPath = assetPath;
        } catch (error) {
          console.error('Failed to embed asset for duplicate:', error);
        }
      }
    }

    const updatedProject = {
      ...project,
      elements: [...project.elements, newElement],
    };

    try {
      const savedProject = await updateProject(updatedProject);
      useProjectStore.getState().setProject(savedProject, {
        source: 'element',
        actionType: 'duplicate',
        elementId: newElement.id,
      });
      set({ selectedElementId: newElement.id });
      return newElement.id;
    } catch (error) {
      console.error('Failed to duplicate element:', error);
      return null;
    }
  },
}));

