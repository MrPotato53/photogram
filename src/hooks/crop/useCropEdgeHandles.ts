import { useRef, useCallback } from 'react';
import type Konva from 'konva';

interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface UseCropEdgeHandlesOptions {
  cropRect: CropRect;
  setCropRect: (rect: CropRect) => void;
  aspectRatio: number | null;
  fullBounds: { width: number; height: number };
  handleSize: number;
  clampCropRect: (rect: CropRect) => CropRect;
  snapCropRectTransform: (rect: CropRect, anchor: string) => { rect: CropRect; guides: any[] };
  setActiveGuides: (guides: any[]) => void;
  getHandlePosition: (edge: 'top' | 'bottom' | 'left' | 'right', rect: CropRect) => { x: number; y: number };
}

/**
 * Hook for managing edge handle dragging in crop overlay
 */
export function useCropEdgeHandles({
  cropRect,
  setCropRect,
  aspectRatio,
  fullBounds,
  handleSize,
  clampCropRect,
  snapCropRectTransform,
  setActiveGuides,
  getHandlePosition,
}: UseCropEdgeHandlesOptions) {
  // Track croprect at beginning of drag for absolute positioning
  const dragSnapshot = useRef<{
    rect: CropRect;
    centerX: number;
    centerY: number;
  } | null>(null);

  const handleDragStart = useCallback(() => {
    dragSnapshot.current = {
      rect: { ...cropRect },
      centerX: cropRect.x + cropRect.width / 2,
      centerY: cropRect.y + cropRect.height / 2,
    };
  }, [cropRect]);

  const handleEdgeDrag = useCallback((
    edge: 'top' | 'bottom' | 'left' | 'right',
    e: Konva.KonvaEventObject<MouseEvent>
  ) => {
    const node = e.target;
    const snapshot = dragSnapshot.current;
    if (!snapshot) return;

    const snapRect = snapshot.rect;
    let newRect = { ...snapRect };

    if (aspectRatio !== null) {
      // Locked mode: edge drag maintains aspect ratio
      const isHorizontal = edge === 'left' || edge === 'right';

      if (isHorizontal) {
        const rightEdge = snapRect.x + snapRect.width;
        let newWidth: number;
        let newX = snapRect.x;

        if (edge === 'left') {
          const dragX = node.x() + handleSize / 4;
          newX = Math.max(0, Math.min(dragX, rightEdge - 20));
          newWidth = rightEdge - newX;
        } else {
          const dragX = node.x() + handleSize / 4;
          newWidth = Math.max(20, Math.min(dragX - snapRect.x, fullBounds.width - snapRect.x));
        }

        let newHeight = newWidth / aspectRatio;
        const centerY = snapshot.centerY;
        let newY = centerY - newHeight / 2;

        if (newY < 0) {
          newY = 0;
          newHeight = Math.min(newHeight, fullBounds.height);
          newWidth = newHeight * aspectRatio;
          if (edge === 'left') newX = rightEdge - newWidth;
        }
        if (newY + newHeight > fullBounds.height) {
          newY = fullBounds.height - newHeight;
          if (newY < 0) {
            newY = 0;
            newHeight = fullBounds.height;
            newWidth = newHeight * aspectRatio;
          }
          if (edge === 'left') newX = rightEdge - newWidth;
        }

        newRect = { x: newX, y: newY, width: newWidth, height: newHeight };
      } else {
        const bottomEdge = snapRect.y + snapRect.height;
        let newHeight: number;
        let newY = snapRect.y;

        if (edge === 'top') {
          const dragY = node.y() + handleSize / 4;
          newY = Math.max(0, Math.min(dragY, bottomEdge - 20));
          newHeight = bottomEdge - newY;
        } else {
          const dragY = node.y() + handleSize / 4;
          newHeight = Math.max(20, Math.min(dragY - snapRect.y, fullBounds.height - snapRect.y));
        }

        let newWidth = newHeight * aspectRatio;
        const centerX = snapshot.centerX;
        let newX = centerX - newWidth / 2;

        if (newX < 0) {
          newX = 0;
          newWidth = Math.min(newWidth, fullBounds.width);
          newHeight = newWidth / aspectRatio;
          if (edge === 'top') newY = bottomEdge - newHeight;
        }
        if (newX + newWidth > fullBounds.width) {
          newX = fullBounds.width - newWidth;
          if (newX < 0) {
            newX = 0;
            newWidth = fullBounds.width;
            newHeight = newWidth / aspectRatio;
          }
          if (edge === 'top') newY = bottomEdge - newHeight;
        }

        newRect = { x: newX, y: newY, width: newWidth, height: newHeight };
      }
    } else {
      // Free mode: edges only adjust single dimension
      switch (edge) {
        case 'left': {
          const dragX = node.x() + handleSize / 4;
          const rightEdge = snapRect.x + snapRect.width;
          const newX = Math.max(0, Math.min(dragX, rightEdge - 20));
          newRect = { ...snapRect, x: newX, width: rightEdge - newX };
          break;
        }
        case 'right': {
          const dragX = node.x() + handleSize / 4;
          const newWidth = Math.max(20, Math.min(dragX - snapRect.x, fullBounds.width - snapRect.x));
          newRect = { ...snapRect, width: newWidth };
          break;
        }
        case 'top': {
          const dragY = node.y() + handleSize / 4;
          const bottomEdge = snapRect.y + snapRect.height;
          const newY = Math.max(0, Math.min(dragY, bottomEdge - 20));
          newRect = { ...snapRect, y: newY, height: bottomEdge - newY };
          break;
        }
        case 'bottom': {
          const dragY = node.y() + handleSize / 4;
          const newHeight = Math.max(20, Math.min(dragY - snapRect.y, fullBounds.height - snapRect.y));
          newRect = { ...snapRect, height: newHeight };
          break;
        }
      }
    }

    // Apply snapping
    const snapResult = snapCropRectTransform(newRect, edge);
    newRect = snapResult.rect;
    setActiveGuides(snapResult.guides);

    const clamped = clampCropRect(newRect);
    setCropRect(clamped);

    // Update snapshot
    dragSnapshot.current = {
      rect: { ...clamped },
      centerX: clamped.x + clamped.width / 2,
      centerY: clamped.y + clamped.height / 2,
    };

    // Reset handle position
    const handlePos = getHandlePosition(edge, clamped);
    const isHorizontal = edge === 'left' || edge === 'right';
    node.x(handlePos.x - (isHorizontal ? handleSize / 4 : handleSize));
    node.y(handlePos.y - (isHorizontal ? handleSize : handleSize / 4));
  }, [
    aspectRatio,
    fullBounds,
    handleSize,
    clampCropRect,
    snapCropRectTransform,
    setActiveGuides,
    setCropRect,
    getHandlePosition,
  ]);

  const handleEdgeDragEnd = useCallback(() => {
    dragSnapshot.current = null;
  }, []);

  return {
    handleDragStart,
    handleEdgeDrag,
    handleEdgeDragEnd,
  };
}

