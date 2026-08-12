import { useEffect, useRef } from 'react';
import { usePanelStore, type PanelId } from '../stores/panelStore';
import { useSlideStore } from '../stores/slideStore';
import { useShortcutsStore } from '../stores/shortcutsStore';
import { useElementStore } from '../stores/elementStore';
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
  // Keys held down while a canvas drag was running. They stay swallowed
  // until physically released — the drag ending must not hand a still-held
  // key back to the chrome shortcuts. Without this, holding S to swap fires
  // the slides-panel toggle repeatedly the moment the drop completes, since
  // the key is still down and auto-repeat keeps delivering keydown events.
  const swallowedKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      const key = e.key.toLowerCase();
      if (swallowedKeysRef.current.has(key)) return;

      // Chrome shortcuts stay out of the way of an in-progress element drag:
      // during a drag the canvas owns the keyboard for its modifiers (F fill,
      // R replace, S swap).
      if (useElementStore.getState().isDraggingElement) {
        swallowedKeysRef.current.add(key);
        return;
      }

      // Auto-repeat should never drive a toggle — holding a key is not a
      // request to flip a panel dozens of times.
      if (e.repeat) return;

      const actionId = useShortcutsStore.getState().matchEvent(e);
      if (!actionId) return;

      const handler = HANDLERS[actionId];
      if (!handler) return;

      e.preventDefault();
      handler({ onPreview, onExport, onOpenShortcuts });
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      swallowedKeysRef.current.delete(e.key.toLowerCase());
    };
    // Keyup can be missed entirely if focus leaves mid-press; drop the
    // latch on blur so a key can never stay swallowed forever.
    const handleBlur = () => swallowedKeysRef.current.clear();

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
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
