/**
 * Coordinate system utilities for converting between different coordinate spaces.
 * 
 * Coordinate Spaces:
 * - Design Space: Fixed coordinates based on DESIGN_HEIGHT (1080px per slide)
 *   - Global across all slides (x can be > slideWidth for multi-slide elements)
 *   - Stable regardless of screen size or zoom
 * - Screen Space: Actual pixel coordinates on the screen
 *   - Includes zoom and scale transformations
 *   - Relative to the viewport
 * - Canvas Space: Screen coordinates relative to the canvas/stage
 *   - Accounts for padding and scrolling
 *   - Used for Konva stage operations
 */

/**
 * Convert screen coordinates to design coordinates.
 * @param screenX - X coordinate in screen space (pixels)
 * @param screenY - Y coordinate in screen space (pixels)
 * @param scale - Scale factor (canvasSize.height / DESIGN_HEIGHT)
 * @param zoomLevel - Zoom level multiplier
 * @returns Design coordinates
 */
export function screenToDesign(
  screenX: number,
  screenY: number,
  scale: number,
  zoomLevel: number
): { x: number; y: number } {
  const combinedScale = scale * zoomLevel;
  return {
    x: screenX / combinedScale,
    y: screenY / combinedScale,
  };
}

/**
 * Convert design coordinates to screen coordinates.
 * @param designX - X coordinate in design space
 * @param designY - Y coordinate in design space
 * @param scale - Scale factor (canvasSize.height / DESIGN_HEIGHT)
 * @param zoomLevel - Zoom level multiplier
 * @returns Screen coordinates
 */
export function designToScreen(
  designX: number,
  designY: number,
  scale: number,
  zoomLevel: number
): { x: number; y: number } {
  const combinedScale = scale * zoomLevel;
  return {
    x: designX * combinedScale,
    y: designY * combinedScale,
  };
}

/**
 * Convert canvas coordinates (with padding) to screen coordinates.
 * @param canvasX - X coordinate relative to canvas (includes padding)
 * @param canvasY - Y coordinate relative to canvas (includes padding)
 * @param paddingLeft - Left padding in pixels
 * @param paddingTop - Top padding in pixels
 * @returns Screen coordinates
 */
export function canvasToScreen(
  canvasX: number,
  canvasY: number,
  paddingLeft: number = 0,
  paddingTop: number = 0
): { x: number; y: number } {
  return {
    x: canvasX - paddingLeft,
    y: canvasY - paddingTop,
  };
}

/**
 * Convert screen coordinates to canvas coordinates (with padding).
 * @param screenX - X coordinate in screen space
 * @param screenY - Y coordinate in screen space
 * @param paddingLeft - Left padding in pixels
 * @param paddingTop - Top padding in pixels
 * @returns Canvas coordinates
 */
export function screenToCanvas(
  screenX: number,
  screenY: number,
  paddingLeft: number = 0,
  paddingTop: number = 0
): { x: number; y: number } {
  return {
    x: screenX + paddingLeft,
    y: screenY + paddingTop,
  };
}

/**
 * Convert canvas coordinates directly to design coordinates.
 * Useful when you have canvas coordinates from Konva stage operations.
 * @param canvasX - X coordinate relative to canvas
 * @param canvasY - Y coordinate relative to canvas
 * @param paddingLeft - Left padding in pixels
 * @param paddingTop - Top padding in pixels
 * @param scale - Scale factor (canvasSize.height / DESIGN_HEIGHT)
 * @param zoomLevel - Zoom level multiplier
 * @returns Design coordinates
 */
export function canvasToDesign(
  canvasX: number,
  canvasY: number,
  scale: number,
  zoomLevel: number,
  paddingLeft: number = 0,
  paddingTop: number = 0
): { x: number; y: number } {
  const screen = canvasToScreen(canvasX, canvasY, paddingLeft, paddingTop);
  return screenToDesign(screen.x, screen.y, scale, zoomLevel);
}

/**
 * Convert design coordinates directly to canvas coordinates.
 * @param designX - X coordinate in design space
 * @param designY - Y coordinate in design space
 * @param scale - Scale factor (canvasSize.height / DESIGN_HEIGHT)
 * @param zoomLevel - Zoom level multiplier
 * @param paddingLeft - Left padding in pixels
 * @param paddingTop - Top padding in pixels
 * @returns Canvas coordinates
 */
export function designToCanvas(
  designX: number,
  designY: number,
  scale: number,
  zoomLevel: number,
  paddingLeft: number = 0,
  paddingTop: number = 0
): { x: number; y: number } {
  const screen = designToScreen(designX, designY, scale, zoomLevel);
  return screenToCanvas(screen.x, screen.y, paddingLeft, paddingTop);
}

/**
 * Calculate the scale factor from canvas size to design size.
 * @param canvasHeight - Height of the canvas in pixels
 * @param designHeight - Design height (typically DESIGN_HEIGHT = 1080)
 * @returns Scale factor
 */
export function calculateScale(canvasHeight: number, designHeight: number): number {
  return canvasHeight > 0 ? canvasHeight / designHeight : 1;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Whether a design-space point lands on an element, honouring its
 * rotation.
 *
 * Exact rather than bounding-box based: the point is carried back into the
 * element's own unrotated frame and tested there, so the hit area is the
 * tilted rectangle the user actually sees. A plain [x, x+width] test would
 * report hits on empty canvas beside a rotated element and miss the
 * element itself.
 */
export function isPointInRotatedRect(
  pointX: number,
  pointY: number,
  x: number,
  y: number,
  width: number,
  height: number,
  rotation: number = 0
): boolean {
  let localX = pointX - x;
  let localY = pointY - y;

  if (rotation) {
    const rad = (-rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const rx = localX * cos - localY * sin;
    const ry = localX * sin + localY * cos;
    localX = rx;
    localY = ry;
  }

  return localX >= 0 && localX <= width && localY >= 0 && localY <= height;
}

/**
 * Axis-aligned bounding box, in design space, of an element rotated by
 * `rotation` degrees.
 *
 * Elements rotate around their top-left anchor (x, y) — Konva's default
 * with no offset — so the visual footprint of a rotated element is NOT
 * [x, x+width]×[y, y+height]. At 90°, for instance, it sits entirely to
 * the LEFT of x. Anything reasoning about where an element visually is —
 * snap lines, snap targets, on-canvas drag limits — must use this box, or
 * it will be off by up to a full dimension.
 *
 * At rotation 0 this returns exactly { x, y, width, height }.
 */
export function getRotatedBounds(
  x: number,
  y: number,
  width: number,
  height: number,
  rotation: number = 0
): Bounds {
  if (!rotation) return { x, y, width, height };

  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const [px, py] of [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ]) {
    const rx = px * cos - py * sin;
    const ry = px * sin + py * cos;
    if (rx < minX) minX = rx;
    if (rx > maxX) maxX = rx;
    if (ry < minY) minY = ry;
    if (ry > maxY) maxY = ry;
  }

  return {
    x: x + minX,
    y: y + minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

