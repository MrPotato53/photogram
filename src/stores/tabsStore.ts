import { create } from 'zustand';
import type { Tab } from '../types';

interface TabsState {
  tabs: Tab[];
  activeTabId: string;

  openProject: (projectId: string, projectName: string) => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  goHome: () => void;
  updateProjectName: (projectId: string, newName: string) => void;
}

const HOME_TAB: Tab = {
  id: 'home',
  type: 'home',
};

export const useTabsStore = create<TabsState>((set, get) => ({
  tabs: [HOME_TAB],
  activeTabId: 'home',

  openProject: (projectId, projectName) => {
    const { tabs } = get();

    // Check if project is already open
    const existingTab = tabs.find(
      (t) => t.type === 'project' && t.projectId === projectId
    );

    if (existingTab) {
      set({ activeTabId: existingTab.id });
      return;
    }

    // Create new tab
    const newTab: Tab = {
      id: `project-${projectId}`,
      type: 'project',
      projectId,
      projectName,
    };

    set({
      tabs: [...tabs, newTab],
      activeTabId: newTab.id,
    });
  },

  closeTab: (tabId) => {
    const { tabs, activeTabId } = get();

    // Can't close home tab
    if (tabId === 'home') return;

    const newTabs = tabs.filter((t) => t.id !== tabId);

    // If closing active tab, switch to previous tab or home
    if (activeTabId === tabId) {
      const closedIndex = tabs.findIndex((t) => t.id === tabId);
      const newActiveIndex = Math.max(0, closedIndex - 1);
      set({
        tabs: newTabs,
        activeTabId: newTabs[newActiveIndex]?.id || 'home',
      });
    } else {
      set({ tabs: newTabs });
    }
  },

  setActiveTab: (tabId) => {
    set({ activeTabId: tabId });
  },

  goHome: () => {
    set({ activeTabId: 'home' });
  },

  updateProjectName: (projectId, newName) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.type === 'project' && t.projectId === projectId
          ? { ...t, projectName: newName }
          : t
      ),
    }));
  },
}));
