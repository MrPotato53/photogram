import type { AspectRatio } from '../types';

/**
 * Fixed design height for consistent element sizing across all slides.
 * All design coordinates are based on this height.
 */
export const DESIGN_HEIGHT = 1080;

/**
 * Calculate design size (width and height) for a given aspect ratio.
 * Height is always DESIGN_HEIGHT (1080px), width is calculated proportionally.
 */
export function getDesignSize(aspectRatio: AspectRatio): { width: number; height: number } {
  return {
    width: DESIGN_HEIGHT * (aspectRatio.width / aspectRatio.height),
    height: DESIGN_HEIGHT,
  };
}

/**
 * Calculate slide width for a given aspect ratio.
 * This is equivalent to getDesignSize(aspectRatio).width but provided for convenience.
 */
export function getSlideWidth(aspectRatio: AspectRatio): number {
  return DESIGN_HEIGHT * (aspectRatio.width / aspectRatio.height);
}

