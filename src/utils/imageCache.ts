/**
 * Module-level HTMLImageElement cache keyed by resolved URL.
 * Used to preload canvas images asynchronously (e.g. on media-pool drag
 * start) so the drop doesn't block waiting for decode.
 *
 * Bounded LRU: full-resolution photos are large, and an unbounded cache
 * grows for the lifetime of the app. Eviction only drops OUR reference —
 * images currently displayed are also held by useCanvasImages' loadedImages
 * map (and by Konva nodes), so evicting an in-use entry never unloads it
 * from screen; it just means a future re-request decodes again.
 */

const MAX_CACHE_ENTRIES = 64;

const cache = new Map<string, HTMLImageElement>();
const pending = new Map<string, Promise<HTMLImageElement | null>>();

/** Move a key to most-recently-used position and enforce the size bound. */
function touch(url: string, img: HTMLImageElement): void {
  cache.delete(url);
  cache.set(url, img);
  while (cache.size > MAX_CACHE_ENTRIES) {
    // Map iterates in insertion order → first key is least-recently-used
    const oldest = cache.keys().next().value as string;
    cache.delete(oldest);
  }
}

/**
 * Kick off async image load for a URL. Returns a Promise that resolves
 * to the loaded HTMLImageElement, or null on error. Subsequent calls for
 * the same URL return the same Promise / cached image.
 */
export function preloadImage(url: string): Promise<HTMLImageElement | null> {
  const cached = cache.get(url);
  if (cached && cached.complete && cached.naturalWidth > 0) {
    touch(url, cached);
    return Promise.resolve(cached);
  }
  const existing = pending.get(url);
  if (existing) return existing;

  const img = new window.Image();
  img.crossOrigin = 'anonymous';
  const promise = new Promise<HTMLImageElement | null>((resolve) => {
    img.onload = () => {
      touch(url, img);
      pending.delete(url);
      resolve(img);
    };
    img.onerror = () => {
      pending.delete(url);
      resolve(null);
    };
  });
  img.src = url;
  pending.set(url, promise);
  return promise;
}

/**
 * Return a cached HTMLImageElement if already loaded, else null.
 * Never triggers a new load.
 */
export function getCachedImage(url: string): HTMLImageElement | null {
  const img = cache.get(url);
  if (img && img.complete && img.naturalWidth > 0) {
    touch(url, img);
    return img;
  }
  return null;
}

/**
 * Check if a preload is currently in-flight for a URL.
 */
export function isPreloading(url: string): boolean {
  return pending.has(url);
}

/**
 * Drop all cached images. Called when switching to a DIFFERENT project so
 * one project's photos don't stay resident while editing another.
 */
export function clearImageCache(): void {
  cache.clear();
}
