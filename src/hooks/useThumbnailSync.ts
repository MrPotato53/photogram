import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useMediaStore, type ThumbnailUpdate } from '../stores/mediaStore';

/**
 * Keeps the in-memory media pool in step with thumbnails the backend
 * generates in the background (import fast/quality passes, the resolution
 * backfill in `get_project`, relink).
 *
 * Mount ONCE for the editing session. Two things this fixes about the
 * previous arrangement, where the media pool panel owned the subscription:
 *
 *  • the panel only bumped a local cache-bust counter and never wrote the
 *    generated `thumbnailPath` back into the project, so media imported into
 *    an open project stayed on the loading placeholder indefinitely — the
 *    paths only appeared after a reopen, when `get_project` re-read them
 *    from disk;
 *  • the subscription was re-registered on every `mediaPool` change, i.e.
 *    on every batch it received. `listen` is async, so each re-registration
 *    opened a window with no listener attached and dropped whatever landed
 *    in it — the more images imported, the more updates went missing.
 */
export function useThumbnailSync(): void {
  useEffect(() => {
    // Read the action from the store rather than closing over it, so this
    // subscription is created exactly once and never torn down mid-import.
    const unlistenPromise = listen<ThumbnailUpdate[]>('thumbnails-ready', (event) => {
      const updates = Array.isArray(event.payload) ? event.payload : [];
      useMediaStore.getState().applyThumbnailUpdates(updates);
    });

    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);
}
