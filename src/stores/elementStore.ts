import { create } from 'zustand';
import type { Element } from '../types';
import { updateProject, embedElementAsset, deleteElementAsset } from '../services/tauri';
import { useProjectStore } from './projectStore';
import { useCropStore } from './cropStore';

interface ElementState {
  selectedElementId: string | null;

  selectElement: (id: string | null) => void;
  addElement: (element: Element) => Promise<void>;
  updateElement: (elementId: string, updates: Partial<Element>) => Promise<void>;
  removeElement: (elementId: string) => Promise<void>;
  reorderElements: (orderedIds: string[]) => Promise<void>;
  sendToFront: (elementId: string) => Promise<void>;
  sendToBack: (elementId: string) => Promise<void>;
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
      useProjectStore.getState().setProject(savedProject);
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
      useProjectStore.getState().setProject(savedProject);
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
      useProjectStore.getState().setProject(savedProject);
      set({
        selectedElementId: selectedElementId === elementId ? null : selectedElementId,
      });

      // Exit crop mode if the deleted element was being cropped
      if (cropModeElementId === elementId) {
        useCropStore.getState().exitCropMode();
      }

      // Clean up the embedded asset file if it exists
      if (elementToRemove?.assetPath) {
        deleteElementAsset(project.id, elementToRemove.assetPath).catch((error) => {
          console.error('Failed to delete asset file:', error);
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
      useProjectStore.getState().setProject(savedProject);
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
}));

