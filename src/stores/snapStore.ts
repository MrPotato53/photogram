import { create } from 'zustand';
import type { Guide, SnapSettingsData } from '../types';
import { updateProject } from '../services/tauri';
import { usePreferencesStore } from './preferencesStore';

// Snap types that have a visible guide line (and thus a remembered visibility).
export type GuideType = 'canvas' | 'margin' | 'grid';

// Immutably patch one guide type's enabled/show without computed keys (keeps
// the SnapSettings union strongly typed).
function patchGuideType(
  s: SnapSettings,
  type: GuideType,
  patch: { enabled?: boolean; show?: boolean }
): SnapSettings {
  switch (type) {
    case 'canvas':
      return { ...s, canvas: { ...s.canvas, ...patch } };
    case 'margin':
      return { ...s, margin: { ...s.margin, ...patch } };
    case 'grid':
      return { ...s, grid: { ...s.grid, ...patch } };
  }
}

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
  replaceModeActive: boolean;

  setSnapEnabled: (enabled: boolean) => void;
  setActiveGuides: (guides: Guide[]) => void;
  updateSnapSettings: (updates: SnapSettingsUpdate) => void;
  /**
   * Toggle a snap type's `enabled`. Disabling also hides its guide; re-enabling
   * restores its guide to the globally-remembered visibility (last state while
   * it was enabled).
   */
  setSnapTypeEnabled: (type: GuideType, enabled: boolean) => void;
  /**
   * Toggle a snap type's guide visibility (the eye button) and remember it
   * globally so re-enabling later restores this state.
   */
  setSnapTypeShow: (type: GuideType, show: boolean) => void;
  hydrateFromProject: (data: SnapSettingsData | null | undefined) => void;
  setFillModeActive: (active: boolean) => void;
  setReplaceModeActive: (active: boolean) => void;
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
  replaceModeActive: false,

  setFillModeActive: (active: boolean) => {
    set({ fillModeActive: active });
  },

  setReplaceModeActive: (active: boolean) => {
    set({ replaceModeActive: active });
  },

  setSnapEnabled: (enabled: boolean) => {
    // Master snap toggle also drives guide visibility: turning it off hides all
    // guides; turning it on restores each enabled type's guide to its remembered
    // visibility. Types whose snap is off stay hidden regardless.
    set((state) => {
      const remembered = usePreferencesStore.getState().preferences.snapGuideVisibility;
      const s = state.snapSettings;
      const showFor = (type: GuideType) =>
        enabled ? (s[type].enabled ? remembered[type] : false) : false;
      return {
        snapEnabled: enabled,
        snapSettings: {
          ...s,
          canvas: { ...s.canvas, show: showFor('canvas') },
          margin: { ...s.margin, show: showFor('margin') },
          grid: { ...s.grid, show: showFor('grid') },
        },
      };
    });
    const { snapSettings } = get();
    persistSnapSettings(enabled, snapSettings);
  },

  setSnapTypeEnabled: (type: GuideType, enabled: boolean) => {
    set((state) => {
      const remembered = usePreferencesStore.getState().preferences.snapGuideVisibility[type];
      // Re-enabling restores the remembered guide visibility; disabling hides it.
      return { snapSettings: patchGuideType(state.snapSettings, type, { enabled, show: enabled ? remembered : false }) };
    });
    const { snapEnabled, snapSettings } = get();
    persistSnapSettings(snapEnabled, snapSettings);
  },

  setSnapTypeShow: (type: GuideType, show: boolean) => {
    // Persist as the remembered visibility (this is a deliberate user choice
    // made while the snap is enabled).
    usePreferencesStore.getState().setSnapGuideVisibility(type, show);
    set((state) => ({ snapSettings: patchGuideType(state.snapSettings, type, { show }) }));
    const { snapEnabled, snapSettings } = get();
    persistSnapSettings(snapEnabled, snapSettings);
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
