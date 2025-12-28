import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type { Element, Guide, Project, Slide } from '../types';
import {
  getProject,
  updateProject,
  deleteMedia,
  importMediaFiles,
  embedElementAsset,
  deleteElementAsset,
} from '../services/tauri';

export type PanelId = 'mediaPool' | 'layers' | 'templates' | 'slides';

interface PanelState {
  isOpen: boolean;
  width: number;
  height: number;
}

interface EditorState {
  project: Project | null;
  isLoading: boolean;
  error: string | null;
  currentSlideIndex: number;
  selectedElementId: string | null;
  selectedMediaIds: string[];
  lastSelectedMediaId: string | null;
  draggingMediaId: string | null;
  dragPosition: { x: number; y: number } | null;
  dragMousePosition: { x: number; y: number } | null;
  panels: Record<PanelId, PanelState>;
  // Snapping
  snapEnabled: boolean;
  activeGuides: Guide[];
  // Cropping
  cropModeElementId: string | null;

  // Project operations
  loadProject: (id: string) => Promise<void>;
  refreshProject: () => Promise<void>;
  setProject: (project: Project) => void;

  // Slide operations
  setCurrentSlide: (index: number) => void;
  addSlide: () => Promise<void>;
  removeSlide: (slideIndex: number) => Promise<void>;
  reorderSlides: (fromIndex: number, toIndex: number) => Promise<void>;

  // Element operations (global across all slides)
  selectElement: (id: string | null) => void;
  addElement: (element: Element) => Promise<void>;
  updateElement: (elementId: string, updates: Partial<Element>) => Promise<void>;
  removeElement: (elementId: string) => Promise<void>;
  reorderElements: (orderedIds: string[]) => Promise<void>;
  sendToFront: (elementId: string) => Promise<void>;
  sendToBack: (elementId: string) => Promise<void>;

  // Media operations
  selectMedia: (id: string | null, options?: { shift?: boolean; ctrl?: boolean }) => void;
  clearMediaSelection: () => void;
  importMedia: (filePaths: string[]) => Promise<void>;
  removeMedia: (mediaId: string) => Promise<void>;
  removeSelectedMedia: () => Promise<void>;
  isMediaInUse: (mediaId: string) => boolean;
  setDraggingMedia: (mediaId: string | null) => void;
  setDragPosition: (position: { x: number; y: number } | null) => void;
  setDragMousePosition: (position: { x: number; y: number } | null) => void;

  // Panel operations
  togglePanel: (panelId: PanelId) => void;
  setPanelSize: (panelId: PanelId, size: { width?: number; height?: number }) => void;
  closePanel: (panelId: PanelId) => void;

  // Snap operations
  setSnapEnabled: (enabled: boolean) => void;
  setActiveGuides: (guides: Guide[]) => void;

  // Crop operations
  enterCropMode: (elementId: string) => void;
  exitCropMode: () => void;
}

const defaultPanelState: Record<PanelId, PanelState> = {
  mediaPool: { isOpen: false, width: 300, height: 200 },
  layers: { isOpen: false, width: 250, height: 300 },
  templates: { isOpen: false, width: 280, height: 400 },
  slides: { isOpen: false, width: 0, height: 120 },
};

