import { useEffect } from 'react';
import { usePanelStore, type PanelId } from '../stores/panelStore';
import { useSlideStore } from '../stores/slideStore';

interface UseEditorShortcutsOptions {
  onPreview: () => void;
  onExport: () => void;
}

/**
 * App-level keyboard shortcuts for editor chrome (panels, modals, slide
 * creation). Element-level shortcuts (nudge, duplicate, layer reorder) live
 * in useCanvasKeyboard so the canvas can gate them on selection state.
 *
 * Ignores events while the user is typing in an input or textarea, and while
 * any modifier key other than the one we care about is held — this lets bare
 * letter shortcuts (M/L/S/E) coexist safely with Cmd-letter shortcuts.
 */
export function useEditorShortcuts({ onPreview, onExport }: UseEditorShortcutsOptions) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      const mod = e.metaKey || e.ctrlKey;

      // Cmd+T — new blank slide
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 't') {
        e.preventDefault();
        useSlideStore.getState().addSlide();
        return;
      }

      // Cmd+Shift+T — open template picker
      if (mod && e.shiftKey && !e.altKey && e.key.toLowerCase() === 't') {
        e.preventDefault();
        usePanelStore.getState().setTemplatePickerOpen(true);
        return;
      }

      // Cmd+. — preview
      if (mod && !e.shiftKey && !e.altKey && e.key === '.') {
        e.preventDefault();
        onPreview();
        return;
      }

      // Cmd+E — export
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        onExport();
        return;
      }

      // Bare-letter panel toggles. Guard against any modifier so e.g. Cmd+M
      // (window minimize) and Cmd+L (address bar) aren't captured.
      if (mod || e.shiftKey || e.altKey) return;

      const panelMap: Record<string, PanelId> = {
        m: 'mediaPool',
        l: 'layers',
        s: 'slides',
        e: 'editBar',
      };
      const panelId = panelMap[e.key.toLowerCase()];
      if (panelId) {
        e.preventDefault();
        usePanelStore.getState().togglePanel(panelId);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onPreview, onExport]);
}
