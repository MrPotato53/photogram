import { useState, useEffect, useRef } from 'react';
import { Group, Rect } from 'react-konva';
import type Konva from 'konva';
import type { Element } from '../../types';
import type { SnapSettings } from '../../stores/snapStore';
import { useCropRect } from '../../hooks/crop/useCropRect';
import { useCropSnapping } from '../../hooks/crop/useCropSnapping';
import { useCropEdgeHandles } from '../../hooks/crop/useCropEdgeHandles';
import { findTransformSnap } from '../../utils/snapping';
import { CropOverlayDarkOverlay } from './CropOverlayDarkOverlay';
import { CropOverlayHandles } from './CropOverlayHandles';
import { CropOverlayGrid } from './CropOverlayGrid';
import { CropOverlayGuides } from './CropOverlayGuides';

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
  // Reset key - when changed, resets crop rect to full bounds
  resetKey?: number;
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
  resetKey,
}: CropOverlayProps) {
  // Store the existing crop values
  const existingCropX = element.cropX ?? 0;
  const existingCropY = element.cropY ?? 0;
  const existingCropW = element.cropWidth ?? 1;
  const existingCropH = element.cropHeight ?? 1;

  // Track shift key for proportional resizing
  const isShiftPressed = useRef(false);

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
  const fullBoundsX = element.x - existingCropX * fullBounds.width;
  const fullBoundsY = element.y - existingCropY * fullBounds.height;

  // Crop rect hook
  const { cropRect, setCropRect, clampCropRect, confirmCrop } = useCropRect({
    fullBounds,
    existingCropX,
    existingCropY,
    existingCropW,
    existingCropH,
    aspectRatio,
    resetKey,
  });

  // Snapping hook
  const {
    activeGuides,
    setActiveGuides,
    snapCropRect,
    snapCropRectTransform,
    cropToCanvas,
    getSnapLines,
  } = useCropSnapping({
    snapEnabled,
    snapSettings,
    elements,
    elementId: element.id,
    totalDesignWidth,
    canvasHeight,
    slideWidth,
    numSlides,
    fullBoundsX,
    fullBoundsY,
  });

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

  // Handle size
  const handleSize = 12;
  const handleColor = '#ffffff';
  const handleStroke = '#3b82f6';

  // Helper functions for handle positions
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

  // Edge handles hook
  const { handleDragStart, handleEdgeDrag, handleEdgeDragEnd } = useCropEdgeHandles({
    cropRect,
    setCropRect,
    aspectRatio,
    fullBounds,
    handleSize,
    clampCropRect,
    snapCropRectTransform,
    setActiveGuides,
    getHandlePosition,
  });

  // Edge handle drag logic is handled by useCropEdgeHandles hook

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
    if (shiftPressed) {
      const node = e.target;
      node.x(cropRect.x);
      node.y(cropRect.y);
      return;
    }

    const node = e.target;
    let newX = node.x();
    let newY = node.y();

    const snapResult = snapCropRect({
      x: newX,
      y: newY,
      width: cropRect.width,
      height: cropRect.height,
    });
    
    const newRect = clampCropRect(snapResult.rect);
    setCropRect(newRect);
    setActiveGuides(snapResult.guides);
    node.x(newRect.x);
    node.y(newRect.y);
  };

  const handleCropRectDragEnd = () => {
    setActiveGuides([]);
  };

  // Listen for Enter/Escape keys
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        confirmCrop(onCropConfirm);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cropRect, onCancel, onCropConfirm, confirmCrop]);

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
      {/* Dark overlay */}
      <CropOverlayDarkOverlay
        fullBoundsX={fullBoundsX}
        fullBoundsY={fullBoundsY}
        fullBounds={fullBounds}
        overlayCropRect={overlayCropRect}
      />

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

        {/* Handles */}
        <CropOverlayHandles
          cropRect={cropRect}
          handleSize={handleSize}
          handleColor={handleColor}
          handleStroke={handleStroke}
          getHandlePosition={getHandlePosition}
          getCornerPosition={getCornerPosition}
          onEdgeDragStart={handleDragStart}
          onEdgeDrag={handleEdgeDrag}
          onEdgeDragEnd={handleEdgeDragEnd}
          onCornerDrag={handleCornerDrag}
          onCornerDragEnd={handleCornerDragEnd}
        />

        {/* Grid lines */}
        <CropOverlayGrid cropRect={cropRect} />

        {/* Snap guides */}
        <CropOverlayGuides
          activeGuides={activeGuides}
          fullBoundsX={fullBoundsX}
          fullBoundsY={fullBoundsY}
          fullBounds={fullBounds}
        />
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
