import { useEffect, useMemo, useState } from 'react';
import { Modal } from './common/Modal';
import {
  SHORTCUT_REGISTRY,
  REGISTRY_BY_ID,
  CATEGORY_ORDER,
  type ShortcutAction,
  type ShortcutActionId,
} from '../utils/keyboardShortcuts/registry';
import { eventToKeystroke, formatKeystroke } from '../utils/keyboardShortcuts/keystroke';
import { usePreferencesStore } from '../stores/preferencesStore';
import { useShortcutsStore } from '../stores/shortcutsStore';

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function KeyboardShortcutsModal({ isOpen, onClose }: KeyboardShortcutsModalProps) {
  // Editable working copy of overrides — only persisted when the user actually
  // sets/clears/resets. The live shortcutsStore is updated optimistically so
  // the change takes effect immediately, with a debounced save to disk.
  const overrides = useShortcutsStore((s) => s.overrides);
  const setOverridesPersisted = usePreferencesStore((s) => s.setKeyboardShortcuts);

  const [search, setSearch] = useState('');
  // id currently being recorded; null = no row recording
  const [recordingId, setRecordingId] = useState<ShortcutActionId | null>(null);
  // Pending capture for review (before save). When non-null we show the
  // "press confirm" / "conflict — reassign" affordance for that row.
  const [pending, setPending] = useState<{ id: ShortcutActionId; binding: string } | null>(null);

  // Resolve effective binding for an action (override → default).
  const effectiveBinding = (a: ShortcutAction): string => {
    const override = overrides[a.id];
    return override !== undefined ? override : a.defaultBinding;
  };

  // Build reverse index: binding → action id (only for customizable + active).
  const bindingIndex = useMemo(() => {
    const map = new Map<string, ShortcutActionId>();
    for (const a of SHORTCUT_REGISTRY) {
      const b = effectiveBinding(a);
      if (b) map.set(b, a.id);
    }
    return map;
    // overrides drives this; defaults are static
  }, [overrides]);

  // Listen for the recording row's next non-modifier keystroke.
  useEffect(() => {
    if (!recordingId) return;
    const handler = (e: KeyboardEvent) => {
      // Escape cancels recording (and clears any pending preview).
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setRecordingId(null);
        setPending(null);
        return;
      }
      const keystroke = eventToKeystroke(e);
      if (!keystroke) return;
      e.preventDefault();
      e.stopPropagation();
      setPending({ id: recordingId, binding: keystroke });
      setRecordingId(null);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [recordingId]);

  // Persist the override map (optimistic UI happens via shortcutsStore).
  const commit = (next: Record<string, string>) => {
    void setOverridesPersisted(next);
  };

  const applyBinding = (id: ShortcutActionId, binding: string, replaceConflict = false) => {
    const next = { ...overrides };
    if (replaceConflict) {
      // Clear any other action currently using this binding.
      for (const a of SHORTCUT_REGISTRY) {
        if (a.id === id) continue;
        if (effectiveBinding(a) === binding) {
          // Setting to '' means "explicitly cleared" — distinguishes from
          // "use the default" which would re-introduce the conflict.
          next[a.id] = '';
        }
      }
    }
    next[id] = binding;
    commit(next);
    setPending(null);
  };

  const clearBinding = (id: ShortcutActionId) => {
    const next = { ...overrides, [id]: '' };
    commit(next);
    setPending(null);
  };

  const resetBinding = (id: ShortcutActionId) => {
    const next = { ...overrides };
    delete next[id];
    commit(next);
    setPending(null);
  };

  const resetAll = () => {
    commit({});
    setPending(null);
    setRecordingId(null);
  };

  // Filter + group for display.
  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const groups = new Map<string, ShortcutAction[]>();
    for (const cat of CATEGORY_ORDER) groups.set(cat, []);
    for (const a of SHORTCUT_REGISTRY) {
      if (q && !a.label.toLowerCase().includes(q) && !a.category.toLowerCase().includes(q)) {
        // Also let user search by typed keystroke (e.g. "cmd+t")
        const formatted = formatKeystroke(effectiveBinding(a)).toLowerCase();
        if (!formatted.includes(q)) continue;
      }
      const list = groups.get(a.category) ?? [];
      list.push(a);
      groups.set(a.category, list);
    }
    return Array.from(groups.entries()).filter(([, items]) => items.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, overrides]);

  // Reset transient state when the modal closes.
  useEffect(() => {
    if (!isOpen) {
      setRecordingId(null);
      setPending(null);
      setSearch('');
    }
  }, [isOpen]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Keyboard Shortcuts" size="lg">
      <div className="flex flex-col gap-3 max-h-[70vh]">
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by action, category, or keystroke…"
            className="flex-1 px-3 py-1.5 text-sm bg-theme-bg border border-theme-border rounded text-theme-text placeholder:text-theme-text-muted focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button
            onClick={resetAll}
            className="px-3 py-1.5 text-xs border border-theme-border rounded text-theme-text-muted hover:text-theme-text hover:bg-theme-bg-tertiary transition-colors"
            title="Reset every customized shortcut to its default"
          >
            Reset all
          </button>
        </div>

        <div className="flex-1 overflow-y-auto pr-1 -mr-1">
          {grouped.map(([category, items]) => (
            <div key={category} className="mb-4">
              <div className="text-[11px] uppercase tracking-wide text-theme-text-muted mb-1 px-1">
                {category}
              </div>
              <div className="rounded border border-theme-border divide-y divide-theme-border">
                {items.map((action) => {
                  const isRecording = recordingId === action.id;
                  const isPending = pending?.id === action.id;
                  const current = isPending ? pending!.binding : effectiveBinding(action);
                  const isDefault = !(action.id in overrides);
                  const conflictId =
                    isPending && pending!.binding
                      ? bindingIndex.get(pending!.binding) !== action.id
                        ? bindingIndex.get(pending!.binding) ?? null
                        : null
                      : null;

                  return (
                    <div
                      key={action.id}
                      className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-theme-bg-tertiary/40"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-theme-text truncate">{action.label}</div>
                        {action.alsoDefaults && action.alsoDefaults.length > 0 && (
                          <div className="text-[11px] text-theme-text-muted truncate">
                            also: {action.alsoDefaults.map(formatKeystroke).join(' / ')}
                          </div>
                        )}
                        {isPending && conflictId && (
                          <div className="text-[11px] text-amber-400 mt-0.5">
                            Already bound to "{REGISTRY_BY_ID[conflictId]?.label}".
                          </div>
                        )}
                      </div>

                      {/* Binding pill */}
                      <div className="flex-shrink-0">
                        {isRecording ? (
                          <span className="inline-flex items-center px-2 py-1 rounded bg-blue-500/15 border border-blue-500/40 text-xs text-blue-300">
                            Press keys… (Esc cancels)
                          </span>
                        ) : current ? (
                          <kbd className="inline-flex items-center px-2 py-1 rounded bg-theme-bg border border-theme-border text-xs font-mono text-theme-text">
                            {formatKeystroke(current)}
                          </kbd>
                        ) : (
                          <span className="text-xs text-theme-text-muted italic">unbound</span>
                        )}
                      </div>

                      {/* Actions: only customizable rows get the controls */}
                      <div className="flex-shrink-0 flex items-center gap-1 w-[170px] justify-end">
                        {action.customizable ? (
                          isPending ? (
                            <>
                              <button
                                onClick={() => applyBinding(action.id, pending!.binding, !!conflictId)}
                                className="px-2 py-1 text-xs rounded bg-blue-500 hover:bg-blue-600 text-white transition-colors"
                              >
                                {conflictId ? 'Reassign' : 'Save'}
                              </button>
                              <button
                                onClick={() => setPending(null)}
                                className="px-2 py-1 text-xs rounded border border-theme-border text-theme-text-muted hover:text-theme-text hover:bg-theme-bg-tertiary transition-colors"
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => setRecordingId(action.id)}
                                className="px-2 py-1 text-xs rounded border border-theme-border text-theme-text hover:bg-theme-bg-tertiary transition-colors"
                              >
                                Record
                              </button>
                              {current && (
                                <button
                                  onClick={() => clearBinding(action.id)}
                                  className="px-2 py-1 text-xs rounded text-theme-text-muted hover:text-theme-text hover:bg-theme-bg-tertiary transition-colors"
                                  title="Remove the binding (action stays in the list)"
                                >
                                  Clear
                                </button>
                              )}
                              {!isDefault && (
                                <button
                                  onClick={() => resetBinding(action.id)}
                                  className="px-2 py-1 text-xs rounded text-theme-text-muted hover:text-theme-text hover:bg-theme-bg-tertiary transition-colors"
                                  title="Restore the original default"
                                >
                                  Reset
                                </button>
                              )}
                            </>
                          )
                        ) : (
                          <span className="text-[10px] uppercase tracking-wide text-theme-text-muted/70">
                            built-in
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {grouped.length === 0 && (
            <div className="text-sm text-theme-text-muted text-center py-8">No matches.</div>
          )}
        </div>
      </div>
    </Modal>
  );
}
