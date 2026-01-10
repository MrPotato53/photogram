import { useEffect } from 'react';
import type { Element } from '../../types';

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
  ]);
}

