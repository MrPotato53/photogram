/**
 * Module-level HTMLImageElement cache keyed by resolved URL.
 * Used to preload canvas images asynchronously (e.g. on media-pool drag
 * start) so the drop doesn't block waiting for decode.
 */

const cache = new Map<string, HTMLImageElement>();
const pending = new Map<string, Promise<HTMLImageElement | null>>();

/**
 * Kick off async image load for a URL. Returns a Promise that resolves
 * to the loaded HTMLImageElement, or null on error. Subsequent calls for
 * the same URL return the same Promise / cached image.
 */
export function preloadImage(url: string): Promise<HTMLImageElement | null> {
  const cached = cache.get(url);
  if (cached && cached.complete && cached.naturalWidth > 0) {
    return Promise.resolve(cached);
  }
  const existing = pending.get(url);
  if (existing) return existing;

  const img = new window.Image();
  img.crossOrigin = 'anonymous';
  const promise = new Promise<HTMLImageElement | null>((resolve) => {
    img.onload = () => {
      cache.set(url, img);
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
  if (img && img.complete && img.naturalWidth > 0) return img;
  return null;
}

/**
 * Check if a preload is currently in-flight for a URL.
 */
export function isPreloading(url: string): boolean {
  return pending.has(url);
}
