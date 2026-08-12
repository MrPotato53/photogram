import { updateProject } from './tauri';
import { useProjectStore } from '../stores/projectStore';

/**
 * Debounced backend persistence for high-frequency project mutations
 * (element drag ends, keyboard nudges). The in-memory store is already
 * updated optimistically by the caller; this only coalesces the disk
 * writes — previously every nudge keypress serialized and wrote the entire
 * project JSON.
 *
 * The flush always writes the LATEST store state (not a captured project),
 * so a pending write can never resurrect state older than what any other
 * code path has persisted in the meantime.
 */

let timer: ReturnType<typeof setTimeout> | null = null;
const PERSIST_DEBOUNCE_MS = 500;

export function schedulePersistProject(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(flushPersistProject, PERSIST_DEBOUNCE_MS);
}

/**
 * Write the current project state immediately and cancel any pending
 * debounced write. Call before anything that assumes the backend matches
 * the store (project switch, entering crop mode — crop cancel relies on
 * the backend still holding the pre-crop state).
 */
export function flushPersistProject(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const project = useProjectStore.getState().project;
  if (!project) return;
  updateProject(project).catch((error) => {
    console.error('Failed to persist project:', error);
  });
}

/** True if a debounced write is pending (exposed for flush-on-exit paths). */
export function hasPendingPersist(): boolean {
  return timer !== null;
}

// Best-effort flush when the window closes with a write still pending.
// The async IPC may not complete during unload, but the debounce window is
// only 500ms so the worst-case loss is the very last edit.
window.addEventListener('beforeunload', () => {
  if (timer) flushPersistProject();
});
