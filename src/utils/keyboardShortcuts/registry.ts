import { canonicalizeBinding } from './keystroke';

// Action IDs are stable strings. Categories group the modal display. The
// `customizable` flag gates whether the UI offers record/clear; non-
// customizable rows are read-only (currently the canvas shortcuts, which
// still live in useCanvasKeyboard with hardcoded handlers).
//
// Adding a new customizable action:
//   1. Add an entry below
//   2. Read its current binding via shortcutsStore.getBinding(id)
//   3. Wire the action in a handler (e.g. useEditorShortcuts)
//
// Adding a no-default customizable action: leave defaultBinding empty.

export type ShortcutActionId =
  // Editor menus
  | 'newSlide'
  | 'newSlideFromTemplate'
  | 'preview'
  | 'export'
  | 'openShortcuts'
  // Panel toggles
  | 'togglePanel.mediaPool'
  | 'togglePanel.layers'
  | 'togglePanel.slides'
  | 'togglePanel.editBar'
  // No-default (customizable, unbound by default)
  | 'duplicateCurrentSlide'
  | 'deleteCurrentSlide'
  // Canvas (read-only — these are still handled by useCanvasKeyboard's
  // hardcoded matchers; included here for transparency)
  | 'canvas.copy'
  | 'canvas.paste'
  | 'canvas.undo'
  | 'canvas.redo'
  | 'canvas.duplicate'
  | 'canvas.bringForward'
  | 'canvas.sendBackward'
  | 'canvas.bringToFront'
  | 'canvas.sendToBack'
  | 'canvas.prevSlide'
  | 'canvas.nextSlide'
  | 'canvas.cycleNext'
  | 'canvas.cyclePrev'
  | 'canvas.deselect'
  | 'canvas.zoomIn'
  | 'canvas.zoomOut'
  | 'canvas.resetZoom'
  | 'canvas.enterCrop'
  | 'canvas.deleteSelected'
  | 'canvas.nudgeUp'
  | 'canvas.nudgeDown'
  | 'canvas.nudgeLeft'
  | 'canvas.nudgeRight';

export interface ShortcutAction {
  id: ShortcutActionId;
  category: string;
  label: string;
  /** Default normalized binding, e.g. "mod+t". Empty = no default. */
  defaultBinding: string;
  /** When false, the modal renders this row read-only. */
  customizable: boolean;
  /** Secondary defaults (shown as "also") — typically alternative keys. */
  alsoDefaults?: string[];
}

