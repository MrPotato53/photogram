import { create } from 'zustand';

export type PanelId = 'mediaPool' | 'layers' | 'templates' | 'slides' | 'editBar';

interface PanelState {
  isOpen: boolean;
  width: number;
  height: number;
}

interface PanelStoreState {
  panels: Record<PanelId, PanelState>;

  togglePanel: (panelId: PanelId) => void;
  setPanelSize: (panelId: PanelId, size: { width?: number; height?: number }) => void;
  closePanel: (panelId: PanelId) => void;
}

const defaultPanelState: Record<PanelId, PanelState> = {
  mediaPool: { isOpen: false, width: 300, height: 200 },
  layers: { isOpen: false, width: 250, height: 300 },
  templates: { isOpen: false, width: 280, height: 400 },
  slides: { isOpen: false, width: 0, height: 120 },
  editBar: { isOpen: true, width: 0, height: 44 },
};

export const usePanelStore = create<PanelStoreState>((set) => ({
  panels: { ...defaultPanelState },

  togglePanel: (panelId: PanelId) => {
    set((state) => ({
      panels: {
        ...state.panels,
        [panelId]: {
          ...state.panels[panelId],
          isOpen: !state.panels[panelId].isOpen,
        },
      },
    }));
  },

  setPanelSize: (panelId: PanelId, size: { width?: number; height?: number }) => {
    set((state) => ({
      panels: {
        ...state.panels,
        [panelId]: {
          ...state.panels[panelId],
          ...(size.width !== undefined && { width: size.width }),
          ...(size.height !== undefined && { height: size.height }),
        },
      },
    }));
  },

  closePanel: (panelId: PanelId) => {
    set((state) => ({
      panels: {
        ...state.panels,
        [panelId]: {
          ...state.panels[panelId],
          isOpen: false,
        },
      },
    }));
  },
}));

