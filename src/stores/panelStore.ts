import { create } from 'zustand';

export type PanelId = 'mediaPool' | 'layers' | 'templates' | 'slides' | 'editBar';

interface PanelState {
  isOpen: boolean;
  // Floating (popped-out) size. Docked size is tracked separately in
  // `dockedWidth` so resizing one form never disturbs the other — popping in
  // returns to the pre-pop-out docked width regardless of floating resizes.
  width: number;
  height: number;
  // Docked width (docked panels are always full sidebar height).
  dockedWidth: number;
}

interface PanelStoreState {
  panels: Record<PanelId, PanelState>;
  mediaPoolDocked: boolean;
  layersDocked: boolean;
  // Media pool thumbnail zoom. Lives here (not as MediaPoolPanel local state)
  // so it survives the unmount/remount when the panel pops out or docks.
  mediaPoolZoom: number;
  // Template picker modal. Lives here (not in a component) so the Cmd+Shift+T
  // shortcut wired in EditorLayout can open it without lifting state up.
  templatePickerOpen: boolean;

  togglePanel: (panelId: PanelId) => void;
  setPanelSize: (panelId: PanelId, size: { width?: number; height?: number }) => void;
  setDockedWidth: (panelId: PanelId, width: number) => void;
  resetDockedSize: (panelId: PanelId) => void;
  closePanel: (panelId: PanelId) => void;
  setMediaPoolDocked: (docked: boolean) => void;
  setLayersDocked: (docked: boolean) => void;
  setMediaPoolZoom: (zoom: number) => void;
  setTemplatePickerOpen: (open: boolean) => void;
}

const defaultPanelState: Record<PanelId, PanelState> = {
  mediaPool: { isOpen: true, width: 280, height: 200, dockedWidth: 280 },
  layers: { isOpen: false, width: 250, height: 300, dockedWidth: 250 },
  templates: { isOpen: false, width: 280, height: 400, dockedWidth: 280 },
  slides: { isOpen: false, width: 0, height: 120, dockedWidth: 0 },
  editBar: { isOpen: true, width: 0, height: 44, dockedWidth: 0 },
};

export const usePanelStore = create<PanelStoreState>((set) => ({
  panels: { ...defaultPanelState },
  mediaPoolDocked: true,
  layersDocked: true,
  mediaPoolZoom: 1,
  templatePickerOpen: false,

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

  setDockedWidth: (panelId: PanelId, width: number) => {
    set((state) => ({
      panels: {
        ...state.panels,
        [panelId]: { ...state.panels[panelId], dockedWidth: width },
      },
    }));
  },

  resetDockedSize: (panelId: PanelId) => {
    set((state) => ({
      panels: {
        ...state.panels,
        [panelId]: {
          ...state.panels[panelId],
          dockedWidth: defaultPanelState[panelId].dockedWidth,
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

  setMediaPoolDocked: (docked: boolean) => {
    set({ mediaPoolDocked: docked });
  },

  setLayersDocked: (docked: boolean) => {
    set({ layersDocked: docked });
  },

  setMediaPoolZoom: (zoom: number) => {
    set({ mediaPoolZoom: zoom });
  },

  setTemplatePickerOpen: (open: boolean) => {
    set({ templatePickerOpen: open });
  },
}));
