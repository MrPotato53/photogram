/**
 * Content-rotation model (rotating an image INSIDE its upright frame).
 *
 * ── The model ────────────────────────────────────────────────────────
 * State is only the ordinary element properties: the crop window
 * (cropX/Y/W/H, normalized into [0,1]) plus `contentRotation` (degrees).
 *
 *   • The source image is drawn at its natural size for the current crop
 *     scale (`fullBounds`), rotated by `contentRotation` around ITS OWN
 *     CENTER, at scale 1. There is no automatic "cover" inflation.
 *   • The crop window is what must adapt: it is constrained to stay
 *     inside the rotated image. Dragging/resizing the window clamps it;
 *     zooming out (Option+scroll) is bounded by the same condition.
 *   • Changing the rotation angle may require zooming the image in — that
 *     factor is computed once, at rotation time, and folded into the crop
 *     values (so the render stays at scale 1).
 *
 * ── Why it's built this way ──────────────────────────────────────────
 * The required zoom depends ONLY on the window's SIZE, the image's size
 * and the angle — never on the window's POSITION (see
 * `minImageScaleForRotation`). That is what makes dragging the crop
 * rectangle leave the image perfectly still: there is no position term
 * that could feed back into the scale. An earlier model pivoted at the
 * window's center and recomputed a positional cover factor every frame,
 * which made the image swim and rescale while the window was dragged, and
 * made it impossible to shrink the image down onto the window's borders.
 *
 * ── The core geometric fact ──────────────────────────────────────────
 * Inverse-rotating everything by -θ about the image center turns "does
 * the axis-aligned window fit inside the rotated image?" into "does this
 * rotated window fit inside the axis-aligned image rect?". A convex shape
 * lies inside an axis-aligned box exactly when its own bounding box does,
 * so the whole problem reduces to the window's rotated bounding box —
 * which is where the position-independent size term comes from.
 */

const DEG = Math.PI / 180;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Half-extents of the axis-aligned bounding box of a `width`×`height`
 * rectangle rotated by `degrees`. Depends on size and angle only.
 */
export function rotatedWindowExtents(
  width: number,
  height: number,
  degrees: number
): { hx: number; hy: number } {
  const rad = degrees * DEG;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  return {
    hx: (width * cos + height * sin) / 2,
    hy: (width * sin + height * cos) / 2,
  };
}

/**
 * The factor the image must be scaled by so a `windowWidth`×`windowHeight`
 * crop window can fit inside a `fullWidth`×`fullHeight` image rotated by
 * `degrees`.
 *
 * > 1 → the image must be zoomed IN by this much before the window fits.
 * < 1 → there is slack: the image may be shrunk by this much before the
 *       window's corners touch the image's (rotated) edges. This is the
 *       exact "shrink until the edges meet the crop rectangle" limit.
 *
 * Position-independent by construction — see the module header.
 */
export function minImageScaleForRotation(
  fullWidth: number,
  fullHeight: number,
  windowWidth: number,
  windowHeight: number,
  degrees: number
): number {
  if (fullWidth <= 0 || fullHeight <= 0) return 1;
  const { hx, hy } = rotatedWindowExtents(windowWidth, windowHeight, degrees);
  return Math.max((2 * hx) / fullWidth, (2 * hy) / fullHeight);
}

/**
 * Render-time scale for the image, as a safety net only.
 *
 * Well-formed state (everything crop mode produces) already satisfies the
 * fit condition, so this returns exactly 1 and the image draws at its
 * natural size. It rises above 1 only for legacy state that would
 * otherwise show blank corners. Because the underlying factor is
 * position-independent, using it here can never make a window drag move
 * or rescale the image.
 */
export function contentRenderScale(
  fullWidth: number,
  fullHeight: number,
  windowWidth: number,
  windowHeight: number,
  degrees: number
): number {
  if (!degrees) return 1;
  return Math.max(
    1,
    minImageScaleForRotation(fullWidth, fullHeight, windowWidth, windowHeight, degrees)
  );
}

/**
 * Where to place the image node inside the frame-local (clip Group) space
 * so that the crop window lands on the frame, given that the node's offset
 * is the image's own centre.
 *
 * The node's offset being the image centre is what makes the rotation
 * pivot fixed; this returns the matching position so the unrotated result
 * still maps image point `windowX/Y` onto the frame's top-left corner.
 */
export function contentPivotLocalOffset(
  fullWidth: number,
  fullHeight: number,
  windowX: number,
  windowY: number
): { x: number; y: number } {
  return { x: fullWidth / 2 - windowX, y: fullHeight / 2 - windowY };
}

