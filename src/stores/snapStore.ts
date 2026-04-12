import { create } from 'zustand';
import type { Guide, SnapSettingsData } from '../types';
import { updateProject } from '../services/tauri';

export interface SnapSettings {
  canvas: {
    enabled: boolean;   // Snap to canvas edges and center
    show: boolean;      // Show canvas center guides
  };
  elements: boolean;    // Snap to other element edges and centers
  margin: {
    enabled: boolean;
    show: boolean;      // Show margin guides
    value: number;      // Margin in design pixels
  };
  grid: {
    enabled: boolean;
    show: boolean;      // Show grid guides
    horizontal: number; // Number of horizontal divisions
    vertical: number;   // Number of vertical divisions
    margin: number;     // Gutter/margin between grid cells in pixels
  };
}

// Deep partial type for snap settings updates
export type SnapSettingsUpdate = {
  canvas?: Partial<SnapSettings['canvas']>;
  elements?: boolean;
  margin?: Partial<SnapSettings['margin']>;
  grid?: Partial<SnapSettings['grid']>;
};

const defaultSnapSettings: SnapSettings = {
  canvas: { enabled: true, show: false },
  elements: true,
  margin: { enabled: false, show: false, value: 25 },
  grid: { enabled: false, show: false, horizontal: 3, vertical: 3, margin: 0 },
};

interface SnapStoreState {
  snapEnabled: boolean;
  snapSettings: SnapSettings;
  activeGuides: Guide[];
  fillModeActive: boolean;

  setSnapEnabled: (enabled: boolean) => void;
  setActiveGuides: (guides: Guide[]) => void;
  updateSnapSettings: (updates: SnapSettingsUpdate) => void;
  hydrateFromProject: (data: SnapSettingsData | null | undefined) => void;
  setFillModeActive: (active: boolean) => void;
}

// Lazy getter to avoid circular dependency — set by projectStore on init
let getProjectStore: (() => {
  project: import('../types').Project | null;
  setProjectSilent: (project: import('../types').Project) => void;
}) | null = null;

export function setSnapProjectStoreGetter(getter: typeof getProjectStore) {
  getProjectStore = getter;
}

/**
 * Persist current snap settings into project and save to backend.
 * Debounced and fully async — never blocks UI.
 */
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function persistSnapSettings(snapEnabled: boolean, snapSettings: SnapSettings) {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    if (!getProjectStore) return;
    const { project, setProjectSilent } = getProjectStore();
    if (!project) return;

    const data: SnapSettingsData = {
      snapEnabled,
      canvas: { ...snapSettings.canvas },
      elements: snapSettings.elements,
      margin: { ...snapSettings.margin },
      grid: { ...snapSettings.grid },
    };

    const updated = { ...project, snapSettings: data };
    setProjectSilent(updated);
    updateProject(updated).catch((err) =>
      console.error('Failed to persist snap settings:', err)
    );
  }, 300);
}

export const useSnapStore = create<SnapStoreState>((set, get) => ({
  snapEnabled: true,
  snapSettings: { ...defaultSnapSettings },
  activeGuides: [],
  fillModeActive: false,

  setFillModeActive: (active: boolean) => {
    set({ fillModeActive: active });
  },

  setSnapEnabled: (enabled: boolean) => {
    set({ snapEnabled: enabled });
    const { snapSettings } = get();
    persistSnapSettings(enabled, snapSettings);
  },

  setActiveGuides: (guides: Guide[]) => {
    set({ activeGuides: guides });
  },

  updateSnapSettings: (updates: SnapSettingsUpdate) => {
    set((state) => ({
      snapSettings: {
        ...state.snapSettings,
        ...(updates.elements !== undefined && { elements: updates.elements }),
        canvas: updates.canvas
          ? { ...state.snapSettings.canvas, ...updates.canvas }
          : state.snapSettings.canvas,
        margin: updates.margin
          ? { ...state.snapSettings.margin, ...updates.margin }
          : state.snapSettings.margin,
        grid: updates.grid
          ? { ...state.snapSettings.grid, ...updates.grid }
          : state.snapSettings.grid,
      },
    }));
    const { snapEnabled, snapSettings } = get();
    persistSnapSettings(snapEnabled, snapSettings);
  },

  hydrateFromProject: (data: SnapSettingsData | null | undefined) => {
    if (!data) {
      // No saved settings — use defaults
      set({ snapEnabled: true, snapSettings: { ...defaultSnapSettings } });
      return;
    }
    set({
      snapEnabled: data.snapEnabled,
      snapSettings: {
        canvas: { ...data.canvas },
        elements: data.elements,
        margin: { ...data.margin },
        grid: { ...data.grid },
      },
    });
  },
}));
