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
  // Whether shift is pressed (disables crop rect dragging for Shift+pan mode)
  shiftPressed: boolean;
  // Callback for shift+pan element dragging
  onElementDrag: (x: number, y: number) => void;
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
  shiftPressed,
  onElementDrag,
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

  // Track croprect at beginning of drag for absolute positioning
  const dragSnapshot = useRef<{
    rect: { x: number; y: number; width: number; height: number };
    centerX: number;
    centerY: number;
  } | null>(null);

  // Active snap guides during crop operations
  const [activeGuides, setActiveGuides] = useState<Guide[]>([]);

  // Shift+pan drag state - track starting positions to avoid feedback loops
  const [shiftPanStart, setShiftPanStart] = useState<{
    rectX: number;
    rectY: number;
    elementX: number;
    elementY: number;
    cropRect: { x: number; y: number; width: number; height: number };
    // Full bounds position at drag start (in design coordinates)
    fullBoundsX: number;
    fullBoundsY: number;
    // Canvas coordinates of crop rect for stationary overlay (in design coordinates)
    cropCanvasX: number;
    cropCanvasY: number;
    // Layer scale at drag start (needed because dragBoundFunc works in screen coords)
    layerScale: number;
  } | null>(null);

  // Calculate full bounds position in design coordinates
  // IMPORTANT: These coordinates are in "design space" (fixed at DESIGN_HEIGHT = 1080px height per slide)
  // They are NOT in screen/pixel coordinates. The Konva Layer applies a scale transform to convert
  // design coordinates to screen coordinates. This scale can change when the container resizes
  // (e.g., when panels open/close), but the design coordinates themselves should remain stable.
  // 
  // element.x and element.y are in global design coordinates (across all slides, not relative to a single slide)
  // fullBoundsX/Y represent where the full (uncropped) image would be positioned in design coordinates
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

  const handleDragStart = () => {
    dragSnapshot.current = {
      rect: { ...cropRect },
      centerX: cropRect.x + cropRect.width / 2,
      centerY: cropRect.y + cropRect.height / 2,
    };
  }

  // Handle edge handle drag
  // When aspect ratio is locked, edges also maintain the ratio (scaling proportionally from opposite edge)
  // When free (aspectRatio is null), edges only adjust single dimension
  const handleEdgeDrag = (edge: 'top' | 'bottom' | 'left' | 'right', e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target;

    // Use snapshot for stable reference points to prevent oscillation
    const snapshot = dragSnapshot.current;
    if (!snapshot) return;

    const snapRect = snapshot.rect;
    let newRect = { ...snapRect };

    if (aspectRatio !== null) {
      // Locked mode: edge drag maintains aspect ratio
      // Scale proportionally from the opposite edge
      // Use snapshot values for all reference points to prevent feedback loops
      const isHorizontal = edge === 'left' || edge === 'right';

      if (isHorizontal) {
        // Dragging left/right: width changes, height adjusts proportionally
        // Use snapshot's right edge as fixed anchor
        const rightEdge = snapRect.x + snapRect.width;
        let newWidth: number;
        let newX = snapRect.x;

        if (edge === 'left') {
          const dragX = node.x() + handleSize / 4; // Account for handle offset
          newX = Math.max(0, Math.min(dragX, rightEdge - 20));
          newWidth = rightEdge - newX;
        } else {
          const dragX = node.x() + handleSize / 4;
          newWidth = Math.max(20, Math.min(dragX - snapRect.x, fullBounds.width - snapRect.x));
        }

        // Calculate new height to maintain aspect ratio
        let newHeight = newWidth / aspectRatio;

        // Use SNAPSHOT's center for stable vertical centering
        const centerY = snapshot.centerY;
        let newY = centerY - newHeight / 2;

        // Clamp to bounds and readjust if needed
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
        // Dragging top/bottom: height changes, width adjusts proportionally
        // Use snapshot's bottom edge as fixed anchor
        const bottomEdge = snapRect.y + snapRect.height;
        let newHeight: number;
        let newY = snapRect.y;

        if (edge === 'top') {
          const dragY = node.y() + handleSize / 4; // Account for handle offset
          newY = Math.max(0, Math.min(dragY, bottomEdge - 20));
          newHeight = bottomEdge - newY;
        } else {
          const dragY = node.y() + handleSize / 4;
          newHeight = Math.max(20, Math.min(dragY - snapRect.y, fullBounds.height - snapRect.y));
        }

        // Calculate new width to maintain aspect ratio
        let newWidth = newHeight * aspectRatio;

        // Use SNAPSHOT's center for stable horizontal centering
        const centerX = snapshot.centerX;
        let newX = centerX - newWidth / 2;

        // Clamp to bounds and readjust if needed
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
      // Still use snapshot for reference edges to prevent jitter
      switch (edge) {
        case 'left': {
          const dragX = node.x() + handleSize / 4;
          const rightEdge = snapRect.x + snapRect.width;
          const newX = Math.max(0, Math.min(dragX, rightEdge - 20));
          newRect = {
            ...snapRect,
            x: newX,
            width: rightEdge - newX,
          };
          break;
        }
        case 'right': {
          const dragX = node.x() + handleSize / 4;
          const newWidth = Math.max(20, Math.min(dragX - snapRect.x, fullBounds.width - snapRect.x));
          newRect = {
            ...snapRect,
            width: newWidth,
          };
          break;
        }
        case 'top': {
          const dragY = node.y() + handleSize / 4;
          const bottomEdge = snapRect.y + snapRect.height;
          const newY = Math.max(0, Math.min(dragY, bottomEdge - 20));
          newRect = {
            ...snapRect,
            y: newY,
            height: bottomEdge - newY,
          };
          break;
        }
        case 'bottom': {
          const dragY = node.y() + handleSize / 4;
          const newHeight = Math.max(20, Math.min(dragY - snapRect.y, fullBounds.height - snapRect.y));
          newRect = {
            ...snapRect,
            height: newHeight,
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

    // Update snapshot with clamped values to prevent drift during continuous drag
    dragSnapshot.current = {
      rect: { ...clamped },
      centerX: clamped.x + clamped.width / 2,
      centerY: clamped.y + clamped.height / 2,
    };

    // Reset handle position to match clamped values
    // Apply the same offsets used when rendering the handle
    const handlePos = getHandlePosition(edge, clamped);
    const isHorizontal = edge === 'left' || edge === 'right';
    node.x(handlePos.x - (isHorizontal ? handleSize / 4 : handleSize));
    node.y(handlePos.y - (isHorizontal ? handleSize : handleSize / 4));
  };

  // Handle edge drag end - clear guides and snapshot
  const handleEdgeDragEnd = () => {
    setActiveGuides([]);
    dragSnapshot.current = null;
  };

  // Handle corner handle drag (adjusts both incident edges)
  // Free mode (no preset, no shift): corners freely change aspect ratio
  // Locked mode (preset selected OR shift held): corners maintain aspect ratio
  const handleCornerDrag = (corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right', e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target;
    const nodeX = node.x() + handleSize / 2; // Center of handle
    const nodeY = node.y() + handleSize / 2;

    // Determine if aspect ratio is locked
    // Locked when: preset is selected OR shift is held
    const isLocked = aspectRatio !== null || isShiftPressed.current;
    const lockedRatio = aspectRatio ?? (cropRect.width / cropRect.height);

    const rightEdge = cropRect.x + cropRect.width;
    const bottomEdge = cropRect.y + cropRect.height;

    let newRect = { ...cropRect };

    if (!isLocked) {
      // FREE MODE: corners freely change aspect ratio
      // Each corner only affects its two incident edges
      switch (corner) {
        case 'top-left': {
          const newX = Math.max(0, Math.min(nodeX, rightEdge - 20));
          const newY = Math.max(0, Math.min(nodeY, bottomEdge - 20));
          newRect = {
            x: newX,
            y: newY,
            width: rightEdge - newX,
            height: bottomEdge - newY,
          };
          break;
        }
        case 'top-right': {
          const newY = Math.max(0, Math.min(nodeY, bottomEdge - 20));
          const newWidth = Math.max(20, Math.min(nodeX - cropRect.x, fullBounds.width - cropRect.x));
          newRect = {
            x: cropRect.x,
            y: newY,
            width: newWidth,
            height: bottomEdge - newY,
          };
          break;
        }
        case 'bottom-left': {
          const newX = Math.max(0, Math.min(nodeX, rightEdge - 20));
          const newHeight = Math.max(20, Math.min(nodeY - cropRect.y, fullBounds.height - cropRect.y));
          newRect = {
            x: newX,
            y: cropRect.y,
            width: rightEdge - newX,
            height: newHeight,
          };
          break;
        }
        case 'bottom-right': {
          const newWidth = Math.max(20, Math.min(nodeX - cropRect.x, fullBounds.width - cropRect.x));
          const newHeight = Math.max(20, Math.min(nodeY - cropRect.y, fullBounds.height - cropRect.y));
          newRect = {
            x: cropRect.x,
            y: cropRect.y,
            width: newWidth,
            height: newHeight,
          };
          break;
        }
      }
    } else {
      // LOCKED MODE: maintain aspect ratio from the opposite corner
      // When one edge hits bounds, the other must also stop proportionally
      switch (corner) {
        case 'top-left': {
          // Calculate raw desired position
          const rawX = Math.max(0, Math.min(nodeX, rightEdge - 20));
          const rawY = Math.max(0, Math.min(nodeY, bottomEdge - 20));
          const rawWidth = rightEdge - rawX;
          const rawHeight = bottomEdge - rawY;

          // Calculate max dimensions allowed by bounds
          const maxWidth = rightEdge; // Can't go past x=0
          const maxHeight = bottomEdge; // Can't go past y=0

          // Determine which dimension is the constraint
          const widthFromHeight = rawHeight * lockedRatio;

          let finalWidth: number, finalHeight: number;
          if (widthFromHeight <= rawWidth) {
            // Height is the constraint
            finalHeight = Math.min(rawHeight, maxHeight);
            finalWidth = Math.min(finalHeight * lockedRatio, maxWidth);
            // Recalculate height if width was clamped
            if (finalWidth < finalHeight * lockedRatio) {
              finalHeight = finalWidth / lockedRatio;
            }
          } else {
            // Width is the constraint
            finalWidth = Math.min(rawWidth, maxWidth);
            finalHeight = Math.min(finalWidth / lockedRatio, maxHeight);
            // Recalculate width if height was clamped
            if (finalHeight < finalWidth / lockedRatio) {
              finalWidth = finalHeight * lockedRatio;
            }
          }

          newRect = {
            x: rightEdge - finalWidth,
            y: bottomEdge - finalHeight,
            width: finalWidth,
            height: finalHeight,
          };
          break;
        }
        case 'top-right': {
          const rawWidth = Math.max(20, nodeX - cropRect.x);
          const rawY = Math.max(0, Math.min(nodeY, bottomEdge - 20));
          const rawHeight = bottomEdge - rawY;

          const maxWidth = fullBounds.width - cropRect.x;
          const maxHeight = bottomEdge;

          const widthFromHeight = rawHeight * lockedRatio;

          let finalWidth: number, finalHeight: number;
          if (widthFromHeight <= rawWidth) {
            finalHeight = Math.min(rawHeight, maxHeight);
            finalWidth = Math.min(finalHeight * lockedRatio, maxWidth);
            if (finalWidth < finalHeight * lockedRatio) {
              finalHeight = finalWidth / lockedRatio;
            }
          } else {
            finalWidth = Math.min(rawWidth, maxWidth);
            finalHeight = Math.min(finalWidth / lockedRatio, maxHeight);
            if (finalHeight < finalWidth / lockedRatio) {
              finalWidth = finalHeight * lockedRatio;
            }
          }

          newRect = {
            x: cropRect.x,
            y: bottomEdge - finalHeight,
            width: finalWidth,
            height: finalHeight,
          };
          break;
        }
        case 'bottom-left': {
          const rawX = Math.max(0, Math.min(nodeX, rightEdge - 20));
          const rawWidth = rightEdge - rawX;
          const rawHeight = Math.max(20, nodeY - cropRect.y);

          const maxWidth = rightEdge;
          const maxHeight = fullBounds.height - cropRect.y;

          const widthFromHeight = rawHeight * lockedRatio;

          let finalWidth: number, finalHeight: number;
          if (widthFromHeight <= rawWidth) {
            finalHeight = Math.min(rawHeight, maxHeight);
            finalWidth = Math.min(finalHeight * lockedRatio, maxWidth);
            if (finalWidth < finalHeight * lockedRatio) {
              finalHeight = finalWidth / lockedRatio;
            }
          } else {
            finalWidth = Math.min(rawWidth, maxWidth);
            finalHeight = Math.min(finalWidth / lockedRatio, maxHeight);
            if (finalHeight < finalWidth / lockedRatio) {
              finalWidth = finalHeight * lockedRatio;
            }
          }

          newRect = {
            x: rightEdge - finalWidth,
            y: cropRect.y,
            width: finalWidth,
            height: finalHeight,
          };
          break;
        }
        case 'bottom-right': {
          const rawWidth = Math.max(20, nodeX - cropRect.x);
          const rawHeight = Math.max(20, nodeY - cropRect.y);

          const maxWidth = fullBounds.width - cropRect.x;
          const maxHeight = fullBounds.height - cropRect.y;

          const widthFromHeight = rawHeight * lockedRatio;

          let finalWidth: number, finalHeight: number;
          if (widthFromHeight <= rawWidth) {
            finalHeight = Math.min(rawHeight, maxHeight);
            finalWidth = Math.min(finalHeight * lockedRatio, maxWidth);
            if (finalWidth < finalHeight * lockedRatio) {
              finalHeight = finalWidth / lockedRatio;
            }
          } else {
            finalWidth = Math.min(rawWidth, maxWidth);
            finalHeight = Math.min(finalWidth / lockedRatio, maxHeight);
            if (finalHeight < finalWidth / lockedRatio) {
              finalWidth = finalHeight * lockedRatio;
            }
          }

          newRect = {
            x: cropRect.x,
            y: cropRect.y,
            width: finalWidth,
            height: finalHeight,
          };
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

      let finalWidth = snapResult.width;
      let finalHeight = snapResult.height;
      let finalX = snapResult.x;
      let finalY = snapResult.y;

      if (isLocked) {
        // For locked mode, maintain aspect ratio after snapping
        // Take the snapped dimensions but recalculate to maintain ratio
        const currentRatioAfterSnap = aspectRatio ?? (cropRect.width / cropRect.height);

        // Check which dimension changed more and adjust the other
        const widthDiff = Math.abs(snapResult.width - canvasRect.width);
        const heightDiff = Math.abs(snapResult.height - canvasRect.height);

        if (widthDiff > heightDiff) {
          finalHeight = finalWidth / currentRatioAfterSnap;
        } else if (heightDiff > widthDiff) {
          finalWidth = finalHeight * currentRatioAfterSnap;
        }

        // Adjust position based on corner to maintain opposite corner position
        if (corner.includes('left')) {
          finalX = canvasRect.x + canvasRect.width - finalWidth;
        }
        if (corner.includes('top')) {
          finalY = canvasRect.y + canvasRect.height - finalHeight;
        }
      } else {
        // Free mode: use snapped dimensions directly without aspect ratio adjustment
        // Adjust position based on corner to maintain opposite corner position
        if (corner.includes('left')) {
          finalX = canvasRect.x + canvasRect.width - finalWidth;
        }
        if (corner.includes('top')) {
          finalY = canvasRect.y + canvasRect.height - finalHeight;
        }
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

  // Track element position for Shift+pan mode
  // When element is dragged (either by our shift+pan handler or externally), adjust cropRect to compensate
  const elementPositionRef = useRef({ x: element.x, y: element.y });

  // Ref to store shift+pan start data synchronously (state updates are async and cause dragBoundFunc issues)
  const shiftPanStartRef = useRef<typeof shiftPanStart>(null);

  // Watch for element position changes and adjust cropRect to keep it visually stationary
  // Skip during active shift+pan drag - we handle that in onDragEnd
  useEffect(() => {
    // Skip adjustment during shift+pan drag - we'll finalize in onDragEnd
    if (shiftPanStart) {
      // Update ref to current position so we don't accumulate deltas after shift+pan ends
      elementPositionRef.current = { x: element.x, y: element.y };
      return;
    }

    const deltaX = element.x - elementPositionRef.current.x;
    const deltaY = element.y - elementPositionRef.current.y;

    if (deltaX !== 0 || deltaY !== 0) {
      // Element moved, adjust cropRect in opposite direction to keep visual position
      // Note: deltaX/deltaY are in design coordinates, cropRect is in pixels relative to fullBounds
      // Since fullBounds.width is in design coordinates, the adjustment is correct
      setCropRect(prev => {
        const newX = prev.x - deltaX;
        const newY = prev.y - deltaY;
        // Clamp within bounds
        return {
          ...prev,
          x: Math.max(0, Math.min(newX, fullBounds.width - prev.width)),
          y: Math.max(0, Math.min(newY, fullBounds.height - prev.height)),
        };
      });
    }
    // Always update the ref to track current position
    elementPositionRef.current = { x: element.x, y: element.y };
  }, [element.x, element.y, fullBounds.width, fullBounds.height, shiftPanStart]);


  // Handle crop rect drag (move the whole selection)
  const handleCropRectDrag = (e: Konva.KonvaEventObject<DragEvent>) => {
    // When shift is pressed, don't handle drag - element dragging is handled by CanvasArea
    if (shiftPressed) {
      const node = e.target;
      node.x(cropRect.x);
      node.y(cropRect.y);
      return;
    }

    const node = e.target;
    let newX = node.x();
    let newY = node.y();

    // Normal mode: move crop rect over the image
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

  // During shift+pan, calculate crop rect position relative to current full bounds
  // The crop rect stays stationary in canvas coordinates, but full bounds moves
  const getCropRectForOverlay = () => {
    if (shiftPanStart) {
      // Stationary crop rect position in canvas coordinates
      const stationaryCropX = shiftPanStart.cropCanvasX;
      const stationaryCropY = shiftPanStart.cropCanvasY;
      
      // Current full bounds position in canvas coordinates
      const currentFullBoundsX = fullBoundsX;
      const currentFullBoundsY = fullBoundsY;
      
      // Crop rect position relative to current full bounds
      const relativeCropX = stationaryCropX - currentFullBoundsX;
      const relativeCropY = stationaryCropY - currentFullBoundsY;
      
      return {
        x: relativeCropX,
        y: relativeCropY,
        width: shiftPanStart.cropRect.width,
        height: shiftPanStart.cropRect.height,
      };
    }
    return cropRect;
  };

  // Render dark overlay - always positioned at current full bounds
  const overlayCropRect = getCropRectForOverlay();

  return (
    <>
    {/* Dark overlay - always positioned at current full bounds, crop rect calculated relative to it */}
    <Group x={fullBoundsX} y={fullBoundsY}>
      {/* Dark overlay - top */}
      <Rect
        x={0}
        y={0}
        width={fullBounds.width}
        height={overlayCropRect.y}
        fill="rgba(0,0,0,0.6)"
        listening={false}
      />
      {/* Dark overlay - bottom */}
      <Rect
        x={0}
        y={overlayCropRect.y + overlayCropRect.height}
        width={fullBounds.width}
        height={fullBounds.height - overlayCropRect.y - overlayCropRect.height}
        fill="rgba(0,0,0,0.6)"
        listening={false}
      />
      {/* Dark overlay - left */}
      <Rect
        x={0}
        y={overlayCropRect.y}
        width={overlayCropRect.x}
        height={overlayCropRect.height}
        fill="rgba(0,0,0,0.6)"
        listening={false}
      />
      {/* Dark overlay - right */}
      <Rect
        x={overlayCropRect.x + overlayCropRect.width}
        y={overlayCropRect.y}
        width={fullBounds.width - overlayCropRect.x - overlayCropRect.width}
        height={overlayCropRect.height}
        fill="rgba(0,0,0,0.6)"
        listening={false}
      />
    </Group>

    {/* Crop interface Group - only shown when NOT in shift+pan */}
    {!shiftPanStart && (
      <Group x={fullBoundsX} y={fullBoundsY}>
        {/* Crop rectangle border and handles - hide during shift+pan (stationary overlay shows instead) */}
        <Rect
          x={cropRect.x}
          y={cropRect.y}
          width={cropRect.width}
          height={cropRect.height}
          stroke="#ffffff"
          strokeWidth={2}
          dash={[5, 5]}
          draggable={!shiftPressed}
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
              onDragStart={() => handleDragStart()}
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
    )}

    {/* Shift+pan drag layer - OUTSIDE the Group to avoid position feedback loops */}
    {shiftPressed && (
      <Rect
        x={shiftPanStart?.rectX ?? (element.x - existingCropX * fullBounds.width)}
        y={shiftPanStart?.rectY ?? (element.y - existingCropY * fullBounds.height)}
        width={fullBounds.width}
        height={fullBounds.height}
        fill="transparent"
        draggable
        onDragStart={(e) => {
          const node = e.target;
          const layer = node.getLayer();
          const layerScale = layer?.scaleX() ?? 1;
          const actualRectX = node.x();
          const actualRectY = node.y();

          const startData = {
            rectX: actualRectX,
            rectY: actualRectY,
            elementX: element.x,
            elementY: element.y,
            cropRect: { ...cropRect },
            fullBoundsX: actualRectX,
            fullBoundsY: actualRectY,
            cropCanvasX: actualRectX + cropRect.x,
            cropCanvasY: actualRectY + cropRect.y,
            layerScale,
          };

          // Set ref SYNCHRONOUSLY so dragBoundFunc has immediate access
          shiftPanStartRef.current = startData;
          // Also set state for React re-renders (async, but needed for UI)
          setShiftPanStart(startData);
        }}
        dragBoundFunc={(pos) => {
          // CRITICAL: dragBoundFunc receives and returns SCREEN coordinates (stage space)
          // But our design values (startX, cropRect, fullBounds) are in DESIGN coordinates
          // We must convert everything to screen coords, do the math, then return screen coords
          const start = shiftPanStartRef.current;
          if (!start) return pos;

          const scale = start.layerScale;
          const startXScreen = start.rectX * scale;
          const startYScreen = start.rectY * scale;
          const startCrop = start.cropRect;

          // Calculate bounds in design coords, then convert to screen
          const minDeltaXScreen = (startCrop.x + startCrop.width - fullBounds.width) * scale;
          const maxDeltaXScreen = startCrop.x * scale;
          const minDeltaYScreen = (startCrop.y + startCrop.height - fullBounds.height) * scale;
          const maxDeltaYScreen = startCrop.y * scale;

          // Calculate and clamp delta in screen coordinates
          const deltaXScreen = pos.x - startXScreen;
          const deltaYScreen = pos.y - startYScreen;
          const clampedDeltaXScreen = Math.max(minDeltaXScreen, Math.min(deltaXScreen, maxDeltaXScreen));
          const clampedDeltaYScreen = Math.max(minDeltaYScreen, Math.min(deltaYScreen, maxDeltaYScreen));

          return {
            x: startXScreen + clampedDeltaXScreen,
            y: startYScreen + clampedDeltaYScreen,
          };
        }}
        onDragMove={(e) => {
          const start = shiftPanStartRef.current;
          if (!start) return;

          const node = e.target;
          const deltaX = node.x() - start.rectX;
          const deltaY = node.y() - start.rectY;

          // Update element position: when full bounds moves by delta, element moves by same delta
          onElementDrag(start.elementX + deltaX, start.elementY + deltaY);
        }}
        onDragEnd={(e) => {
          const start = shiftPanStartRef.current;
          if (start) {
            const node = e.target;
            const deltaX = node.x() - start.rectX;
            const deltaY = node.y() - start.rectY;

            // Finalize cropRect: when full bounds moves by delta, crop rect moves opposite
            const startCrop = start.cropRect;
            setCropRect({
              ...startCrop,
              x: Math.max(0, Math.min(startCrop.x - deltaX, fullBounds.width - startCrop.width)),
              y: Math.max(0, Math.min(startCrop.y - deltaY, fullBounds.height - startCrop.height)),
            });

            elementPositionRef.current = { x: element.x, y: element.y };
          }
          shiftPanStartRef.current = null;
          setShiftPanStart(null);
        }}
      />
    )}

    {/* Stationary crop overlay during shift+pan drag - rendered at fixed canvas position */}
    {shiftPanStart && (
      <Group x={shiftPanStart.cropCanvasX} y={shiftPanStart.cropCanvasY}>
        {/* Crop rect border - stationary during drag */}
        <Rect
          x={0}
          y={0}
          width={shiftPanStart.cropRect.width}
          height={shiftPanStart.cropRect.height}
          stroke="#ffffff"
          strokeWidth={2}
          dash={[5, 5]}
          listening={false}
        />
        {/* Rule of thirds grid */}
        <Rect x={shiftPanStart.cropRect.width / 3} y={0} width={1} height={shiftPanStart.cropRect.height} fill="rgba(255,255,255,0.4)" listening={false} />
        <Rect x={(shiftPanStart.cropRect.width * 2) / 3} y={0} width={1} height={shiftPanStart.cropRect.height} fill="rgba(255,255,255,0.4)" listening={false} />
        <Rect x={0} y={shiftPanStart.cropRect.height / 3} width={shiftPanStart.cropRect.width} height={1} fill="rgba(255,255,255,0.4)" listening={false} />
        <Rect x={0} y={(shiftPanStart.cropRect.height * 2) / 3} width={shiftPanStart.cropRect.width} height={1} fill="rgba(255,255,255,0.4)" listening={false} />
      </Group>
    )}
  </>
  );
}
