import { create } from 'zustand';
import type { Project } from '../types';
import { getProject } from '../services/tauri';

interface ProjectState {
  project: Project | null;
  isLoading: boolean;
  error: string | null;

  loadProject: (id: string) => Promise<void>;
  refreshProject: () => Promise<void>;
  setProject: (project: Project) => void;
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
}));

