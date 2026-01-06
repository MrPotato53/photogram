import { create } from 'zustand';
import { useElementStore } from './elementStore';

interface CropStoreState {
  cropModeElementId: string | null;

  enterCropMode: (elementId: string) => void;
  exitCropMode: () => void;
}

export const useCropStore = create<CropStoreState>((set) => ({
  cropModeElementId: null,

  enterCropMode: (elementId: string) => {
    useElementStore.getState().selectElement(elementId);
    set({ cropModeElementId: elementId });
  },

  exitCropMode: () => {
    set({ cropModeElementId: null });
  },
}));