const REGISTRY_RAW: ShortcutAction[] = [
  // ── Project ──
  { id: 'newSlide', category: 'Project', label: 'New blank slide', defaultBinding: 'mod+t', customizable: true },
  { id: 'newSlideFromTemplate', category: 'Project', label: 'New slide from template…', defaultBinding: 'mod+shift+t', customizable: true },
  { id: 'preview', category: 'Project', label: 'Preview', defaultBinding: 'mod+.', customizable: true },
  { id: 'export', category: 'Project', label: 'Export…', defaultBinding: 'mod+e', customizable: true },
  { id: 'openShortcuts', category: 'Project', label: 'Keyboard shortcuts…', defaultBinding: 'mod+/', customizable: true },
  { id: 'duplicateCurrentSlide', category: 'Project', label: 'Duplicate current slide', defaultBinding: '', customizable: true },
  { id: 'deleteCurrentSlide', category: 'Project', label: 'Delete current slide', defaultBinding: '', customizable: true },

  // ── Panels ──
  { id: 'togglePanel.mediaPool', category: 'Panels', label: 'Toggle Media Pool', defaultBinding: 'm', customizable: true },
  { id: 'togglePanel.layers', category: 'Panels', label: 'Toggle Layers', defaultBinding: 'l', customizable: true },
  { id: 'togglePanel.slides', category: 'Panels', label: 'Toggle Slides', defaultBinding: 's', customizable: true },
  { id: 'togglePanel.editBar', category: 'Panels', label: 'Toggle Edit Bar', defaultBinding: 'e', customizable: true },

  // ── Canvas (read-only) ──
  { id: 'canvas.copy', category: 'Canvas', label: 'Copy selected', defaultBinding: 'mod+c', customizable: false },
  { id: 'canvas.paste', category: 'Canvas', label: 'Paste', defaultBinding: 'mod+v', customizable: false },
  { id: 'canvas.duplicate', category: 'Canvas', label: 'Duplicate selected', defaultBinding: 'mod+d', customizable: false },
  { id: 'canvas.undo', category: 'Canvas', label: 'Undo', defaultBinding: 'mod+z', customizable: false },
  { id: 'canvas.redo', category: 'Canvas', label: 'Redo', defaultBinding: 'mod+shift+z', customizable: false, alsoDefaults: ['mod+y'] },
  { id: 'canvas.bringForward', category: 'Canvas', label: 'Bring forward one layer', defaultBinding: 'mod+]', customizable: false },
  { id: 'canvas.sendBackward', category: 'Canvas', label: 'Send backward one layer', defaultBinding: 'mod+[', customizable: false },
  { id: 'canvas.bringToFront', category: 'Canvas', label: 'Bring to front', defaultBinding: 'mod+shift+]', customizable: false },
  { id: 'canvas.sendToBack', category: 'Canvas', label: 'Send to back', defaultBinding: 'mod+shift+[', customizable: false },
  { id: 'canvas.prevSlide', category: 'Canvas', label: 'Previous slide', defaultBinding: 'pageup', customizable: false, alsoDefaults: ['mod+arrowleft'] },
  { id: 'canvas.nextSlide', category: 'Canvas', label: 'Next slide', defaultBinding: 'pagedown', customizable: false, alsoDefaults: ['mod+arrowright'] },
  { id: 'canvas.cycleNext', category: 'Canvas', label: 'Cycle selection forward', defaultBinding: 'tab', customizable: false },
  { id: 'canvas.cyclePrev', category: 'Canvas', label: 'Cycle selection backward', defaultBinding: 'shift+tab', customizable: false },
  { id: 'canvas.deselect', category: 'Canvas', label: 'Deselect / exit mode', defaultBinding: 'escape', customizable: false },
  { id: 'canvas.zoomIn', category: 'Canvas', label: 'Zoom in', defaultBinding: 'mod+=', customizable: false },
  { id: 'canvas.zoomOut', category: 'Canvas', label: 'Zoom out', defaultBinding: 'mod+-', customizable: false },
  { id: 'canvas.resetZoom', category: 'Canvas', label: 'Reset zoom', defaultBinding: 'mod+0', customizable: false },
  { id: 'canvas.enterCrop', category: 'Canvas', label: 'Enter crop mode', defaultBinding: 'c', customizable: false },
  { id: 'canvas.deleteSelected', category: 'Canvas', label: 'Delete selected element', defaultBinding: 'backspace', customizable: false, alsoDefaults: ['delete'] },
  { id: 'canvas.nudgeUp', category: 'Canvas', label: 'Nudge up (Shift = 10px)', defaultBinding: 'arrowup', customizable: false },
  { id: 'canvas.nudgeDown', category: 'Canvas', label: 'Nudge down (Shift = 10px)', defaultBinding: 'arrowdown', customizable: false },
  { id: 'canvas.nudgeLeft', category: 'Canvas', label: 'Nudge left (Shift = 10px)', defaultBinding: 'arrowleft', customizable: false },
  { id: 'canvas.nudgeRight', category: 'Canvas', label: 'Nudge right (Shift = 10px)', defaultBinding: 'arrowright', customizable: false },
];

// Canonicalize every default once at module load so runtime comparisons skip
// the work. (e.g. "shift+mod+t" → "mod+shift+t".)
export const SHORTCUT_REGISTRY: ShortcutAction[] = REGISTRY_RAW.map((a) => ({
  ...a,
  defaultBinding: canonicalizeBinding(a.defaultBinding),
  alsoDefaults: a.alsoDefaults?.map(canonicalizeBinding),
}));

export const REGISTRY_BY_ID: Record<string, ShortcutAction> = Object.fromEntries(
  SHORTCUT_REGISTRY.map((a) => [a.id, a])
);

/** Ordered categories for modal display. */
export const CATEGORY_ORDER = ['Project', 'Panels', 'Canvas'] as const;
