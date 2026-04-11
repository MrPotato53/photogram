import { create } from 'zustand';
import { useElementStore } from './elementStore';

interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// A local crop-mode history entry captures everything that changes inside
// crop mode: the dashed rectangle AND the underlying element position
// (shift+pan moves the element and the crop rect together). Undo must
// restore both to keep the visual in sync with the image.
export interface CropHistoryEntry {
  cropRect: CropRect;
  elementX: number;
  elementY: number;
}

interface CropStoreState {
  cropModeElementId: string | null;

  // Local crop history (lives only while in crop mode)
  cropHistory: CropHistoryEntry[];
  cropHistoryIndex: number;
  // Signal fields used to notify listeners to apply a restored target
  restoreVersion: number;
  restoreTarget: CropHistoryEntry | null;

  enterCropMode: (elementId: string) => void;
  exitCropMode: () => void;

  initCropHistory: (entry: CropHistoryEntry) => void;
  pushCropHistory: (entry: CropHistoryEntry) => void;
  undoCropRect: () => boolean;
  redoCropRect: () => boolean;
  canUndoCropRect: () => boolean;
  canRedoCropRect: () => boolean;
}

const MAX_CROP_HISTORY = 50;

const entriesEqual = (a: CropHistoryEntry | undefined, b: CropHistoryEntry) =>
  !!a &&
  a.cropRect.x === b.cropRect.x &&
  a.cropRect.y === b.cropRect.y &&
  a.cropRect.width === b.cropRect.width &&
  a.cropRect.height === b.cropRect.height &&
  a.elementX === b.elementX &&
  a.elementY === b.elementY;

const cloneEntry = (e: CropHistoryEntry): CropHistoryEntry => ({
  cropRect: { ...e.cropRect },
  elementX: e.elementX,
  elementY: e.elementY,
});

export const useCropStore = create<CropStoreState>((set, get) => ({
  cropModeElementId: null,
  cropHistory: [],
  cropHistoryIndex: -1,
  restoreVersion: 0,
  restoreTarget: null,

  enterCropMode: (elementId: string) => {
    useElementStore.getState().selectElement(elementId);
    set({
      cropModeElementId: elementId,
      cropHistory: [],
      cropHistoryIndex: -1,
      restoreTarget: null,
    });
  },

  exitCropMode: () => {
    set({
      cropModeElementId: null,
      cropHistory: [],
      cropHistoryIndex: -1,
      restoreTarget: null,
    });
  },

  initCropHistory: (entry: CropHistoryEntry) => {
    set({
      cropHistory: [cloneEntry(entry)],
      cropHistoryIndex: 0,
      restoreTarget: null,
    });
  },

  pushCropHistory: (entry: CropHistoryEntry) => {
    const { cropHistory, cropHistoryIndex } = get();
    if (entriesEqual(cropHistory[cropHistoryIndex], entry)) return;

    // Truncate any redo entries and append
    const truncated = cropHistory.slice(0, cropHistoryIndex + 1);
    truncated.push(cloneEntry(entry));

    const trimmed =
      truncated.length > MAX_CROP_HISTORY
        ? truncated.slice(-MAX_CROP_HISTORY)
        : truncated;

    set({
      cropHistory: trimmed,
      cropHistoryIndex: trimmed.length - 1,
    });
  },

  undoCropRect: () => {
    const { cropHistory, cropHistoryIndex, restoreVersion } = get();
    if (cropHistoryIndex <= 0) return false;
    const targetIndex = cropHistoryIndex - 1;
    set({
      cropHistoryIndex: targetIndex,
      restoreTarget: cloneEntry(cropHistory[targetIndex]),
      restoreVersion: restoreVersion + 1,
    });
    return true;
  },

  redoCropRect: () => {
    const { cropHistory, cropHistoryIndex, restoreVersion } = get();
    if (cropHistoryIndex >= cropHistory.length - 1) return false;
    const targetIndex = cropHistoryIndex + 1;
    set({
      cropHistoryIndex: targetIndex,
      restoreTarget: cloneEntry(cropHistory[targetIndex]),
      restoreVersion: restoreVersion + 1,
    });
    return true;
  },

  canUndoCropRect: () => get().cropHistoryIndex > 0,
  canRedoCropRect: () => {
    const { cropHistory, cropHistoryIndex } = get();
    return cropHistoryIndex < cropHistory.length - 1;
  },
}));