export const useEditorStore = create<EditorState>((set, get) => ({
  project: null,
  isLoading: true,
  error: null,
  currentSlideIndex: 0,
  selectedElementId: null,
  selectedMediaIds: [],
  lastSelectedMediaId: null,
  draggingMediaId: null,
  dragPosition: null,
  dragMousePosition: null,
  panels: { ...defaultPanelState },
  snapEnabled: true,
  activeGuides: [],
  cropModeElementId: null,

  loadProject: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const project = await getProject(id);
      set({ project, isLoading: false, currentSlideIndex: 0 });
    } catch (error) {
      console.error('Failed to load project:', error);
      set({ error: String(error), isLoading: false });
    }
  },

  refreshProject: async () => {
    const { project } = get();
    if (!project) return;
    try {
      const refreshedProject = await getProject(project.id);
      set({ project: refreshedProject });
    } catch (error) {
      console.error('Failed to refresh project:', error);
    }
  },

  setProject: (project: Project) => {
    set({ project });
  },

  setCurrentSlide: (index: number) => {
    const { project } = get();
    if (project && index >= 0 && index < project.slides.length) {
      set({ currentSlideIndex: index });
    }
  },

  addSlide: async () => {
    const { project } = get();
    if (!project) return;

    // Maximum 20 slides
    if (project.slides.length >= 20) return;

    const newSlide: Slide = {
      id: uuidv4(),
      order: project.slides.length,
    };

    const updatedProject = {
      ...project,
      slides: [...project.slides, newSlide],
    };

    try {
      const savedProject = await updateProject(updatedProject);
      set({ project: savedProject });
    } catch (error) {
      console.error('Failed to add slide:', error);
    }
  },

  removeSlide: async (slideIndex: number) => {
    const { project, currentSlideIndex } = get();
    if (!project) return;

    // Must have at least 1 slide
    if (project.slides.length <= 1) return;

    // Calculate slide width for element repositioning
    const slideWidth = 1080 * (project.aspectRatio.width / project.aspectRatio.height);

    // Find elements "homed" on this slide and remove them
    // An element's home slide is the leftmost slide it occupies
    const updatedElements = project.elements.filter((element) => {
      const homeSlideIndex = Math.floor(element.x / slideWidth);
      return homeSlideIndex !== slideIndex;
    });

    // Adjust x coordinates for elements on slides after the deleted one
    const adjustedElements = updatedElements.map((element) => {
      const homeSlideIndex = Math.floor(element.x / slideWidth);
      if (homeSlideIndex > slideIndex) {
        return { ...element, x: element.x - slideWidth };
      }
      return element;
    });

    const updatedSlides = project.slides.filter((_, index) => index !== slideIndex);
    // Update order values
    updatedSlides.forEach((slide, index) => {
      slide.order = index;
    });

    const updatedProject = { ...project, slides: updatedSlides, elements: adjustedElements };

    // Adjust current slide index if needed
    let newCurrentIndex = currentSlideIndex;
    if (currentSlideIndex >= updatedSlides.length) {
      newCurrentIndex = updatedSlides.length - 1;
    } else if (currentSlideIndex > slideIndex) {
      newCurrentIndex = currentSlideIndex - 1;
    }

    try {
      const savedProject = await updateProject(updatedProject);
      set({ project: savedProject, currentSlideIndex: newCurrentIndex });
    } catch (error) {
      console.error('Failed to remove slide:', error);
    }
  },

  reorderSlides: async (fromIndex: number, toIndex: number) => {
    const { project, currentSlideIndex } = get();
    if (!project) return;
    if (fromIndex === toIndex) return;
    if (fromIndex < 0 || fromIndex >= project.slides.length) return;
    if (toIndex < 0 || toIndex >= project.slides.length) return;

    const slideWidth = 1080 * (project.aspectRatio.width / project.aspectRatio.height);

    // Reorder slides array
    const newSlides = [...project.slides];
    const [movedSlide] = newSlides.splice(fromIndex, 1);
    newSlides.splice(toIndex, 0, movedSlide);

    // Update order values
    newSlides.forEach((slide, index) => {
      slide.order = index;
    });

    // Adjust element positions based on slide movement
    // Elements stay with their "home" slide (leftmost slide they occupy)
    const adjustedElements = project.elements.map((element) => {
      const homeSlideIndex = Math.floor(element.x / slideWidth);

      if (homeSlideIndex === fromIndex) {
        // Element is homed on the moved slide - move it to new position
        const offsetWithinSlide = element.x - fromIndex * slideWidth;
        return { ...element, x: toIndex * slideWidth + offsetWithinSlide };
      } else if (fromIndex < toIndex) {
        // Slide moved right: elements on slides between fromIndex+1 and toIndex shift left
        if (homeSlideIndex > fromIndex && homeSlideIndex <= toIndex) {
          return { ...element, x: element.x - slideWidth };
        }
      } else {
        // Slide moved left: elements on slides between toIndex and fromIndex-1 shift right
        if (homeSlideIndex >= toIndex && homeSlideIndex < fromIndex) {
          return { ...element, x: element.x + slideWidth };
        }
      }
      return element;
    });

    const updatedProject = { ...project, slides: newSlides, elements: adjustedElements };

    // Update current slide index to follow the moved slide if it was selected
    let newCurrentIndex = currentSlideIndex;
    if (currentSlideIndex === fromIndex) {
      newCurrentIndex = toIndex;
    } else if (fromIndex < toIndex) {
      if (currentSlideIndex > fromIndex && currentSlideIndex <= toIndex) {
        newCurrentIndex = currentSlideIndex - 1;
      }
    } else {
      if (currentSlideIndex >= toIndex && currentSlideIndex < fromIndex) {
        newCurrentIndex = currentSlideIndex + 1;
      }
    }

    try {
      const savedProject = await updateProject(updatedProject);
      set({ project: savedProject, currentSlideIndex: newCurrentIndex });
    } catch (error) {
      console.error('Failed to reorder slides:', error);
    }
  },

  selectElement: (id: string | null) => {
    set({ selectedElementId: id });
  },

  addElement: async (element: Element) => {
    const { project } = get();
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
      set({ project: savedProject, selectedElementId: element.id });
    } catch (error) {
      console.error('Failed to add element:', error);
    }
  },

  updateElement: async (elementId: string, updates: Partial<Element>) => {
    const { project } = get();
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
      set({ project: savedProject });
    } catch (error) {
      console.error('Failed to update element:', error);
    }
  },

  removeElement: async (elementId: string) => {
    const { project, selectedElementId, cropModeElementId } = get();
    if (!project) return;

    // Find the element to get its asset path before removing
    const elementToRemove = project.elements.find((e) => e.id === elementId);

    const updatedProject = {
      ...project,
      elements: project.elements.filter((e) => e.id !== elementId),
    };

    try {
      const savedProject = await updateProject(updatedProject);
      set({
        project: savedProject,
        selectedElementId: selectedElementId === elementId ? null : selectedElementId,
        // Exit crop mode if the deleted element was being cropped
        cropModeElementId: cropModeElementId === elementId ? null : cropModeElementId,
      });

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
    const { project } = get();
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
      set({ project: savedProject });
    } catch (error) {
      console.error('Failed to reorder elements:', error);
    }
  },

  sendToFront: async (elementId: string) => {
    const { project } = get();
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
    const { project } = get();
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

  selectMedia: (id: string | null, options = {}) => {
    const { project, selectedMediaIds, lastSelectedMediaId } = get();
    if (!project) return;

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
    const { project, loadProject } = get();
    if (!project) return;

    try {
      await importMediaFiles(project.id, filePaths);
      // Reload project to get updated media pool from backend
      await loadProject(project.id);
    } catch (error) {
      console.error('Failed to import media:', error);
    }
  },

  removeMedia: async (mediaId: string) => {
    const { project, selectedMediaIds } = get();
    if (!project) return;

    try {
      const updatedProject = await deleteMedia(project.id, mediaId);
      set({
        project: updatedProject,
        selectedMediaIds: selectedMediaIds.filter((id) => id !== mediaId),
      });
    } catch (error) {
      console.error('Failed to remove media:', error);
    }
  },

  removeSelectedMedia: async () => {
    const { project, selectedMediaIds } = get();
    if (!project || selectedMediaIds.length === 0) return;

    try {
      // Remove each selected media one by one
      let updatedProject = project;
      for (const mediaId of selectedMediaIds) {
        updatedProject = await deleteMedia(project.id, mediaId);
      }
      set({
        project: updatedProject,
        selectedMediaIds: [],
        lastSelectedMediaId: null,
      });
    } catch (error) {
      console.error('Failed to remove selected media:', error);
    }
  },

  isMediaInUse: (mediaId: string) => {
    const { project } = get();
    if (!project) return false;

    return project.elements.some((element) => element.mediaId === mediaId);
  },

  setDraggingMedia: (mediaId: string | null) => {
    set({ draggingMediaId: mediaId });
  },

  setDragPosition: (position: { x: number; y: number } | null) => {
    set({ dragPosition: position });
  },

  setDragMousePosition: (position: { x: number; y: number } | null) => {
    set({ dragMousePosition: position });
  },

  togglePanel: (panelId: PanelId) => {
    set((state) => ({
      panels: {
        ...state.panels,
        [panelId]: {
          ...state.panels[panelId],
          isOpen: !state.panels[panelId].isOpen,
        },
      },
    }));
  },

  setPanelSize: (panelId: PanelId, size: { width?: number; height?: number }) => {
    set((state) => ({
      panels: {
        ...state.panels,
        [panelId]: {
          ...state.panels[panelId],
          ...(size.width !== undefined && { width: size.width }),
          ...(size.height !== undefined && { height: size.height }),
        },
      },
    }));
  },

  closePanel: (panelId: PanelId) => {
    set((state) => ({
      panels: {
        ...state.panels,
        [panelId]: {
          ...state.panels[panelId],
          isOpen: false,
        },
      },
    }));
  },

  // Snap operations
  setSnapEnabled: (enabled: boolean) => {
    set({ snapEnabled: enabled });
  },

  setActiveGuides: (guides: Guide[]) => {
    set({ activeGuides: guides });
  },

  // Crop operations
  enterCropMode: (elementId: string) => {
    set({ cropModeElementId: elementId, selectedElementId: elementId });
  },

  exitCropMode: () => {
    set({ cropModeElementId: null });
  },
}));
