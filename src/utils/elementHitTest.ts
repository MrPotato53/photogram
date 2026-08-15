import type { Element } from '../types';
import { isPointInRotatedRect } from './coordinates';

/**
 * "Which element is under the cursor?" — one z-ordered, rotation-exact
 * lookup for every drop target.
 *
 * Each drop mode (fill, replace, swap) used to carry its own copy of this
 * loop. They fell out of step: two tested the point against the element's
 * true rotated quad while the third still compared against an axis-aligned
 * box, so holding F over a tilted frame highlighted and filled a frame the
 * cursor was not actually over. Add a mode by passing a predicate, not by
 * writing another loop.
 */

/** Photos that actually hold an image — valid replace and swap partners. */
export function isPhotoWithMedia(element: Element): boolean {
  return element.type === 'photo' && !!element.mediaId;
}

/**
 * Empty frames — valid fill targets, and valid swap partners: trading with
 * one moves the image across and leaves an empty frame behind.
 */
export function isEmptyFrame(element: Element): boolean {
  return element.type === 'placeholder';
}

/** Anything a dragged image can be dropped onto. */
export function isDropTarget(element: Element): boolean {
  return isPhotoWithMedia(element) || isEmptyFrame(element);
}

export interface HitTestOptions {
  /** Which elements are eligible. */
  match: (element: Element) => boolean;
  /** Skip this element — normally the one being dragged. */
  excludeId?: string;
}

/**
 * Topmost matching element containing a design-space point, or null.
 *
 * Topmost means highest `zIndex`, matching what the user sees when frames
 * overlap. The containment test honours `rotation`, so a tilted frame is
 * hittable where it is drawn rather than where its upright box would be.
 */
export function findTopmostElementAt(
  elements: Element[],
  designX: number,
  designY: number,
  { match, excludeId }: HitTestOptions
): Element | null {
  let best: Element | null = null;

  // Single pass keeping the highest zIndex — cheaper than sorting a copy of
  // the whole element list on every mousemove during a drag.
  for (const element of elements) {
    if (excludeId && element.id === excludeId) continue;
    if (best && element.zIndex <= best.zIndex) continue;
    if (!match(element)) continue;
    if (
      !isPointInRotatedRect(
        designX,
        designY,
        element.x,
        element.y,
        element.width,
        element.height,
        element.rotation
      )
    ) {
      continue;
    }
    best = element;
  }

  return best;
}
