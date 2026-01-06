import type { Element } from '../types';

/**
 * Calculate which slide index an element's X position belongs to.
 * @param elementX - Element's X position in design coordinates
 * @param slideWidth - Width of a single slide in design coordinates
 * @returns Slide index (0-based)
 */
export function getSlideIndex(elementX: number, slideWidth: number): number {
  return Math.floor(elementX / slideWidth);
}

/**
 * Calculate the slide index based on an element's center X position.
 * @param elementX - Element's X position in design coordinates
 * @param elementWidth - Element's width
 * @param slideWidth - Width of a single slide in design coordinates
 * @returns Slide index (0-based)
 */
export function getSlideIndexFromCenter(elementX: number, elementWidth: number, slideWidth: number): number {
  const centerX = elementX + elementWidth / 2;
  return getSlideIndex(centerX, slideWidth);
}

/**
 * Get the X coordinate range for a specific slide.
 * @param slideIndex - Slide index (0-based)
 * @param slideWidth - Width of a single slide in design coordinates
 * @returns Object with startX and endX
 */
export function getSlideBounds(slideIndex: number, slideWidth: number): { startX: number; endX: number } {
  const startX = slideIndex * slideWidth;
  return {
    startX,
    endX: startX + slideWidth,
  };
}

/**
 * Filter elements that belong to a specific slide.
 * An element belongs to a slide if its center X position falls within the slide's bounds.
 * @param elements - Array of elements
 * @param slideIndex - Slide index (0-based)
 * @param slideWidth - Width of a single slide in design coordinates
 * @returns Array of elements on the specified slide
 */
export function getElementsOnSlide(
  elements: Element[],
  slideIndex: number,
  slideWidth: number
): Element[] {
  const { startX, endX } = getSlideBounds(slideIndex, slideWidth);
  return elements.filter((el) => {
    const elCenterX = el.x + el.width / 2;
    return elCenterX >= startX && elCenterX < endX;
  });
}

/**
 * Convert an element's global X coordinate to slide-relative X coordinate.
 * @param globalX - Element's X position in global design coordinates
 * @param slideIndex - Slide index (0-based)
 * @param slideWidth - Width of a single slide in design coordinates
 * @returns X position relative to the slide (0 to slideWidth)
 */
export function toSlideRelativeX(globalX: number, slideIndex: number, slideWidth: number): number {
  const slideStartX = slideIndex * slideWidth;
  return globalX - slideStartX;
}

/**
 * Convert a slide-relative X coordinate to global X coordinate.
 * @param slideRelativeX - X position relative to the slide (0 to slideWidth)
 * @param slideIndex - Slide index (0-based)
 * @param slideWidth - Width of a single slide in design coordinates
 * @returns X position in global design coordinates
 */
export function toGlobalX(slideRelativeX: number, slideIndex: number, slideWidth: number): number {
  const slideStartX = slideIndex * slideWidth;
  return slideStartX + slideRelativeX;
}

