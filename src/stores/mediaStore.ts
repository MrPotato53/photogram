import { create } from 'zustand';
import { deleteMedia, importMediaFiles } from '../services/tauri';
import { useProjectStore } from './projectStore';

interface MediaState {
  selectedMediaIds: string[];
  lastSelectedMediaId: string | null;
  draggingMediaId: string | null;
  dragPosition: { x: number; y: number } | null;
  dragMousePosition: { x: number; y: number } | null;

  selectMedia: (id: string | null, options?: { shift?: boolean; ctrl?: boolean }) => void;
  clearMediaSelection: () => void;
  importMedia: (filePaths: string[]) => Promise<void>;
  removeMedia: (mediaId: string) => Promise<void>;
  removeSelectedMedia: () => Promise<void>;
  isMediaInUse: (mediaId: string) => boolean;
  setDraggingMedia: (mediaId: string | null) => void;
  setDragPosition: (position: { x: number; y: number } | null) => void;
  setDragMousePosition: (position: { x: number; y: number } | null) => void;
}

export const useMediaStore = create<MediaState>((set, get) => ({
  selectedMediaIds: [],
  lastSelectedMediaId: null,
  draggingMediaId: null,
  dragPosition: null,
  dragMousePosition: null,

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
    const project = useProjectStore.getState().project;
    if (!project) return;

    try {
      await importMediaFiles(project.id, filePaths);
      // Reload project to get updated media pool from backend
      await useProjectStore.getState().loadProject(project.id);
    } catch (error) {
      console.error('Failed to import media:', error);
    }
  },

  removeMedia: async (mediaId: string) => {
    const project = useProjectStore.getState().project;
    const { selectedMediaIds } = get();
    if (!project) return;

    try {
      const updatedProject = await deleteMedia(project.id, mediaId);
      useProjectStore.getState().setProject(updatedProject);
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

    try {
      // Remove each selected media one by one
      let updatedProject = project;
      for (const mediaId of selectedMediaIds) {
        updatedProject = await deleteMedia(project.id, mediaId);
      }
      useProjectStore.getState().setProject(updatedProject);
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

  setDragMousePosition: (position: { x: number; y: number } | null) => {
    set({ dragMousePosition: position });
  },
}));

