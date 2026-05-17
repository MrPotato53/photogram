import { create } from 'zustand';
import type { Preferences } from '../types';
import { getPreferences, savePreferences } from '../services/tauri';

interface PreferencesState {
  preferences: Preferences;
  isLoading: boolean;
  loadPreferences: () => Promise<void>;
  setTheme: (theme: Preferences['theme']) => Promise<void>;
  setSortBy: (sortBy: Preferences['sortBy']) => Promise<void>;
  setDefaultExportResolution: (key: string) => Promise<void>;
}

const defaultPreferences: Preferences = {
  theme: 'dark',
  sortBy: 'accessedAt',
  defaultExportResolution: 'instagram2x',
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
      };
      set({ preferences: merged, isLoading: false });
      applyTheme(merged.theme);
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
}));

function applyTheme(theme: Preferences['theme']) {
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}
