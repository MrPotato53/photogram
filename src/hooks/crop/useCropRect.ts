import { useState, useEffect, useRef } from 'react';

interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface UseCropRectOptions {
  fullBounds: { width: number; height: number };
  existingCropX: number;
  existingCropY: number;
  existingCropW: number;
  existingCropH: number;
  aspectRatio: number | null;
  resetKey?: number;
}

/**
 * Hook for managing crop rectangle state, aspect ratio, and clamping
 */
export function useCropRect({
  fullBounds,
  existingCropX,
  existingCropY,
  existingCropW,
  existingCropH,
  aspectRatio,
  resetKey,
}: UseCropRectOptions) {
  // Track previous aspect ratio to detect swaps
  const prevAspectRatio = useRef<number | null>(null);

  // The crop rectangle in PIXELS relative to the FULL bounds
  const [cropRect, setCropRect] = useState<CropRect>(() => ({
    x: existingCropX * fullBounds.width,
    y: existingCropY * fullBounds.height,
    width: existingCropW * fullBounds.width,
    height: existingCropH * fullBounds.height,
  }));

  // Reset crop rect to full bounds when resetKey changes
  const prevResetKeyRef = useRef(resetKey);
  useEffect(() => {
    if (resetKey !== undefined && resetKey !== prevResetKeyRef.current) {
      setCropRect({
        x: 0,
        y: 0,
        width: fullBounds.width,
        height: fullBounds.height,
      });
    }
    prevResetKeyRef.current = resetKey;
  }, [resetKey, fullBounds.width, fullBounds.height]);

  // Apply aspect ratio when it changes
  useEffect(() => {
    if (aspectRatio === null) {
      prevAspectRatio.current = null;
      return;
    }

    const centerX = cropRect.x + cropRect.width / 2;
    const centerY = cropRect.y + cropRect.height / 2;

    let newWidth: number;
    let newHeight: number;

    // Check if this is a swap (new ratio ≈ 1/old ratio)
    const isSwap = prevAspectRatio.current !== null &&
      Math.abs(aspectRatio - 1 / prevAspectRatio.current) < 0.001;

    if (isSwap) {
      // Swap: exchange width and height, keeping the same area
      newWidth = cropRect.height;
      newHeight = cropRect.width;
    } else {
      // Not a swap: fit within current dimensions
      if (cropRect.width / cropRect.height > aspectRatio) {
        newHeight = cropRect.height;
        newWidth = newHeight * aspectRatio;
      } else {
        newWidth = cropRect.width;
        newHeight = newWidth / aspectRatio;
      }
    }

    // Ensure it fits within full bounds
    if (newWidth > fullBounds.width) {
      newWidth = fullBounds.width;
      newHeight = newWidth / aspectRatio;
    }
    if (newHeight > fullBounds.height) {
      newHeight = fullBounds.height;
      newWidth = newHeight * aspectRatio;
    }

    // Center the new rect
    let newX = centerX - newWidth / 2;
    let newY = centerY - newHeight / 2;

    // Clamp to bounds
    newX = Math.max(0, Math.min(newX, fullBounds.width - newWidth));
    newY = Math.max(0, Math.min(newY, fullBounds.height - newHeight));

    setCropRect({ x: newX, y: newY, width: newWidth, height: newHeight });
    prevAspectRatio.current = aspectRatio;
  }, [aspectRatio, cropRect, fullBounds.width, fullBounds.height]);

  // Clamp crop rect within full bounds
  const clampCropRect = (rect: CropRect): CropRect => {
    const minSize = 20;
    const width = Math.max(minSize, Math.min(rect.width, fullBounds.width));
    const height = Math.max(minSize, Math.min(rect.height, fullBounds.height));
    const x = Math.max(0, Math.min(rect.x, fullBounds.width - width));
    const y = Math.max(0, Math.min(rect.y, fullBounds.height - height));
    return { x, y, width, height };
  };

  // Confirm crop: convert selection to source-normalized coordinates
  const confirmCrop = (onConfirm: (crop: {
    cropX: number;
    cropY: number;
    cropWidth: number;
    cropHeight: number;
    newWidth: number;
    newHeight: number;
  }) => void) => {
    const newCropX = cropRect.x / fullBounds.width;
    const newCropY = cropRect.y / fullBounds.height;
    const newCropW = cropRect.width / fullBounds.width;
    const newCropH = cropRect.height / fullBounds.height;

    onConfirm({
      cropX: newCropX,
      cropY: newCropY,
      cropWidth: newCropW,
      cropHeight: newCropH,
      newWidth: cropRect.width,
      newHeight: cropRect.height,
    });
  };

  return {
    cropRect,
    setCropRect,
    clampCropRect,
    confirmCrop,
  };
}

