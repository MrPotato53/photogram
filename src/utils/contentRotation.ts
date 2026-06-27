/**
 * Content-rotation helpers (rotating an image INSIDE its upright frame).
 *
 * Model: the element's crop window (cropX/Y/W/H — axis-aligned in source
 * space) is displayed in the frame as before, then the content is rotated
 * by `contentRotation` degrees around the frame center and uniformly scaled
 * up just enough that the rotated content still covers the entire frame.
 *
 * Because the scale factor guarantees the frame's inverse-mapped sampling
 * region stays inside the crop window (which itself is inside the source
 * image), rotation can never reveal blank corners or sample outside the
 * source — no clamping anywhere else is needed.
 */

/**
 * Minimum uniform scale so a W×H rect, rotated by `degrees` around its
 * center, still covers an upright W×H rect.
 *
 * Derivation: the upright frame, inverse-rotated into content space, has
 * bounding box (W·|cosθ| + H·|sinθ|) × (W·|sinθ| + H·|cosθ|). Scaling the
 * content by s shrinks the sampled region by 1/s; covering requires the
 * bounding box / s to fit inside W×H.
 */
export function coverScaleForRotation(width: number, height: number, degrees: number): number {
  if (!degrees || width <= 0 || height <= 0) return 1;
  const rad = (Math.abs(degrees) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const neededW = width * cos + height * sin;
  const neededH = width * sin + height * cos;
  return Math.max(neededW / width, neededH / height);
}

/** Clamp a content rotation to the supported straighten range. */
export const CONTENT_ROTATION_MAX = 45;
export function clampContentRotation(deg: number): number {
  if (Number.isNaN(deg)) return 0;
  return Math.max(-CONTENT_ROTATION_MAX, Math.min(CONTENT_ROTATION_MAX, deg));
}
