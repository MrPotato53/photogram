import { useCallback } from 'react';
import { useHistoryStore } from '../stores/historyStore';
import { useCropStore } from '../stores/cropStore';

/**
 * Undo/redo for the editor, routed to whichever history stack is in charge.
 *
 * There are two, deliberately: the global project history, and a local one
 * that exists only while crop mode is open so adjusting the crop rectangle
 * doesn't bury the user's real edits under a pile of entries. Which stack
 * applies is a single question — "is crop mode open?" — but it was answered
 * in only one of the two places that can trigger an undo. The keyboard
 * shortcut was crop-aware; the toolbar button was not, so clicking Undo
 * inside crop mode reverted the whole project behind an open crop overlay,
 * and the button's enabled state described the wrong stack.
 *
 * Anything that offers undo/redo should use this hook rather than reaching
 * for a store directly.
 */
export interface EditorHistoryControls {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function useEditorHistory(): EditorHistoryControls {
  const isCropping = useCropStore((s) => s.cropModeElementId !== null);
  const cropIndex = useCropStore((s) => s.cropHistoryIndex);
  const cropLength = useCropStore((s) => s.cropHistory.length);

  const globalCanUndo = useHistoryStore((s) => !s.isUndoRedoInProgress && s.currentIndex > 0);
  const globalCanRedo = useHistoryStore(
    (s) => !s.isUndoRedoInProgress && s.currentIndex < s.entries.length - 1
  );

  // Read crop mode from the store at call time, not from the render-time
  // value: a keyboard shortcut can fire between the state change and the
  // re-render, and undoing against the stack that just closed would apply a
  // stale snapshot.
  const undo = useCallback(() => {
    if (useCropStore.getState().cropModeElementId) {
      useCropStore.getState().undoCropRect();
      return;
    }
    useHistoryStore.getState().undo();
  }, []);

  const redo = useCallback(() => {
    if (useCropStore.getState().cropModeElementId) {
      useCropStore.getState().redoCropRect();
      return;
    }
    useHistoryStore.getState().redo();
  }, []);

  return {
    undo,
    redo,
    canUndo: isCropping ? cropIndex > 0 : globalCanUndo,
    canRedo: isCropping ? cropIndex < cropLength - 1 : globalCanRedo,
  };
}
