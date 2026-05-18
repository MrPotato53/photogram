// Normalized keystroke string format: "mod+shift+alt+ctrl+key".
// - "mod" = the platform's primary modifier (Cmd on macOS, Ctrl on others)
// - Modifiers always appear in this order so equality is a plain string compare
// - "key" is lowercase: 'a', 't', '.', '/', 'arrowup', 'enter', 'escape',
//   'tab', 'pageup', 'pagedown', 'backspace', 'delete', 'space', etc.
// - Empty string means "no binding" (cleared).
//
// Why "mod" and not "cmd"/"ctrl": stored bindings stay portable across OSes.
// Display layer converts to platform-appropriate glyphs.

export const IS_MAC =
  typeof navigator !== 'undefined' &&
  /Mac|iPod|iPhone|iPad/.test(navigator.platform);

const MOD_ORDER = ['mod', 'shift', 'alt', 'ctrl'] as const;

/**
 * Convert a KeyboardEvent to the normalized binding string.
 * Returns empty string for events that are pure modifier presses.
 */
export function eventToKeystroke(e: KeyboardEvent): string {
  const key = e.key;
  // Ignore lone modifier presses
  if (
    key === 'Meta' || key === 'Control' || key === 'Shift' || key === 'Alt' || key === 'AltGraph'
  ) {
    return '';
  }

  const parts: string[] = [];
  // Treat metaKey as "mod" on Mac, ctrlKey as "mod" elsewhere. If both are
  // pressed on Mac, record ctrl separately (rare but supported).
  const modPressed = IS_MAC ? e.metaKey : e.ctrlKey;
  const ctrlSeparate = IS_MAC && e.ctrlKey;
  if (modPressed) parts.push('mod');
  if (e.shiftKey) parts.push('shift');
  if (e.altKey) parts.push('alt');
  if (ctrlSeparate) parts.push('ctrl');

  parts.push(normalizeKeyName(key));
  return parts.join('+');
}

function normalizeKeyName(key: string): string {
  if (key === ' ') return 'space';
  // Single chars: lowercase
  if (key.length === 1) return key.toLowerCase();
  // Multi-char named keys: lowercase as-is ("ArrowUp" → "arrowup")
  return key.toLowerCase();
}

/** Display the normalized binding using platform-appropriate glyphs. */
export function formatKeystroke(binding: string): string {
  if (!binding) return '';
  const parts = binding.split('+');
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1);

  const fmt: string[] = [];
  if (IS_MAC) {
    for (const m of mods) {
      if (m === 'mod') fmt.push('⌘');
      else if (m === 'shift') fmt.push('⇧');
      else if (m === 'alt') fmt.push('⌥');
      else if (m === 'ctrl') fmt.push('⌃');
    }
    fmt.push(formatKeyName(key));
    return fmt.join('');
  }

  for (const m of mods) {
    if (m === 'mod') fmt.push('Ctrl');
    else if (m === 'shift') fmt.push('Shift');
    else if (m === 'alt') fmt.push('Alt');
    else if (m === 'ctrl') fmt.push('Ctrl');
  }
  fmt.push(formatKeyName(key));
  return fmt.join('+');
}

function formatKeyName(key: string): string {
  switch (key) {
    case 'arrowup': return IS_MAC ? '↑' : 'Up';
    case 'arrowdown': return IS_MAC ? '↓' : 'Down';
    case 'arrowleft': return IS_MAC ? '←' : 'Left';
    case 'arrowright': return IS_MAC ? '→' : 'Right';
    case 'enter': return IS_MAC ? '⏎' : 'Enter';
    case 'escape': return 'Esc';
    case 'tab': return IS_MAC ? '⇥' : 'Tab';
    case 'backspace': return IS_MAC ? '⌫' : 'Backspace';
    case 'delete': return IS_MAC ? '⌦' : 'Delete';
    case 'space': return 'Space';
    case 'pageup': return IS_MAC ? '⇞' : 'PageUp';
    case 'pagedown': return IS_MAC ? '⇟' : 'PageDown';
    default:
      // Letters & punctuation: uppercase letter on Mac (with glyphs),
      // uppercase letter on other platforms too for readability.
      return key.length === 1 ? key.toUpperCase() : key;
  }
}

/**
 * Sort canonical modifier order so two equivalent bindings compare equal.
 * Useful when accepting bindings from external sources (defaults table).
 */
export function canonicalizeBinding(binding: string): string {
  if (!binding) return '';
  const parts = binding.toLowerCase().split('+').filter(Boolean);
  if (parts.length === 0) return '';
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  const ordered = MOD_ORDER.filter((m) => mods.includes(m));
  return [...ordered, key].join('+');
}
