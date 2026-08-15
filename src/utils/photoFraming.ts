import type { Element } from '../types';
import type { Bounds } from './coordinates';
import { type CropWindow, fitCropToRotation, adaptCropToFrame } from './contentRotation';

/**
 * How a photo sits inside its frame — the derived values every renderer,
 * drop handler and crop tool needs, in one place.
 *
 * Crop is stored NORMALIZED (0-1) against the source image, while everything
 * on the canvas is in design pixels. Converting between the two is three
 * lines of arithmetic, which is exactly why it kept getting re-typed at each
 * call site; when a new property arrived (`contentRotation`) the copies
 * silently diverged. Every derivation of the form "given an element, where
 * is its image?" belongs here.
 *
 * Pure functions only — no stores, no Konva — so the geometry harness can
 * exercise them directly.
 */

/** Normalized crop window with defaults applied. */
export function getCropWindow(
  element: Pick<Element, 'cropX' | 'cropY' | 'cropWidth' | 'cropHeight'>
): CropWindow {
  return {
    cropX: element.cropX ?? 0,
    cropY: element.cropY ?? 0,
    cropWidth: element.cropWidth ?? 1,
    cropHeight: element.cropHeight ?? 1,
  };
}

/** An untouched, full-frame crop window. */
export const FULL_CROP: CropWindow = { cropX: 0, cropY: 0, cropWidth: 1, cropHeight: 1 };

/** True when the element shows less than the whole source image. */
export function hasCrop(
  element: Pick<Element, 'cropX' | 'cropY' | 'cropWidth' | 'cropHeight'>
): boolean {
  const c = getCropWindow(element);
  return c.cropX > 0 || c.cropY > 0 || c.cropWidth < 1 || c.cropHeight < 1;
}

/**
 * Design-space rect the FULL (uncropped) image would occupy, given that its
 * crop window currently lands exactly on the element's frame.
 *
 * This is the anchor for crop mode (the draggable image behind the crop
 * rectangle), for reset-crop (which must grow the frame back to the whole
 * image without moving the visible content), and for the content-rotation
 * renderer (which draws the full image and clips it).
 */
export function getFullImageRect(
  element: Pick<Element, 'x' | 'y' | 'width' | 'height' | 'cropX' | 'cropY' | 'cropWidth' | 'cropHeight'>
): Bounds {
  const c = getCropWindow(element);
  const width = element.width / c.cropWidth;
  const height = element.height / c.cropHeight;
  return {
    width,
    height,
    x: element.x - c.cropX * width,
    y: element.y - c.cropY * height,
  };
}

/**
 * Centred cover crop: the largest window of the frame's shape that fits
 * inside a `mediaWidth × mediaHeight` source. Nothing is stretched and
 * nothing is letterboxed — the overflowing axis is trimmed evenly on both
 * sides.
 *
 * Degenerate inputs fall back to the full image rather than producing NaN
 * crop values, which Konva would render as an invisible node.
 */
export function coverCrop(
  mediaWidth: number,
  mediaHeight: number,
  frameWidth: number,
  frameHeight: number
): CropWindow {
  if (mediaWidth <= 0 || mediaHeight <= 0 || frameWidth <= 0 || frameHeight <= 0) return FULL_CROP;

  const mediaRatio = mediaWidth / mediaHeight;
  const frameRatio = frameWidth / frameHeight;
  if (!Number.isFinite(mediaRatio) || !Number.isFinite(frameRatio)) return FULL_CROP;

  if (mediaRatio > frameRatio) {
    const cropWidth = frameRatio / mediaRatio;
    return { cropX: (1 - cropWidth) / 2, cropY: 0, cropWidth, cropHeight: 1 };
  }
  if (mediaRatio < frameRatio) {
    const cropHeight = mediaRatio / frameRatio;
    return { cropX: 0, cropY: (1 - cropHeight) / 2, cropWidth: 1, cropHeight };
  }
  return FULL_CROP;
}

export interface FrameCropOptions {
  mediaWidth: number;
  mediaHeight: number;
  frameWidth: number;
  frameHeight: number;
  /** Straighten angle travelling with the photo. Defaults to upright. */
  contentRotation?: number;
  /**
   * Existing crop to carry across. Omit for a fresh cover crop (replace,
   * fill, media-pool drop); pass the source's window to preserve the user's
   * framing and zoom (swap).
   */
  carry?: CropWindow;
}

/**
 * The crop window a photo needs to sit correctly in a frame — the single
 * decision every "put this image in that frame" path goes through.
 *
 * Two steps, in this order:
 *  1. shape the window for the destination frame (fresh cover crop, or the
 *     carried window re-shaped so it doesn't stretch);
 *  2. re-fit for the straighten angle, since step 1 reasons as if the photo
 *     were upright and a tilted window has to shrink to stay inside the image.
 *
 * Getting the order wrong (or skipping step 2) is what produced blank corners
 * on rotated photos after a drop.
 */
export function cropForFrame({
  mediaWidth,
  mediaHeight,
  frameWidth,
  frameHeight,
  contentRotation = 0,
  carry,
}: FrameCropOptions): CropWindow {
  const shaped = carry
    ? adaptCropToFrame(mediaWidth, mediaHeight, carry, frameWidth / frameHeight)
    : coverCrop(mediaWidth, mediaHeight, frameWidth, frameHeight);

  return fitCropToRotation(frameWidth, frameHeight, shaped, contentRotation);
}
