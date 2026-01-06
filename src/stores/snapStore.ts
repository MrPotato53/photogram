import { create } from 'zustand';
import type { Guide } from '../types';

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
  margin: { enabled: false, show: false, value: 50 },
  grid: { enabled: false, show: false, horizontal: 3, vertical: 3, margin: 0 },
};

interface SnapStoreState {
  snapEnabled: boolean;
  snapSettings: SnapSettings;
  activeGuides: Guide[];

  setSnapEnabled: (enabled: boolean) => void;
  setActiveGuides: (guides: Guide[]) => void;
  updateSnapSettings: (updates: SnapSettingsUpdate) => void;
}

export const useSnapStore = create<SnapStoreState>((set) => ({
  snapEnabled: true,
  snapSettings: { ...defaultSnapSettings },
  activeGuides: [],

  setSnapEnabled: (enabled: boolean) => {
    set({ snapEnabled: enabled });
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
  },
}));

