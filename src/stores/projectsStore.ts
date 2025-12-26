import { create } from 'zustand';
import type { AspectRatio, ProjectSummary } from '../types';
import {
  getAllProjects,
  createProject as apiCreateProject,
  deleteProject as apiDeleteProject,
  renameProject as apiRenameProject,
  importMediaFiles,
} from '../services/tauri';

interface ProjectsState {
  projects: ProjectSummary[];
  isLoading: boolean;
  error: string | null;

  loadProjects: () => Promise<void>;
  createProject: (
    name: string,
    aspectRatio: AspectRatio,
    mediaPaths?: string[]
  ) => Promise<string | null>;
  deleteProject: (id: string) => Promise<void>;
  renameProject: (id: string, newName: string) => Promise<void>;
}

export const useProjectsStore = create<ProjectsState>((set, get) => ({
  projects: [],
  isLoading: true,
  error: null,

  loadProjects: async () => {
    set({ isLoading: true, error: null });
    try {
      const projects = await getAllProjects();
      set({ projects, isLoading: false });
    } catch (error) {
      console.error('Failed to load projects:', error);
      set({ error: String(error), isLoading: false });
    }
  },

  createProject: async (name, aspectRatio, mediaPaths) => {
    try {
      const project = await apiCreateProject(name, aspectRatio);

      // Import media if provided
      if (mediaPaths && mediaPaths.length > 0) {
        await importMediaFiles(project.id, mediaPaths);
      }

      // Reload projects list
      await get().loadProjects();

      return project.id;
    } catch (error) {
      console.error('Failed to create project:', error);
      set({ error: String(error) });
      return null;
    }
  },

  deleteProject: async (id) => {
    try {
      await apiDeleteProject(id);
      set((state) => ({
        projects: state.projects.filter((p) => p.id !== id),
      }));
    } catch (error) {
      console.error('Failed to delete project:', error);
      set({ error: String(error) });
    }
  },

  renameProject: async (id, newName) => {
    try {
      await apiRenameProject(id, newName);
      set((state) => ({
        projects: state.projects.map((p) =>
          p.id === id ? { ...p, name: newName } : p
        ),
      }));
    } catch (error) {
      console.error('Failed to rename project:', error);
      set({ error: String(error) });
    }
  },
}));
