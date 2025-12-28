import { useState, useEffect, useRef, useCallback } from 'react';
import { Group, Rect, Line } from 'react-konva';
import type Konva from 'konva';
import type { Element, Guide } from '../../types';
import type { SnapSettings } from '../../stores/editorStore';
import { calculateSnapLines, findSnap, findTransformSnap } from '../../utils/snapping';

interface CropOverlayProps {
  element: Element;
  // Full bounds = what the element would be if showing the entire source image at current scale
  fullBounds: { width: number; height: number };
  // Aspect ratio to apply (w/h). When changed, crop rect is resized to fit this ratio.
  aspectRatio: number | null;
  onCropConfirm: (crop: {
    cropX: number;
    cropY: number;
    cropWidth: number;
    cropHeight: number;
    newWidth: number;
    newHeight: number;
  }) => void;
  onCancel: () => void;
  // Snapping context
  snapEnabled: boolean;
  snapSettings: SnapSettings;
  elements: Element[];
  totalDesignWidth: number;
  canvasHeight: number;
  slideWidth: number;
  numSlides: number;
}

export function CropOverlay({
  element,
  fullBounds,
  aspectRatio,
  onCropConfirm,
  onCancel,
  snapEnabled,
  snapSettings,
  elements,
  totalDesignWidth,
  canvasHeight,
  slideWidth,
  numSlides,
}: CropOverlayProps) {
  // Store the existing crop values
  const existingCropX = element.cropX ?? 0;
  const existingCropY = element.cropY ?? 0;
  const existingCropW = element.cropWidth ?? 1;
  const existingCropH = element.cropHeight ?? 1;

  // Track shift key for proportional resizing
  const isShiftPressed = useRef(false);

  // Track previous aspect ratio to detect swaps
  const prevAspectRatio = useRef<number | null>(null);

  // Active snap guides during crop operations
  const [activeGuides, setActiveGuides] = useState<Guide[]>([]);

  // Calculate full bounds position in canvas coordinates
  const fullBoundsX = element.x - existingCropX * fullBounds.width;
  const fullBoundsY = element.y - existingCropY * fullBounds.height;

  // Helper to convert crop rect to canvas coordinates
  const cropToCanvas = useCallback((rect: { x: number; y: number; width: number; height: number }) => ({
    x: fullBoundsX + rect.x,
    y: fullBoundsY + rect.y,
    width: rect.width,
    height: rect.height,
  }), [fullBoundsX, fullBoundsY]);

  // Helper to convert canvas coordinates back to crop rect coordinates
  const canvasToCrop = useCallback((rect: { x: number; y: number; width: number; height: number }) => ({
    x: rect.x - fullBoundsX,
    y: rect.y - fullBoundsY,
    width: rect.width,
    height: rect.height,
  }), [fullBoundsX, fullBoundsY]);

  // Get snap lines for the current context (excluding the element being cropped)
  const getSnapLines = useCallback(() => {
    return calculateSnapLines(
      elements,
      element.id,
      totalDesignWidth,
      canvasHeight,
      snapSettings,
      slideWidth,
      numSlides
    );
  }, [elements, element.id, totalDesignWidth, canvasHeight, snapSettings, slideWidth, numSlides]);

  // The crop rectangle in PIXELS relative to the FULL bounds (not just current element)
  // This allows expanding the crop back to show more of the image
  const [cropRect, setCropRect] = useState(() => ({
    // Current crop position within full bounds
    x: existingCropX * fullBounds.width,
    y: existingCropY * fullBounds.height,
    // Current crop size (which equals element size when properly scaled)
    width: existingCropW * fullBounds.width,
    height: existingCropH * fullBounds.height,
  }));

  // Track shift key state
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') isShiftPressed.current = true;
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') isShiftPressed.current = false;
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

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
        // Current is wider than target, constrain by height
        newHeight = cropRect.height;
        newWidth = newHeight * aspectRatio;
      } else {
        // Current is taller than target, constrain by width
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
  }, [aspectRatio]);

  // Handle size
  const handleSize = 12;
  const handleColor = '#ffffff';
  const handleStroke = '#3b82f6';

  // Clamp crop rect within full bounds (allows expanding to show more of original image)
  const clampCropRect = (rect: typeof cropRect) => {
    const minSize = 20;
    // First clamp width and height to valid ranges
    const width = Math.max(minSize, Math.min(rect.width, fullBounds.width));
    const height = Math.max(minSize, Math.min(rect.height, fullBounds.height));
    // Then clamp x and y so the crop rect stays within full bounds
    const x = Math.max(0, Math.min(rect.x, fullBounds.width - width));
    const y = Math.max(0, Math.min(rect.y, fullBounds.height - height));
    return { x, y, width, height };
  };

  // Confirm crop: convert selection to source-normalized coordinates
  const confirmCrop = () => {
    // The cropRect is in pixels relative to fullBounds
    // Convert to normalized (0-1) coordinates relative to source
    const newCropX = cropRect.x / fullBounds.width;
    const newCropY = cropRect.y / fullBounds.height;
    const newCropW = cropRect.width / fullBounds.width;
    const newCropH = cropRect.height / fullBounds.height;

    // The new element dimensions equal the crop rect size
    // (since fullBounds represents the image at current scale)
    onCropConfirm({
      cropX: newCropX,
      cropY: newCropY,
      cropWidth: newCropW,
      cropHeight: newCropH,
      newWidth: cropRect.width,
      newHeight: cropRect.height,
    });
  };

  // Handle edge handle drag
  // When aspect ratio is locked, edges also maintain the ratio (scaling proportionally from opposite edge)
  // When free (aspectRatio is null), edges only adjust single dimension
  const handleEdgeDrag = (edge: 'top' | 'bottom' | 'left' | 'right', e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target;
    let newRect = { ...cropRect };

    if (aspectRatio !== null) {
      // Locked mode: edge drag maintains aspect ratio
      // Scale proportionally from the opposite edge
      const isHorizontal = edge === 'left' || edge === 'right';

      if (isHorizontal) {
        // Dragging left/right: width changes, height adjusts proportionally
        const rightEdge = cropRect.x + cropRect.width;
        let newWidth: number;
        let newX = cropRect.x;

        if (edge === 'left') {
          const dragX = node.x();
          newX = Math.max(0, Math.min(dragX, rightEdge - 20));
          newWidth = rightEdge - newX;
        } else {
          newWidth = Math.max(20, Math.min(node.x() - cropRect.x, fullBounds.width - cropRect.x));
        }

        // Calculate new height to maintain aspect ratio
        let newHeight = newWidth / aspectRatio;

        // Center the height change around the current vertical center
        const centerY = cropRect.y + cropRect.height / 2;
        let newY = centerY - newHeight / 2;

        // Clamp to bounds and readjust if needed
        if (newY < 0) {
          newY = 0;
          newHeight = Math.min(newHeight, fullBounds.height);
          newWidth = newHeight * aspectRatio;
          if (edge === 'left') newX = rightEdge - newWidth;
        }
        if (newY + newHeight > fullBounds.height) {
          newHeight = fullBounds.height - newY;
          newWidth = newHeight * aspectRatio;
          if (edge === 'left') newX = rightEdge - newWidth;
        }

        newRect = { x: newX, y: newY, width: newWidth, height: newHeight };
      } else {
        // Dragging top/bottom: height changes, width adjusts proportionally
        const bottomEdge = cropRect.y + cropRect.height;
        let newHeight: number;
        let newY = cropRect.y;

        if (edge === 'top') {
          const dragY = node.y();
          newY = Math.max(0, Math.min(dragY, bottomEdge - 20));
          newHeight = bottomEdge - newY;
        } else {
          newHeight = Math.max(20, Math.min(node.y() - cropRect.y, fullBounds.height - cropRect.y));
        }

        // Calculate new width to maintain aspect ratio
        let newWidth = newHeight * aspectRatio;

        // Center the width change around the current horizontal center
        const centerX = cropRect.x + cropRect.width / 2;
        let newX = centerX - newWidth / 2;

        // Clamp to bounds and readjust if needed
        if (newX < 0) {
          newX = 0;
          newWidth = Math.min(newWidth, fullBounds.width);
          newHeight = newWidth / aspectRatio;
          if (edge === 'top') newY = bottomEdge - newHeight;
        }
        if (newX + newWidth > fullBounds.width) {
          newWidth = fullBounds.width - newX;
          newHeight = newWidth / aspectRatio;
          if (edge === 'top') newY = bottomEdge - newHeight;
        }

        newRect = { x: newX, y: newY, width: newWidth, height: newHeight };
      }
    } else {
      // Free mode: edges only adjust single dimension
      switch (edge) {
        case 'left': {
          const newX = node.x();
          const rightEdge = cropRect.x + cropRect.width;
          newRect = {
            ...cropRect,
            x: Math.max(0, Math.min(newX, rightEdge - 20)),
            width: rightEdge - Math.max(0, Math.min(newX, rightEdge - 20)),
          };
          break;
        }
        case 'right': {
          const newWidth = node.x() - cropRect.x;
          newRect = {
            ...cropRect,
            width: Math.max(20, Math.min(newWidth, fullBounds.width - cropRect.x)),
          };
          break;
        }
        case 'top': {
          const newY = node.y();
          const bottomEdge = cropRect.y + cropRect.height;
          newRect = {
            ...cropRect,
            y: Math.max(0, Math.min(newY, bottomEdge - 20)),
            height: bottomEdge - Math.max(0, Math.min(newY, bottomEdge - 20)),
          };
          break;
        }
        case 'bottom': {
          const newHeight = node.y() - cropRect.y;
          newRect = {
            ...cropRect,
            height: Math.max(20, Math.min(newHeight, fullBounds.height - cropRect.y)),
          };
          break;
        }
      }
    }

    // Apply snapping if enabled
    if (snapEnabled) {
      const canvasRect = cropToCanvas(newRect);
      const snapLines = getSnapLines();

      // Use transform snap to snap the specific edge being dragged
      const snapResult = findTransformSnap(canvasRect, edge, snapLines, 10);

      // Convert back to crop coordinates
      const snappedCrop = canvasToCrop(snapResult);
      newRect = {
        x: snappedCrop.x,
        y: snappedCrop.y,
        width: snapResult.width,
        height: snapResult.height,
      };
      setActiveGuides(snapResult.guides);
    } else {
      setActiveGuides([]);
    }

    const clamped = clampCropRect(newRect);
    setCropRect(clamped);

    // Reset handle position to match clamped values
    // Apply the same offsets used when rendering the handle
    const handlePos = getHandlePosition(edge, clamped);
    const isHorizontal = edge === 'left' || edge === 'right';
    node.x(handlePos.x - (isHorizontal ? handleSize / 4 : handleSize));
    node.y(handlePos.y - (isHorizontal ? handleSize : handleSize / 4));
  };

  // Handle edge drag end - clear guides
  const handleEdgeDragEnd = () => {
    setActiveGuides([]);
  };

  // Handle corner handle drag (adjusts both incident edges)
  // Corners ALWAYS maintain aspect ratio (like image resize)
  // Shift = scale from center (like image resize)
  const handleCornerDrag = (corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right', e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target;
    const nodeX = node.x() + handleSize / 2; // Center of handle
    const nodeY = node.y() + handleSize / 2;

    // Always maintain aspect ratio (use locked preset or current crop ratio)
    const currentRatio = aspectRatio ?? (cropRect.width / cropRect.height);

    // For shift (scale from center), we need the center point
    const centerX = cropRect.x + cropRect.width / 2;
    const centerY = cropRect.y + cropRect.height / 2;

    let newRect = { ...cropRect };

    if (isShiftPressed.current) {
      // Scale from center: calculate distance from center to cursor
      // and use that to determine new size
      const dx = Math.abs(nodeX - centerX);
      const dy = Math.abs(nodeY - centerY);

      // Determine new half-dimensions based on cursor distance
      let halfWidth: number;
      let halfHeight: number;

      // Use the dimension that gives the larger size, then constrain by aspect ratio
      if (dx / currentRatio > dy) {
        halfWidth = dx;
        halfHeight = halfWidth / currentRatio;
      } else {
        halfHeight = dy;
        halfWidth = halfHeight * currentRatio;
      }

      // Ensure minimum size
      halfWidth = Math.max(10, halfWidth);
      halfHeight = Math.max(10, halfHeight);

      // Calculate new rect centered on the original center
      let newX = centerX - halfWidth;
      let newY = centerY - halfHeight;
      let newWidth = halfWidth * 2;
      let newHeight = halfHeight * 2;

      // Clamp to full bounds
      if (newX < 0) {
        newX = 0;
        newWidth = Math.min(centerX * 2, fullBounds.width);
        newHeight = newWidth / currentRatio;
        newY = centerY - newHeight / 2;
      }
      if (newY < 0) {
        newY = 0;
        newHeight = Math.min(centerY * 2, fullBounds.height);
        newWidth = newHeight * currentRatio;
        newX = centerX - newWidth / 2;
      }
      if (newX + newWidth > fullBounds.width) {
        newWidth = (fullBounds.width - centerX) * 2;
        newHeight = newWidth / currentRatio;
        newX = centerX - newWidth / 2;
        newY = centerY - newHeight / 2;
      }
      if (newY + newHeight > fullBounds.height) {
        newHeight = (fullBounds.height - centerY) * 2;
        newWidth = newHeight * currentRatio;
        newX = centerX - newWidth / 2;
        newY = centerY - newHeight / 2;
      }

      newRect = { x: newX, y: newY, width: newWidth, height: newHeight };
    } else {
      // Normal corner drag: maintain aspect ratio from the opposite corner
      const rightEdge = cropRect.x + cropRect.width;
      const bottomEdge = cropRect.y + cropRect.height;

      switch (corner) {
        case 'top-left': {
          let newX = Math.max(0, Math.min(nodeX, rightEdge - 20));
          let newY = Math.max(0, Math.min(nodeY, bottomEdge - 20));
          let newWidth = rightEdge - newX;
          let newHeight = bottomEdge - newY;

          // Maintain aspect ratio
          const widthFromHeight = newHeight * currentRatio;
          const heightFromWidth = newWidth / currentRatio;
          if (widthFromHeight <= newWidth) {
            newWidth = widthFromHeight;
            newX = rightEdge - newWidth;
          } else {
            newHeight = heightFromWidth;
            newY = bottomEdge - newHeight;
          }

          newRect = { x: newX, y: newY, width: newWidth, height: newHeight };
          break;
        }
        case 'top-right': {
          let newWidth = Math.max(20, Math.min(nodeX - cropRect.x, fullBounds.width - cropRect.x));
          let newY = Math.max(0, Math.min(nodeY, bottomEdge - 20));
          let newHeight = bottomEdge - newY;

          const widthFromHeight = newHeight * currentRatio;
          const heightFromWidth = newWidth / currentRatio;
          if (widthFromHeight <= newWidth) {
            newWidth = widthFromHeight;
          } else {
            newHeight = heightFromWidth;
            newY = bottomEdge - newHeight;
          }

          newRect = { x: cropRect.x, y: newY, width: newWidth, height: newHeight };
          break;
        }
        case 'bottom-left': {
          let newX = Math.max(0, Math.min(nodeX, rightEdge - 20));
          let newWidth = rightEdge - newX;
          let newHeight = Math.max(20, Math.min(nodeY - cropRect.y, fullBounds.height - cropRect.y));

          const widthFromHeight = newHeight * currentRatio;
          const heightFromWidth = newWidth / currentRatio;
          if (widthFromHeight <= newWidth) {
            newWidth = widthFromHeight;
            newX = rightEdge - newWidth;
          } else {
            newHeight = heightFromWidth;
          }

          newRect = { x: newX, y: cropRect.y, width: newWidth, height: newHeight };
          break;
        }
        case 'bottom-right': {
          let newWidth = Math.max(20, Math.min(nodeX - cropRect.x, fullBounds.width - cropRect.x));
          let newHeight = Math.max(20, Math.min(nodeY - cropRect.y, fullBounds.height - cropRect.y));

          const widthFromHeight = newHeight * currentRatio;
          const heightFromWidth = newWidth / currentRatio;
          if (widthFromHeight <= newWidth) {
            newWidth = widthFromHeight;
          } else {
            newHeight = heightFromWidth;
          }

          newRect = { x: cropRect.x, y: cropRect.y, width: newWidth, height: newHeight };
          break;
        }
      }
    }

    // Apply snapping if enabled
    if (snapEnabled) {
      const canvasRect = cropToCanvas(newRect);
      const snapLines = getSnapLines();

      // Use transform snap to snap the corner being dragged
      const snapResult = findTransformSnap(canvasRect, corner, snapLines, 10);

      // For corner drags, we need to maintain aspect ratio after snapping
      // Take the snapped dimensions but recalculate to maintain ratio
      const currentRatioAfterSnap = aspectRatio ?? (cropRect.width / cropRect.height);
      let finalWidth = snapResult.width;
      let finalHeight = snapResult.height;

      // Check which dimension changed more and adjust the other
      const widthDiff = Math.abs(snapResult.width - canvasRect.width);
      const heightDiff = Math.abs(snapResult.height - canvasRect.height);

      if (widthDiff > heightDiff) {
        finalHeight = finalWidth / currentRatioAfterSnap;
      } else if (heightDiff > widthDiff) {
        finalWidth = finalHeight * currentRatioAfterSnap;
      }

      // Adjust position based on corner
      let finalX = snapResult.x;
      let finalY = snapResult.y;
      if (corner.includes('left')) {
        finalX = canvasRect.x + canvasRect.width - finalWidth;
      }
      if (corner.includes('top')) {
        finalY = canvasRect.y + canvasRect.height - finalHeight;
      }

      // Convert back to crop coordinates
      newRect = {
        x: finalX - fullBoundsX,
        y: finalY - fullBoundsY,
        width: finalWidth,
        height: finalHeight,
      };
      setActiveGuides(snapResult.guides);
    } else {
      setActiveGuides([]);
    }

    const clamped = clampCropRect(newRect);
    setCropRect(clamped);

    // Reset handle position to match clamped values
    const handlePos = getCornerPosition(corner, clamped);
    node.x(handlePos.x - handleSize / 2);
    node.y(handlePos.y - handleSize / 2);
  };

  // Handle corner drag end - clear guides
  const handleCornerDragEnd = () => {
    setActiveGuides([]);
  };

  // Handle crop rect drag (move the whole selection)
  const handleCropRectDrag = (e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target;
    let newX = node.x();
    let newY = node.y();

    // Apply snapping if enabled
    if (snapEnabled) {
      // Convert crop rect position to canvas coordinates
      const canvasRect = {
        x: fullBoundsX + newX,
        y: fullBoundsY + newY,
        width: cropRect.width,
        height: cropRect.height,
      };

      const snapLines = getSnapLines();
      const snapResult = findSnap(canvasRect, snapLines, 10);

      // Convert snapped position back to crop coordinates
      newX = snapResult.x - fullBoundsX;
      newY = snapResult.y - fullBoundsY;
      setActiveGuides(snapResult.guides);
    } else {
      setActiveGuides([]);
    }

    const newRect = clampCropRect({
      x: newX,
      y: newY,
      width: cropRect.width,
      height: cropRect.height,
    });
    setCropRect(newRect);
    node.x(newRect.x);
    node.y(newRect.y);
  };

  // Handle crop rect drag end - clear guides
  const handleCropRectDragEnd = () => {
    setActiveGuides([]);
  };

  // Get handle position for an edge
  const getHandlePosition = (edge: 'top' | 'bottom' | 'left' | 'right', rect: typeof cropRect) => {
    switch (edge) {
      case 'left':
        return { x: rect.x, y: rect.y + rect.height / 2 };
      case 'right':
        return { x: rect.x + rect.width, y: rect.y + rect.height / 2 };
      case 'top':
        return { x: rect.x + rect.width / 2, y: rect.y };
      case 'bottom':
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height };
    }
  };

  // Get handle position for a corner
  const getCornerPosition = (corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right', rect: typeof cropRect) => {
    switch (corner) {
      case 'top-left':
        return { x: rect.x, y: rect.y };
      case 'top-right':
        return { x: rect.x + rect.width, y: rect.y };
      case 'bottom-left':
        return { x: rect.x, y: rect.y + rect.height };
      case 'bottom-right':
        return { x: rect.x + rect.width, y: rect.y + rect.height };
    }
  };

  // Listen for Enter/Escape keys
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        confirmCrop();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cropRect, onCancel]);

  const edges: Array<'top' | 'bottom' | 'left' | 'right'> = ['top', 'bottom', 'left', 'right'];
  const corners: Array<'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'> = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

  return (
    <Group x={fullBoundsX} y={fullBoundsY}>
      {/* Dark overlay - top */}
      <Rect
        x={0}
        y={0}
        width={fullBounds.width}
        height={cropRect.y}
        fill="rgba(0,0,0,0.6)"
        listening={false}
      />
      {/* Dark overlay - bottom */}
      <Rect
        x={0}
        y={cropRect.y + cropRect.height}
        width={fullBounds.width}
        height={fullBounds.height - cropRect.y - cropRect.height}
        fill="rgba(0,0,0,0.6)"
        listening={false}
      />
      {/* Dark overlay - left */}
      <Rect
        x={0}
        y={cropRect.y}
        width={cropRect.x}
        height={cropRect.height}
        fill="rgba(0,0,0,0.6)"
        listening={false}
      />
      {/* Dark overlay - right */}
      <Rect
        x={cropRect.x + cropRect.width}
        y={cropRect.y}
        width={fullBounds.width - cropRect.x - cropRect.width}
        height={cropRect.height}
        fill="rgba(0,0,0,0.6)"
        listening={false}
      />

      {/* Crop rectangle border - draggable to move selection */}
      <Rect
        x={cropRect.x}
        y={cropRect.y}
        width={cropRect.width}
        height={cropRect.height}
        stroke="#ffffff"
        strokeWidth={2}
        dash={[5, 5]}
        draggable
        onDragMove={handleCropRectDrag}
        onDragEnd={handleCropRectDragEnd}
      />

      {/* Edge handles */}
      {edges.map((edge) => {
        const pos = getHandlePosition(edge, cropRect);
        const isHorizontal = edge === 'left' || edge === 'right';

        return (
          <Rect
            key={edge}
            x={pos.x - (isHorizontal ? handleSize / 4 : handleSize)}
            y={pos.y - (isHorizontal ? handleSize : handleSize / 4)}
            width={isHorizontal ? handleSize / 2 : handleSize * 2}
            height={isHorizontal ? handleSize * 2 : handleSize / 2}
            fill={handleColor}
            stroke={handleStroke}
            strokeWidth={2}
            cornerRadius={2}
            draggable
            onDragMove={(e) => handleEdgeDrag(edge, e)}
            onDragEnd={handleEdgeDragEnd}
          />
        );
      })}

      {/* Corner handles */}
      {corners.map((corner) => {
        const pos = getCornerPosition(corner, cropRect);

        return (
          <Rect
            key={corner}
            x={pos.x - handleSize / 2}
            y={pos.y - handleSize / 2}
            width={handleSize}
            height={handleSize}
            fill={handleColor}
            stroke={handleStroke}
            strokeWidth={2}
            cornerRadius={2}
            draggable
            onDragMove={(e) => handleCornerDrag(corner, e)}
            onDragEnd={handleCornerDragEnd}
          />
        );
      })}

      {/* Rule of thirds grid lines inside crop area */}
      <Rect
        x={cropRect.x + cropRect.width / 3}
        y={cropRect.y}
        width={1}
        height={cropRect.height}
        fill="rgba(255,255,255,0.4)"
        listening={false}
      />
      <Rect
        x={cropRect.x + (cropRect.width * 2) / 3}
        y={cropRect.y}
        width={1}
        height={cropRect.height}
        fill="rgba(255,255,255,0.4)"
        listening={false}
      />
      <Rect
        x={cropRect.x}
        y={cropRect.y + cropRect.height / 3}
        width={cropRect.width}
        height={1}
        fill="rgba(255,255,255,0.4)"
        listening={false}
      />
      <Rect
        x={cropRect.x}
        y={cropRect.y + (cropRect.height * 2) / 3}
        width={cropRect.width}
        height={1}
        fill="rgba(255,255,255,0.4)"
        listening={false}
      />

      {/* Active snap guides */}
      {activeGuides.map((guide, index) => (
        <Line
          key={`crop-guide-${index}`}
          points={
            guide.orientation === 'vertical'
              ? [guide.position - fullBoundsX, -1000, guide.position - fullBoundsX, fullBounds.height + 1000]
              : [-1000, guide.position - fullBoundsY, fullBounds.width + 1000, guide.position - fullBoundsY]
          }
          stroke="#3b82f6"
          strokeWidth={1}
          dash={[4, 4]}
          listening={false}
        />
      ))}
    </Group>
  );
}
