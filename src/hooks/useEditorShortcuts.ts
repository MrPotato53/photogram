import { useEffect } from 'react';
import { usePanelStore, type PanelId } from '../stores/panelStore';
import { useSlideStore } from '../stores/slideStore';
import { useShortcutsStore } from '../stores/shortcutsStore';
import type { ShortcutActionId } from '../utils/keyboardShortcuts/registry';

interface UseEditorShortcutsOptions {
  onPreview: () => void;
  onExport: () => void;
  onOpenShortcuts: () => void;
}

/**
 * App-level keyboard shortcuts for editor chrome (panels, modals, slide
 * creation, opening the shortcuts modal). Element-level shortcuts (nudge,
 * duplicate, layer reorder) still live in useCanvasKeyboard so the canvas
 * can gate them on selection state.
 *
 * Bindings come from the shortcuts registry (with user overrides applied),
 * which means changing a binding in the modal takes effect immediately —
 * no need to re-render handlers.
 */
export function useEditorShortcuts({ onPreview, onExport, onOpenShortcuts }: UseEditorShortcutsOptions) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      const actionId = useShortcutsStore.getState().matchEvent(e);
      if (!actionId) return;

      const handler = HANDLERS[actionId];
      if (!handler) return;

      e.preventDefault();
      handler({ onPreview, onExport, onOpenShortcuts });
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onPreview, onExport, onOpenShortcuts]);
}

interface HandlerContext {
  onPreview: () => void;
  onExport: () => void;
  onOpenShortcuts: () => void;
}

// Map editor-level action ids to their handlers. Canvas-level ids are
// intentionally absent — those are handled inside useCanvasKeyboard which
// gates on selection state and is still hardcoded for that reason.
const HANDLERS: Partial<Record<ShortcutActionId, (ctx: HandlerContext) => void>> = {
  newSlide: () => useSlideStore.getState().addSlide(),
  newSlideFromTemplate: () => usePanelStore.getState().setTemplatePickerOpen(true),
  preview: (ctx) => ctx.onPreview(),
  export: (ctx) => ctx.onExport(),
  openShortcuts: (ctx) => ctx.onOpenShortcuts(),
  'togglePanel.mediaPool': () => usePanelStore.getState().togglePanel('mediaPool' as PanelId),
  'togglePanel.layers': () => usePanelStore.getState().togglePanel('layers' as PanelId),
  'togglePanel.slides': () => usePanelStore.getState().togglePanel('slides' as PanelId),
  'togglePanel.editBar': () => usePanelStore.getState().togglePanel('editBar' as PanelId),
  duplicateCurrentSlide: () => {
    const idx = useSlideStore.getState().currentSlideIndex;
    void useSlideStore.getState().duplicateSlide(idx);
  },
  deleteCurrentSlide: () => {
    const idx = useSlideStore.getState().currentSlideIndex;
    void useSlideStore.getState().removeSlide(idx);
  },
};
