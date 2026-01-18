import { create } from 'zustand';
import type { Element } from '../types';
import { updateProject, embedElementAsset } from '../services/tauri';
import { useProjectStore } from './projectStore';
import { useCropStore } from './cropStore';
import { useClipboardStore } from './clipboardStore';
import { useHistoryStore } from './historyStore';

interface ElementState {
  selectedElementId: string | null;

  selectElement: (id: string | null) => void;
  addElement: (element: Element) => Promise<void>;
  updateElement: (elementId: string, updates: Partial<Element>) => Promise<void>;
  removeElement: (elementId: string) => Promise<void>;
  reorderElements: (orderedIds: string[]) => Promise<void>;
  sendToFront: (elementId: string) => Promise<void>;
  sendToBack: (elementId: string) => Promise<void>;
  copySelectedElement: () => void;
  pasteElements: (options?: { centerX?: number; centerY?: number }) => Promise<string[]>;
}

export const useElementStore = create<ElementState>((set, get) => ({
  selectedElementId: null,

  selectElement: (id: string | null) => {
    set({ selectedElementId: id });
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
    try {
      const savedProject = await updateProject(updatedProject);
      useProjectStore.getState().setProject(savedProject, {
        source: 'transform',
        actionType: 'update',
        elementId,
      });
    } catch (error) {
      console.error('Failed to update element:', error);
    }
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
}));

