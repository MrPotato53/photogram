/**
 * Routing for OS-level (Finder/Explorer) file drops.
 *
 * Tauri delivers drag-drop to the whole webview, not to a DOM node, so every
 * subscriber sees every drop and each must decide for itself whether the
 * drop was meant for it. With the media pool and the canvas both subscribed
 * and neither checking, a drop over a floating media pool was imported
 * TWICE — two concurrent `import_media_files` calls, the second of which
 * saw the first's filenames already in the pool, imported nothing, and then
 * overwrote the in-memory project with a copy captured before the first
 * finished. Net effect: files on disk, nothing in the pool.
 */

/** Marks the media pool's drop surface. */
export const MEDIA_DROPZONE_ATTR = 'data-media-dropzone';

/**
 * Convert a Tauri drag-drop position to CSS pixels.
 *
 * The payload carries a physical position, which on a HiDPI display is
 * `devicePixelRatio`× the CSS coordinates `elementFromPoint` expects. Rather
 * than assuming a platform convention, detect it: a point outside the CSS
 * viewport but inside the physical one must be physical.
 */
export function toCssPoint(x: number, y: number): { x: number; y: number } {
  const dpr = window.devicePixelRatio || 1;
  if (dpr === 1) return { x, y };

  const cssWidth = document.documentElement.clientWidth;
  const cssHeight = document.documentElement.clientHeight;
  if (x > cssWidth || y > cssHeight) {
    return { x: x / dpr, y: y / dpr };
  }
  return { x, y };
}

/**
 * True when a drag-drop position lands on the media pool's drop surface.
 * Both the pool and the canvas consult this so exactly one of them claims
 * any given drop.
 */
export function isPointerOverMediaPool(x: number, y: number): boolean {
  const point = toCssPoint(x, y);
  const target = document.elementFromPoint(point.x, point.y);
  return !!target?.closest(`[${MEDIA_DROPZONE_ATTR}]`);
}
