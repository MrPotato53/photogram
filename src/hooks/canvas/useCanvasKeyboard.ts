import { useEffect } from 'react';
import type { Element } from '../../types';
import { useCropStore } from '../../stores/cropStore';

interface UseCanvasKeyboardOptions {
  selectedElementId: string | null;
  elements: Element[];
  cropModeElementId: string | null;
  onSelectElement: (id: string | null) => void;
  onUpdateElement: (id: string, updates: Partial<Element>) => void;
  onRemoveElement: (id: string) => void;
  onEnterCropMode: (id: string) => void;
  onExitCropMode: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onRestoreCropState?: () => void;
  onCopy?: () => void;
  onPaste?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onDuplicate?: () => void;
  onBringForward?: (id: string) => void;
  onSendBackward?: (id: string) => void;
  onBringToFront?: (id: string) => void;
  onSendToBack?: (id: string) => void;
  onPrevSlide?: () => void;
  onNextSlide?: () => void;
}

/**
 * Hook for handling keyboard shortcuts in the canvas
 */
export function useCanvasKeyboard({
  selectedElementId,
  elements,
  cropModeElementId,
  onSelectElement,
  onUpdateElement,
  onRemoveElement,
  onEnterCropMode,
  onExitCropMode,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onRestoreCropState,
  onCopy,
  onPaste,
  onUndo,
  onRedo,
  onDuplicate,
  onBringForward,
  onSendBackward,
  onBringToFront,
  onSendToBack,
  onPrevSlide,
  onNextSlide,
}: UseCanvasKeyboardOptions) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      // Copy with Cmd/Ctrl + C
      if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
        e.preventDefault();
        if (onCopy) {
          onCopy();
        }
        return;
      }

      // Paste with Cmd/Ctrl + V
      if ((e.metaKey || e.ctrlKey) && e.key === 'v') {
        e.preventDefault();
        if (onPaste) {
          onPaste();
        }
        return;
      }

      // Undo with Cmd/Ctrl + Z (without shift)
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        // In crop mode, operate on the local crop-rect history only.
        // This keeps crop-rect drag/resize/aspect-ratio/reset undoable
        // without touching global project history.
        if (cropModeElementId) {
          useCropStore.getState().undoCropRect();
          return;
        }
        if (onUndo) {
          onUndo();
        }
        return;
      }

      // Redo with Cmd/Ctrl + Shift + Z or Cmd/Ctrl + Y
      if ((e.metaKey || e.ctrlKey) && ((e.key === 'z' && e.shiftKey) || e.key === 'y')) {
        e.preventDefault();
        if (cropModeElementId) {
          useCropStore.getState().redoCropRect();
          return;
        }
        if (onRedo) {
          onRedo();
        }
        return;
      }

      // Duplicate with Cmd/Ctrl + D
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        if (onDuplicate) onDuplicate();
        return;
      }

      // Layer order: Cmd/Ctrl + [ / ] (one step), + Shift for front/back.
      // Checking e.key instead of e.code so the shortcut fires on the
      // resolved bracket character regardless of keyboard layout.
      if ((e.metaKey || e.ctrlKey) && (e.key === ']' || e.key === '[')) {
        e.preventDefault();
        if (!selectedElementId) return;
        const forward = e.key === ']';
        if (e.shiftKey) {
          if (forward) onBringToFront?.(selectedElementId);
          else onSendToBack?.(selectedElementId);
        } else {
          if (forward) onBringForward?.(selectedElementId);
          else onSendBackward?.(selectedElementId);
        }
        return;
      }

      // Prev/next slide: PageUp/PageDown, or Cmd/Ctrl + Arrow left/right.
      // Cmd+Arrow gets precedence over the selection-gated arrow nudge below.
      if (e.key === 'PageUp' || ((e.metaKey || e.ctrlKey) && e.key === 'ArrowLeft')) {
        e.preventDefault();
        onPrevSlide?.();
        return;
      }
      if (e.key === 'PageDown' || ((e.metaKey || e.ctrlKey) && e.key === 'ArrowRight')) {
        e.preventDefault();
        onNextSlide?.();
        return;
      }

      // Tab / Shift+Tab — cycle selection left-to-right through elements,
      // using x (then y as tiebreak). Wraps at either end.
      if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (elements.length === 0) return;
        e.preventDefault();
        const ordered = [...elements].sort((a, b) => a.x - b.x || a.y - b.y);
        const currentIdx = selectedElementId
          ? ordered.findIndex((el) => el.id === selectedElementId)
          : -1;
        const step = e.shiftKey ? -1 : 1;
        const nextIdx = currentIdx === -1
          ? (step === 1 ? 0 : ordered.length - 1)
          : (currentIdx + step + ordered.length) % ordered.length;
        onSelectElement(ordered[nextIdx].id);
        return;
      }

      if (e.key === 'Escape') {
        if (cropModeElementId) {
          // Restore original element state if it was changed during crop mode
          if (onRestoreCropState) {
            onRestoreCropState();
          }
          onExitCropMode();
          return;
        }
        onSelectElement(null);
        return;
      }

      // Zoom with Cmd/Ctrl + Plus/Minus
      if ((e.metaKey || e.ctrlKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        onZoomIn();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '-') {
        e.preventDefault();
        onZoomOut();
        return;
      }
      // Reset zoom with Cmd/Ctrl + 0
      if ((e.metaKey || e.ctrlKey) && e.key === '0') {
        e.preventDefault();
        onResetZoom();
        return;
      }

      // Enter crop mode with 'c' key
      if ((e.key === 'c' || e.key === 'C') && !e.ctrlKey && !e.metaKey) {
        if (selectedElementId && !cropModeElementId) {
          e.preventDefault();
          onEnterCropMode(selectedElementId);
          return;
        }
      }

      if (!selectedElementId) return;

      const element = elements.find((el) => el.id === selectedElementId);
      if (!element || element.locked) return;

      const nudgeAmount = e.shiftKey ? 10 : 1;

      switch (e.key) {
        case 'Backspace':
        case 'Delete':
          e.preventDefault();
          onRemoveElement(selectedElementId);
          break;
        case 'ArrowUp':
          e.preventDefault();
          onUpdateElement(selectedElementId, { y: element.y - nudgeAmount });
          break;
        case 'ArrowDown':
          e.preventDefault();
          onUpdateElement(selectedElementId, { y: element.y + nudgeAmount });
          break;
        case 'ArrowLeft':
          e.preventDefault();
          onUpdateElement(selectedElementId, { x: element.x - nudgeAmount });
          break;
        case 'ArrowRight':
          e.preventDefault();
          onUpdateElement(selectedElementId, { x: element.x + nudgeAmount });
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    selectedElementId,
    elements,
    cropModeElementId,
    onSelectElement,
    onUpdateElement,
    onRemoveElement,
    onEnterCropMode,
    onExitCropMode,
    onZoomIn,
    onZoomOut,
    onResetZoom,
    onRestoreCropState,
    onCopy,
    onPaste,
    onUndo,
    onRedo,
    onDuplicate,
    onBringForward,
    onSendBackward,
    onBringToFront,
    onSendToBack,
    onPrevSlide,
    onNextSlide,
  ]);
}

