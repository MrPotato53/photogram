import { create } from 'zustand';
import type { Element, Guide, Project } from '../types';
import { getProject, updateProject, deleteMedia, importMediaFiles } from '../services/tauri';

export type PanelId = 'mediaPool' | 'layers' | 'templates';

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
  setProject: (project: Project) => void;

  // Slide operations
  setCurrentSlide: (index: number) => void;

  // Element operations
  selectElement: (id: string | null) => void;
  addElement: (element: Element) => Promise<void>;
  updateElement: (elementId: string, updates: Partial<Element>) => Promise<void>;
  removeElement: (elementId: string) => Promise<void>;

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

  setProject: (project: Project) => {
    set({ project });
  },

  setCurrentSlide: (index: number) => {
    const { project } = get();
    if (project && index >= 0 && index < project.slides.length) {
      set({ currentSlideIndex: index, selectedElementId: null });
    }
  },

  selectElement: (id: string | null) => {
    set({ selectedElementId: id });
  },

  addElement: async (element: Element) => {
    const { project, currentSlideIndex } = get();
    if (!project) return;

    const updatedSlides = [...project.slides];
    updatedSlides[currentSlideIndex] = {
      ...updatedSlides[currentSlideIndex],
      elements: [...updatedSlides[currentSlideIndex].elements, element],
    };

    const updatedProject = { ...project, slides: updatedSlides };
    try {
      const savedProject = await updateProject(updatedProject);
      set({ project: savedProject, selectedElementId: element.id });
    } catch (error) {
      console.error('Failed to add element:', error);
    }
  },

  updateElement: async (elementId: string, updates: Partial<Element>) => {
    const { project, currentSlideIndex } = get();
    if (!project) return;

    const updatedSlides = [...project.slides];
    const slide = updatedSlides[currentSlideIndex];
    const elementIndex = slide.elements.findIndex((e) => e.id === elementId);

    if (elementIndex === -1) return;

    slide.elements[elementIndex] = {
      ...slide.elements[elementIndex],
      ...updates,
    };

    const updatedProject = { ...project, slides: updatedSlides };
    try {
      const savedProject = await updateProject(updatedProject);
      set({ project: savedProject });
    } catch (error) {
      console.error('Failed to update element:', error);
    }
  },

  removeElement: async (elementId: string) => {
    const { project, currentSlideIndex, selectedElementId, cropModeElementId } = get();
    if (!project) return;

    const updatedSlides = [...project.slides];
    updatedSlides[currentSlideIndex] = {
      ...updatedSlides[currentSlideIndex],
      elements: updatedSlides[currentSlideIndex].elements.filter(
        (e) => e.id !== elementId
      ),
    };

    const updatedProject = { ...project, slides: updatedSlides };
    try {
      const savedProject = await updateProject(updatedProject);
      set({
        project: savedProject,
        selectedElementId: selectedElementId === elementId ? null : selectedElementId,
        // Exit crop mode if the deleted element was being cropped
        cropModeElementId: cropModeElementId === elementId ? null : cropModeElementId,
      });
    } catch (error) {
      console.error('Failed to remove element:', error);
    }
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

    return project.slides.some((slide) =>
      slide.elements.some((element) => element.mediaId === mediaId)
    );
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
