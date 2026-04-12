import { create } from 'zustand';
import { importMediaFiles, updateProject } from '../services/tauri';
import { useProjectStore } from './projectStore';

interface MediaState {
  selectedMediaIds: string[];
  lastSelectedMediaId: string | null;
  draggingMediaId: string | null;
  dragPosition: { x: number; y: number } | null;

  selectMedia: (id: string | null, options?: { shift?: boolean; ctrl?: boolean }) => void;
  clearMediaSelection: () => void;
  importMedia: (filePaths: string[]) => Promise<void>;
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
      const newItems = await importMediaFiles(project.id, filePaths);
      // Merge new media into current project without a full reload so
      // UI state (zoom, aspect-ratio toggle, scroll position) is preserved.
      const updatedProject = {
        ...project,
        mediaPool: [...project.mediaPool, ...newItems],
      };
      useProjectStore.getState().setProject(updatedProject, {
        source: 'media',
        actionType: 'add',
      });
    } catch (error) {
      console.error('Failed to import media:', error);
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