/**
 * Same pivot, expressed in design space for the crop-mode preview, with
 * the element's own canvas rotation composed in.
 *
 * The final renderer nests the image inside a Group that carries
 * `elementRotation`, so the crop offset is rotated by it; crop mode draws
 * the image as a single flat node, so that composition has to be applied
 * explicitly here for the preview to match what Apply will produce.
 */
export function contentPivotDisplay(
  elementX: number,
  elementY: number,
  elementRotation: number,
  fullWidth: number,
  fullHeight: number,
  windowX: number,
  windowY: number
): { x: number; y: number } {
  const local = contentPivotLocalOffset(fullWidth, fullHeight, windowX, windowY);
  if (!elementRotation) return { x: elementX + local.x, y: elementY + local.y };
  const rad = elementRotation * DEG;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: elementX + local.x * cos - local.y * sin,
    y: elementY + local.x * sin + local.y * cos,
  };
}

/**
 * True when every corner of an axis-aligned `rect` lies inside the image
 * rect [0,fullWidth]×[0,fullHeight] rotated by `degrees` about its center.
 * `rect` is expressed in the image's own unrotated coordinate frame.
 */
export function isWindowInsideRotatedImage(
  fullWidth: number,
  fullHeight: number,
  degrees: number,
  rect: Rect,
  epsilon = 1e-6
): boolean {
  const cx = fullWidth / 2;
  const cy = fullHeight / 2;
  const rad = -degrees * DEG;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  for (const [px, py] of [
    [rect.x, rect.y],
    [rect.x + rect.width, rect.y],
    [rect.x + rect.width, rect.y + rect.height],
    [rect.x, rect.y + rect.height],
  ]) {
    const dx = px - cx;
    const dy = py - cy;
    const ix = cx + dx * cos - dy * sin;
    const iy = cy + dx * sin + dy * cos;
    if (
      ix < -epsilon ||
      iy < -epsilon ||
      ix > fullWidth + epsilon ||
      iy > fullHeight + epsilon
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Move `rect` (preserving its size) by the smallest amount that puts it
 * fully inside the rotated image. When the image is too small to contain
 * the window at all, the window is centered — callers should scale the
 * image by `minImageScaleForRotation` first so that never happens.
 *
 * Only the position is touched, so a clamp during a drag reads as the
 * window sliding to a stop against the image's rotated edge.
 */
export function clampWindowToRotatedImage(
  fullWidth: number,
  fullHeight: number,
  degrees: number,
  rect: Rect
): Rect {
  if (!degrees) {
    return {
      ...rect,
      x: Math.max(0, Math.min(rect.x, fullWidth - rect.width)),
      y: Math.max(0, Math.min(rect.y, fullHeight - rect.height)),
    };
  }

  const cx = fullWidth / 2;
  const cy = fullHeight / 2;
  const rad = degrees * DEG;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  // Window center, carried into the image's own (unrotated) frame.
  const wcx = rect.x + rect.width / 2;
  const wcy = rect.y + rect.height / 2;
  const dx = wcx - cx;
  const dy = wcy - cy;
  const imgX = cx + dx * cos + dy * sin;
  const imgY = cy - dx * sin + dy * cos;

  // There, the window is a rotated rect — clamping its bounding box
  // against the image rect is exactly the containment condition.
  const { hx, hy } = rotatedWindowExtents(rect.width, rect.height, degrees);
  const clampedX = hx * 2 > fullWidth ? cx : Math.max(hx, Math.min(imgX, fullWidth - hx));
  const clampedY = hy * 2 > fullHeight ? cy : Math.max(hy, Math.min(imgY, fullHeight - hy));

  // Back to the frame the window is expressed in.
  const bx = clampedX - cx;
  const by = clampedY - cy;
  const finalCx = cx + bx * cos - by * sin;
  const finalCy = cy + bx * sin + by * cos;

  return {
    ...rect,
    x: finalCx - rect.width / 2,
    y: finalCy - rect.height / 2,
  };
}

export interface CropWindow {
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
}

/**
 * Adjust normalized crop values so the window still fits inside the image
 * once it is rotated by `degrees`, zooming the image in only as far as the
 * angle actually requires and re-seating the window inside the tilted quad.
 *
 * This is the one operation that reconciles "an angle changed" with "the
 * crop values must stay valid", and it is shared by every path that can
 * introduce an angle to an existing window: turning the dial in crop mode,
 * and carrying a photo's straighten with it when it is dropped onto a
 * different frame. Output always satisfies the fit condition, so the
 * renderer draws at natural size (asserted by the geometry harness).
 */
export function fitCropToRotation(
  frameWidth: number,
  frameHeight: number,
  crop: CropWindow,
  degrees: number
): CropWindow {
  if (!degrees || frameWidth <= 0 || frameHeight <= 0) return crop;
  if (crop.cropWidth <= 0 || crop.cropHeight <= 0) return crop;

  const fullW = frameWidth / crop.cropWidth;
  const fullH = frameHeight / crop.cropHeight;
  const rect = {
    x: crop.cropX * fullW,
    y: crop.cropY * fullH,
    width: frameWidth,
    height: frameHeight,
  };

  const needed = minImageScaleForRotation(fullW, fullH, frameWidth, frameHeight, degrees);

  if (needed <= 1) {
    const clamped = clampWindowToRotatedImage(fullW, fullH, degrees, rect);
    return { ...crop, cropX: clamped.x / fullW, cropY: clamped.y / fullH };
  }

  // Zoom about the window's centre so the framing stays on the same
  // subject instead of drifting toward a corner.
  const newFullW = fullW * needed;
  const newFullH = fullH * needed;
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  const seated = clampWindowToRotatedImage(newFullW, newFullH, degrees, {
    x: needed * centerX - rect.width / 2,
    y: needed * centerY - rect.height / 2,
    width: rect.width,
    height: rect.height,
  });

  return {
    cropX: seated.x / newFullW,
    cropY: seated.y / newFullH,
    cropWidth: crop.cropWidth / needed,
    cropHeight: crop.cropHeight / needed,
  };
}

/**
 * Re-shape a crop window so it fills a frame of a different aspect ratio,
 * keeping as much of the user's edit as possible.
 *
 * Used when a photo moves between frames (swap): the stored crop was chosen
 * for the OLD frame's shape, and a photo shown in a frame it doesn't match
 * would be stretched. What is preserved:
 *   • the centre — the window stays on the same subject;
 *   • the zoom — the new window is the LARGEST of the required shape that
 *     still fits inside the old one, so the photo never zooms out to reveal
 *     content the user had cropped away, and never samples outside the
 *     image (the result is always a subset of a valid window).
 *
 * `imageWidth`/`imageHeight` are the source's natural pixel dimensions:
 * crop values are normalized against those, so the window's on-screen shape
 * is `(cropWidth·imageWidth) : (cropHeight·imageHeight)`, not
 * `cropWidth : cropHeight`. Ignoring that is what makes non-square sources
 * come out distorted.
 */
export function adaptCropToFrame(
  imageWidth: number,
  imageHeight: number,
  crop: CropWindow,
  frameRatio: number
): CropWindow {
  if (imageWidth <= 0 || imageHeight <= 0 || frameRatio <= 0) return crop;
  if (crop.cropWidth <= 0 || crop.cropHeight <= 0) return crop;

  // Required cropWidth : cropHeight for the window to match the frame.
  const k = (frameRatio * imageHeight) / imageWidth;
  if (!Number.isFinite(k) || k <= 0) return crop;

  // Contain the new shape inside the existing window (never grow).
  let width = crop.cropWidth;
  let height = width / k;
  if (height > crop.cropHeight) {
    height = crop.cropHeight;
    width = height * k;
  }

  const centerX = crop.cropX + crop.cropWidth / 2;
  const centerY = crop.cropY + crop.cropHeight / 2;

  return {
    cropWidth: width,
    cropHeight: height,
    cropX: Math.max(0, Math.min(centerX - width / 2, 1 - width)),
    cropY: Math.max(0, Math.min(centerY - height / 2, 1 - height)),
  };
}

/**
 * Full turns are supported; values are normalized into (-180, 180] by
 * wrapping rather than pinning, so a continuous dial drag rolls over
 * instead of sticking at the ends.
 */
export const CONTENT_ROTATION_MAX = 180;

export function clampContentRotation(deg: number): number {
  if (Number.isNaN(deg)) return 0;
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

/** Snap-to-90° tolerance (degrees) for the crop rotation dial. */
export const ROTATION_SNAP_TOLERANCE = 4;

/**
 * Snaps to the nearest multiple of 90° within ROTATION_SNAP_TOLERANCE,
 * mirroring Konva Transformer's rotationSnaps. Pass-through outside the
 * band. Callers must keep their own unsnapped accumulator — feeding this
 * result back into the accumulator would trap a drag inside the band.
 */
export function snapContentRotation(deg: number): number {
  const nearest = Math.round(deg / 90) * 90;
  return Math.abs(deg - nearest) <= ROTATION_SNAP_TOLERANCE
    ? clampContentRotation(nearest)
    : deg;
}
