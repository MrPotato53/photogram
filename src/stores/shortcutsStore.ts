import { create } from 'zustand';
import {
  SHORTCUT_REGISTRY,
  REGISTRY_BY_ID,
  type ShortcutAction,
  type ShortcutActionId,
} from '../utils/keyboardShortcuts/registry';
import { canonicalizeBinding, eventToKeystroke } from '../utils/keyboardShortcuts/keystroke';

interface ShortcutsState {
  /** id → user-customized binding. Missing entries fall back to the registry default. */
  overrides: Record<string, string>;
  /** Replace all overrides (e.g. on preferences load). */
  setOverrides: (overrides: Record<string, string>) => void;
  /** Set/clear a single binding. Empty string clears the binding entirely
   *  (action remains in the list but no key fires it). */
  setBinding: (id: ShortcutActionId, binding: string) => void;
  /** Remove the override → falls back to the default. */
  resetBinding: (id: ShortcutActionId) => void;
  /** Resolve the live binding for an action. */
  getBinding: (id: ShortcutActionId) => string;
  /** Return action id whose primary OR alternate binding matches this keystroke. */
  matchEvent: (e: KeyboardEvent) => ShortcutActionId | null;
  /** Global open-state for the Keyboard Shortcuts modal. Flipped by the
   *  Cmd+/ handler and by the native menu (via Tauri event). Both HomePage
   *  and EditorLayout render the modal gated on this flag, but only one is
   *  mounted at a time, so there's no duplicate modal. */
  modalOpen: boolean;
  setModalOpen: (open: boolean) => void;
}

export const useShortcutsStore = create<ShortcutsState>((set, get) => ({
  overrides: {},
  modalOpen: false,
  setModalOpen: (open) => set({ modalOpen: open }),

  setOverrides: (overrides) => {
    const cleaned: Record<string, string> = {};
    for (const [k, v] of Object.entries(overrides)) {
      cleaned[k] = canonicalizeBinding(v);
    }
    set({ overrides: cleaned });
  },

  setBinding: (id, binding) => {
    const canonical = canonicalizeBinding(binding);
    set((s) => ({ overrides: { ...s.overrides, [id]: canonical } }));
  },

  resetBinding: (id) => {
    set((s) => {
      const next = { ...s.overrides };
      delete next[id];
      return { overrides: next };
    });
  },

  getBinding: (id) => {
    const override = get().overrides[id];
    if (override !== undefined) return override; // empty string = explicitly cleared
    return REGISTRY_BY_ID[id]?.defaultBinding ?? '';
  },

  matchEvent: (e) => {
    const keystroke = eventToKeystroke(e);
    if (!keystroke) return null;
    const { overrides } = get();
    // Iterate the static list once. Customizable actions consult overrides;
    // read-only ones use defaults. Alternate defaults are honored for
    // read-only entries too (e.g. PageUp / Cmd+Left for prev slide).
    for (const action of SHORTCUT_REGISTRY) {
      const primary = resolveBinding(action, overrides);
      if (primary && primary === keystroke) return action.id;
      if (!action.customizable && action.alsoDefaults) {
        for (const alt of action.alsoDefaults) {
          if (alt === keystroke) return action.id;
        }
      }
    }
    return null;
  },
}));

function resolveBinding(action: ShortcutAction, overrides: Record<string, string>): string {
  const override = overrides[action.id];
  if (override !== undefined) return override;
  return action.defaultBinding;
}
