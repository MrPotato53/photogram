import { useState, useEffect, useRef } from 'react';
import { useCropStore } from '../../stores/cropStore';

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
  // Current element position — pushed into crop history entries so undo
  // can restore both the rect and the underlying element position.
  elementX: number;
  elementY: number;
  // Current element crop values — needed for undo/redo of in-crop scaling
  elementCropX: number;
  elementCropY: number;
  elementCropWidth: number;
  elementCropHeight: number;
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
  elementX,
  elementY,
  elementCropX,
  elementCropY,
  elementCropWidth,
  elementCropHeight,
}: UseCropRectOptions) {
  // Track previous aspect ratio to detect swaps
  const prevAspectRatio = useRef<number | null>(null);
  // Tracks whether the aspect-ratio effect has already run once; used to
  // distinguish the initial mount sync from genuine user ratio changes so
  // history only captures the latter.
  const aspectRatioMountedRef = useRef(false);

  // The crop rectangle in PIXELS relative to the FULL bounds
  const [cropRect, setCropRect] = useState<CropRect>(() => ({
    x: existingCropX * fullBounds.width,
    y: existingCropY * fullBounds.height,
    width: existingCropW * fullBounds.width,
    height: existingCropH * fullBounds.height,
  }));

  // Live refs to current element state so effect-driven pushes
  // (reset/aspect-ratio) include it without adding extra deps.
  const elementPosRef = useRef({ x: elementX, y: elementY });
  elementPosRef.current = { x: elementX, y: elementY };
  const elementCropRef = useRef({ cropX: elementCropX, cropY: elementCropY, cropWidth: elementCropWidth, cropHeight: elementCropHeight });
  elementCropRef.current = { cropX: elementCropX, cropY: elementCropY, cropWidth: elementCropWidth, cropHeight: elementCropHeight };

  // Reset crop rect to full bounds when resetKey changes
  const prevResetKeyRef = useRef(resetKey);
  useEffect(() => {
    if (resetKey !== undefined && resetKey !== prevResetKeyRef.current) {
      const resetRect = {
        x: 0,
        y: 0,
        width: fullBounds.width,
        height: fullBounds.height,
      };
      setCropRect(resetRect);
      useCropStore.getState().pushCropHistory({
        cropRect: resetRect,
        elementX: elementPosRef.current.x,
        elementY: elementPosRef.current.y,
        elementCropX: elementCropRef.current.cropX,
        elementCropY: elementCropRef.current.cropY,
        elementCropWidth: elementCropRef.current.cropWidth,
        elementCropHeight: elementCropRef.current.cropHeight,
      });
    }
    prevResetKeyRef.current = resetKey;
  }, [resetKey, fullBounds.width, fullBounds.height]);

  // Access current cropRect without it being a dependency (avoids infinite loop
  // where handle drags trigger this effect which overrides the drag position)
  const cropRectRef = useRef(cropRect);
  cropRectRef.current = cropRect;

  // Apply aspect ratio ONLY when the ratio value itself changes
  useEffect(() => {
    const isInitialMount = !aspectRatioMountedRef.current;
    aspectRatioMountedRef.current = true;

    if (aspectRatio === null) {
      prevAspectRatio.current = null;
      return;
    }

    // Skip if aspect ratio hasn't actually changed
    if (prevAspectRatio.current !== null && Math.abs(aspectRatio - prevAspectRatio.current) < 0.0001) {
      return;
    }

    const rect = cropRectRef.current;
    const centerX = rect.x + rect.width / 2;
    const centerY = rect.y + rect.height / 2;

    let newWidth: number;
    let newHeight: number;

    // Check if this is a swap (new ratio ≈ 1/old ratio)
    const isSwap = prevAspectRatio.current !== null &&
      Math.abs(aspectRatio - 1 / prevAspectRatio.current) < 0.001;

    if (isSwap) {
      // Swap: exchange width and height, keeping the same area
      newWidth = rect.height;
      newHeight = rect.width;
    } else {
      // Not a swap: fit within current dimensions
      if (rect.width / rect.height > aspectRatio) {
        newHeight = rect.height;
        newWidth = newHeight * aspectRatio;
      } else {
        newWidth = rect.width;
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

    const adjustedRect = { x: newX, y: newY, width: newWidth, height: newHeight };
    setCropRect(adjustedRect);
    // Only push aspect-ratio-triggered changes to history when it's an actual
    // user-initiated ratio change, not the initial mount sync.
    if (!isInitialMount) {
      useCropStore.getState().pushCropHistory({
        cropRect: adjustedRect,
        elementX: elementPosRef.current.x,
        elementY: elementPosRef.current.y,
        elementCropX: elementCropRef.current.cropX,
        elementCropY: elementCropRef.current.cropY,
        elementCropWidth: elementCropRef.current.cropWidth,
        elementCropHeight: elementCropRef.current.cropHeight,
      });
    }
    prevAspectRatio.current = aspectRatio;
  }, [aspectRatio, fullBounds.width, fullBounds.height]);

  // Initialize history with the settled initial rect (deferred so any mount-time
  // aspect-ratio adjustment has already applied).
  useEffect(() => {
    const t = setTimeout(() => {
      useCropStore.getState().initCropHistory({
        cropRect: cropRectRef.current,
        elementX: elementPosRef.current.x,
        elementY: elementPosRef.current.y,
        elementCropX: elementCropRef.current.cropX,
        elementCropY: elementCropRef.current.cropY,
        elementCropWidth: elementCropRef.current.cropWidth,
        elementCropHeight: elementCropRef.current.cropHeight,
      });
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Subscribe to restore signal from the store (undo/redo). Only the rect
  // portion is handled here — element-position restore is handled by the
  // CropOverlay which has access to the element-drag callback.
  const restoreVersion = useCropStore((s) => s.restoreVersion);
  const didMountRef = useRef(false);
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    const target = useCropStore.getState().restoreTarget;
    if (!target) return;
    setCropRect({ ...target.cropRect });
  }, [restoreVersion]);

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

