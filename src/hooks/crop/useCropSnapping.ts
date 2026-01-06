import { useState, useCallback } from 'react';
import type { Guide } from '../../types';
import type { SnapSettings } from '../../stores/snapStore';
import { calculateSnapLines, findSnap, findTransformSnap } from '../../utils/snapping';
import type { Element } from '../../types';

interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface UseCropSnappingOptions {
  snapEnabled: boolean;
  snapSettings: SnapSettings;
  elements: Element[];
  elementId: string;
  totalDesignWidth: number;
  canvasHeight: number;
  slideWidth: number;
  numSlides: number;
  fullBoundsX: number;
  fullBoundsY: number;
}

/**
 * Hook for managing snap guides and snapping logic in crop overlay
 */
export function useCropSnapping({
  snapEnabled,
  snapSettings,
  elements,
  elementId,
  totalDesignWidth,
  canvasHeight,
  slideWidth,
  numSlides,
  fullBoundsX,
  fullBoundsY,
}: UseCropSnappingOptions) {
  const [activeGuides, setActiveGuides] = useState<Guide[]>([]);

  // Helper to convert crop rect to canvas coordinates
  const cropToCanvas = useCallback((rect: CropRect) => ({
    x: fullBoundsX + rect.x,
    y: fullBoundsY + rect.y,
    width: rect.width,
    height: rect.height,
  }), [fullBoundsX, fullBoundsY]);

  // Helper to convert canvas coordinates back to crop rect coordinates
  const canvasToCrop = useCallback((rect: CropRect) => ({
    x: rect.x - fullBoundsX,
    y: rect.y - fullBoundsY,
    width: rect.width,
    height: rect.height,
  }), [fullBoundsX, fullBoundsY]);

  // Get snap lines for the current context
  const getSnapLines = useCallback(() => {
    return calculateSnapLines(
      elements,
      elementId,
      totalDesignWidth,
      canvasHeight,
      snapSettings,
      slideWidth,
      numSlides
    );
  }, [elements, elementId, totalDesignWidth, canvasHeight, snapSettings, slideWidth, numSlides]);

  // Snap a crop rect (for moving the whole rect)
  const snapCropRect = useCallback((rect: CropRect): { rect: CropRect; guides: Guide[] } => {
    if (!snapEnabled) {
      return { rect, guides: [] };
    }

    const canvasRect = cropToCanvas(rect);
    const snapLines = getSnapLines();
    const snapResult = findSnap(canvasRect, snapLines, 10);

    const snappedCrop = canvasToCrop({
      x: snapResult.x,
      y: snapResult.y,
      width: rect.width,
      height: rect.height,
    });

    return {
      rect: snappedCrop,
      guides: snapResult.guides,
    };
  }, [snapEnabled, cropToCanvas, canvasToCrop, getSnapLines]);

  // Snap a crop rect during transform (for edge/corner handles)
  const snapCropRectTransform = useCallback((
    rect: CropRect,
    anchor: string
  ): { rect: CropRect; guides: Guide[] } => {
    if (!snapEnabled) {
      return { rect, guides: [] };
    }

    const canvasRect = cropToCanvas(rect);
    const snapLines = getSnapLines();
    const snapResult = findTransformSnap(canvasRect, anchor, snapLines, 10);

    const snappedCrop = canvasToCrop({
      x: snapResult.x,
      y: snapResult.y,
      width: snapResult.width,
      height: snapResult.height,
    });

    return {
      rect: snappedCrop,
      guides: snapResult.guides,
    };
  }, [snapEnabled, cropToCanvas, canvasToCrop, getSnapLines]);

  return {
    activeGuides,
    setActiveGuides,
    snapCropRect,
    snapCropRectTransform,
    cropToCanvas,
    canvasToCrop,
    getSnapLines,
  };
}

