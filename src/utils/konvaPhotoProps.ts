import type { Element } from '../types';
import { contentRenderScale, contentPivotLocalOffset } from './contentRotation';
import { getCropWindow, getFullImageRect, hasCrop } from './photoFraming';

/**
 * Konva props for drawing a photo element — the one description of "what
 * this image looks like", shared by the canvas and the slide thumbnails.
 *
 * There are two structurally different ways to draw a photo:
 *
 *  • `flat` — a single KonvaImage with a `crop` attr. The fast path, used
 *    whenever the image is upright inside its frame.
 *  • `rotated` — the FULL image, rotated about its own centre, inside a
 *    frame-shaped clip. Required because Konva's `crop` cannot sample
 *    outside its window, so a straightened photo needs pixels the stored
 *    window doesn't include.
 *
 * The two renderers used to each decide this for themselves, which is how
 * slide thumbnails ended up ignoring `contentRotation` entirely — a photo
 * straightened on the canvas still showed up crooked in its thumbnail.
 * Anything that draws a photo should go through here so a new property only
 * has to be handled once.
 */

export interface FlatPhotoPlan {
  kind: 'flat';
  image: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    scaleX: number;
    scaleY: number;
    offsetX: number;
    offsetY: number;
    crop?: { x: number; y: number; width: number; height: number };
  };
}

export interface RotatedPhotoPlan {
  kind: 'rotated';
  /** Frame-shaped clip container; clip to (0, 0, width, height). */
  clip: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
  };
  /** Full image, positioned in the clip's local space. */
  image: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    scaleX: number;
    scaleY: number;
    offsetX: number;
    offsetY: number;
  };
}

export type PhotoDrawPlan = FlatPhotoPlan | RotatedPhotoPlan;

/**
 * Build the draw plan for a photo element.
 *
 * `naturalWidth`/`naturalHeight` are the loaded bitmap's pixel dimensions —
 * Konva's `crop` is expressed in source pixels, not normalized units.
 */
export function planPhotoDraw(
  element: Element,
  naturalWidth: number,
  naturalHeight: number
): PhotoDrawPlan {
  const flipScaleX = element.flipX ? -1 : 1;
  const flipScaleY = element.flipY ? -1 : 1;
  const contentRotation = element.contentRotation ?? 0;

  if (contentRotation !== 0) {
    const full = getFullImageRect(element);
    const crop = getCropWindow(element);
    // Window origin in the full image's own pixel space.
    const winX = crop.cropX * full.width;
    const winY = crop.cropY * full.height;
    // Normally exactly 1 — crop mode folds any zoom the angle needs into the
    // crop values. Rises above 1 only to rescue legacy state that would show
    // blank corners, and depends only on sizes and the angle (never on where
    // the window sits), so it can't make the image swim.
    const cover = contentRenderScale(
      full.width,
      full.height,
      element.width,
      element.height,
      contentRotation
    );
    // Pivot is the full image's OWN centre, which is flip-invariant
    // (full.width / 2 === full.width - full.width / 2) — no flip-conditional
    // offset needed here, unlike the flat branch.
    const local = contentPivotLocalOffset(full.width, full.height, winX, winY);

    return {
      kind: 'rotated',
      clip: {
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
        rotation: element.rotation,
      },
      image: {
        x: local.x,
        y: local.y,
        width: full.width,
        height: full.height,
        rotation: contentRotation,
        scaleX: cover * flipScaleX,
        scaleY: cover * flipScaleY,
        offsetX: full.width / 2,
        offsetY: full.height / 2,
      },
    };
  }

  const crop = getCropWindow(element);
  return {
    kind: 'flat',
    image: {
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
      rotation: element.rotation,
      scaleX: flipScaleX,
      scaleY: flipScaleY,
      // Flipping mirrors about the frame's own edge, so the node has to be
      // shifted by a full frame width/height to stay in place.
      offsetX: element.flipX ? element.width : 0,
      offsetY: element.flipY ? element.height : 0,
      crop: hasCrop(element)
        ? {
            x: crop.cropX * naturalWidth,
            y: crop.cropY * naturalHeight,
            width: crop.cropWidth * naturalWidth,
            height: crop.cropHeight * naturalHeight,
          }
        : undefined,
    },
  };
}
