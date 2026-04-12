import { create } from 'zustand';
import type { Project } from '../types';
import type { HistoryOperationContext } from '../types/history';
import { getProject } from '../services/tauri';
import { useHistoryStore, setCurrentProjectId, setProjectStoreGetter } from './historyStore';
import { useSnapStore, setSnapProjectStoreGetter } from './snapStore';

interface ProjectState {
  project: Project | null;
  isLoading: boolean;
  error: string | null;

  loadProject: (id: string) => Promise<void>;
  refreshProject: () => Promise<void>;
  setProject: (project: Project, context?: HistoryOperationContext) => void;
  setProjectSilent: (project: Project) => void;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: null,
  isLoading: true,
  error: null,

  loadProject: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const project = await getProject(id);
      set({ project, isLoading: false });

      // Hydrate snap settings from persisted project data
      useSnapStore.getState().hydrateFromProject(project.snapSettings);

      // Set project ID for asset retention
      setCurrentProjectId(project.id);

      // Clear history and initialize with current state
      useHistoryStore.getState().clear();
      useHistoryStore.getState().pushState(project, {
        source: 'element',
        actionType: 'add',
      });
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
      // Note: refresh doesn't add to history (it's a sync, not user action)
    } catch (error) {
      console.error('Failed to refresh project:', error);
    }
  },

  setProject: (project: Project, context?: HistoryOperationContext) => {
    set({ project });

    // Track in history if context is provided
    if (context) {
      useHistoryStore.getState().pushState(project, context);
    }
  },

  // Set project without tracking in history (for undo/redo operations)
  setProjectSilent: (project: Project) => {
    set({ project });
  },
}));

// Register getter for circular dependency with historyStore
setProjectStoreGetter(() => ({
  project: useProjectStore.getState().project,
  setProjectSilent: useProjectStore.getState().setProjectSilent,
}));

// Register getter for snapStore persistence
setSnapProjectStoreGetter(() => ({
  project: useProjectStore.getState().project,
  setProjectSilent: useProjectStore.getState().setProjectSilent,
}));

