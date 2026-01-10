import { create } from 'zustand';
import type { Element } from '../types';

interface ClipboardState {
  clipboardData: Element[] | null;

  copyElements: (elements: Element[]) => void;
  paste: () => Element[] | null;
  hasClipboardData: () => boolean;
  clear: () => void;
}

export const useClipboardStore = create<ClipboardState>((set, get) => ({
  clipboardData: null,

  copyElements: (elements) => {
    set({ clipboardData: elements });
  },

  paste: () => {
    return get().clipboardData;
  },

  hasClipboardData: () => {
    return get().clipboardData !== null && get().clipboardData!.length > 0;
  },

  clear: () => {
    set({ clipboardData: null });
  },
}));
