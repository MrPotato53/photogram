import { create } from 'zustand';
import type { Preferences } from '../types';
import { getPreferences, savePreferences } from '../services/tauri';
import { useShortcutsStore } from './shortcutsStore';
import { DEFAULT_CANVAS_RESOLUTION } from '../constants/canvasResolutions';

interface PreferencesState {
  preferences: Preferences;
  isLoading: boolean;
  loadPreferences: () => Promise<void>;
  setTheme: (theme: Preferences['theme']) => Promise<void>;
  setSortBy: (sortBy: Preferences['sortBy']) => Promise<void>;
  setDefaultExportResolution: (key: string) => Promise<void>;
  /** Set the on-canvas working resolution (CANVAS_RESOLUTIONS key) + persist. */
  setCanvasResolution: (key: string) => Promise<void>;
  /** Replace the keyboard shortcut overrides + persist. */
  setKeyboardShortcuts: (overrides: Record<string, string>) => Promise<void>;
  /** Replace the user's custom aspect-ratio presets + persist. */
  setCustomAspectRatios: (ratios: Preferences['customAspectRatios']) => Promise<void>;
}

const defaultPreferences: Preferences = {
  theme: 'dark',
  sortBy: 'accessedAt',
  defaultExportResolution: 'instagram2x',
  keyboardShortcuts: {},
  customAspectRatios: [],
  canvasResolution: DEFAULT_CANVAS_RESOLUTION,
};

export const usePreferencesStore = create<PreferencesState>((set, get) => ({
  preferences: defaultPreferences,
  isLoading: true,

  loadPreferences: async () => {
    try {
      const prefs = await getPreferences();
      // Fill defaults for any field missing from older on-disk configs.
      const merged: Preferences = {
        ...defaultPreferences,
        ...prefs,
        defaultExportResolution: prefs.defaultExportResolution || defaultPreferences.defaultExportResolution,
        keyboardShortcuts: prefs.keyboardShortcuts || {},
        customAspectRatios: prefs.customAspectRatios || [],
        canvasResolution: prefs.canvasResolution || defaultPreferences.canvasResolution,
      };
      set({ preferences: merged, isLoading: false });
      applyTheme(merged.theme);
      // Push the persisted overrides into the live shortcut matcher.
      useShortcutsStore.getState().setOverrides(merged.keyboardShortcuts);
    } catch (error) {
      console.error('Failed to load preferences:', error);
      set({ isLoading: false });
      applyTheme(defaultPreferences.theme);
    }
  },

  setTheme: async (theme) => {
    const newPrefs = { ...get().preferences, theme };
    set({ preferences: newPrefs });
    applyTheme(theme);
    try {
      await savePreferences(newPrefs);
    } catch (error) {
      console.error('Failed to save preferences:', error);
    }
  },

  setSortBy: async (sortBy) => {
    const newPrefs = { ...get().preferences, sortBy };
    set({ preferences: newPrefs });
    try {
      await savePreferences(newPrefs);
    } catch (error) {
      console.error('Failed to save preferences:', error);
    }
  },

  setDefaultExportResolution: async (key) => {
    const newPrefs = { ...get().preferences, defaultExportResolution: key };
    set({ preferences: newPrefs });
    try {
      await savePreferences(newPrefs);
    } catch (error) {
      console.error('Failed to save preferences:', error);
    }
  },

  setCanvasResolution: async (key) => {
    const newPrefs = { ...get().preferences, canvasResolution: key };
    set({ preferences: newPrefs });
    try {
      await savePreferences(newPrefs);
    } catch (error) {
      console.error('Failed to save preferences:', error);
    }
  },

  setKeyboardShortcuts: async (overrides) => {
    const newPrefs = { ...get().preferences, keyboardShortcuts: overrides };
    set({ preferences: newPrefs });
    useShortcutsStore.getState().setOverrides(overrides);
    try {
      await savePreferences(newPrefs);
    } catch (error) {
      console.error('Failed to save preferences:', error);
    }
  },

  setCustomAspectRatios: async (ratios) => {
    const newPrefs = { ...get().preferences, customAspectRatios: ratios };
    set({ preferences: newPrefs });
    try {
      await savePreferences(newPrefs);
    } catch (error) {
      console.error('Failed to save preferences:', error);
    }
  },
}));

function applyTheme(theme: Preferences['theme']) {
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}
