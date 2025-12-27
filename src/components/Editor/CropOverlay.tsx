import { useState, useEffect } from 'react';
import { Group, Rect } from 'react-konva';
import type Konva from 'konva';
import type { Element } from '../../types';

interface CropOverlayProps {
  element: Element;
  // Full bounds = what the element would be if showing the entire source image at current scale
  fullBounds: { width: number; height: number };
  onCropConfirm: (crop: {
    cropX: number;
    cropY: number;
    cropWidth: number;
    cropHeight: number;
    newWidth: number;
    newHeight: number;
  }) => void;
  onCancel: () => void;
}

export function CropOverlay({ element, fullBounds, onCropConfirm, onCancel }: CropOverlayProps) {
  // Store the existing crop values
  const existingCropX = element.cropX ?? 0;
  const existingCropY = element.cropY ?? 0;
  const existingCropW = element.cropWidth ?? 1;
  const existingCropH = element.cropHeight ?? 1;

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
  const handleEdgeDrag = (edge: 'top' | 'bottom' | 'left' | 'right', e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target;
    let newRect = { ...cropRect };

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

    const clamped = clampCropRect(newRect);
    setCropRect(clamped);

    // Reset handle position to match clamped values
    const handlePos = getHandlePosition(edge, clamped);
    node.x(handlePos.x);
    node.y(handlePos.y);
  };

  // Handle corner handle drag (adjusts both incident edges)
  const handleCornerDrag = (corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right', e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target;
    const nodeX = node.x() + handleSize / 2; // Center of handle
    const nodeY = node.y() + handleSize / 2;
    let newRect = { ...cropRect };

    const rightEdge = cropRect.x + cropRect.width;
    const bottomEdge = cropRect.y + cropRect.height;

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
        const newWidth = Math.max(20, Math.min(nodeX - cropRect.x, fullBounds.width - cropRect.x));
        const newY = Math.max(0, Math.min(nodeY, bottomEdge - 20));
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

    const clamped = clampCropRect(newRect);
    setCropRect(clamped);

    // Reset handle position to match clamped values
    const handlePos = getCornerPosition(corner, clamped);
    node.x(handlePos.x - handleSize / 2);
    node.y(handlePos.y - handleSize / 2);
  };

  // Handle crop rect drag (move the whole selection)
  const handleCropRectDrag = (e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target;
    const newRect = clampCropRect({
      x: node.x(),
      y: node.y(),
      width: cropRect.width,
      height: cropRect.height,
    });
    setCropRect(newRect);
    node.x(newRect.x);
    node.y(newRect.y);
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

  // Calculate the position of full bounds relative to canvas
  // The full image area extends beyond the current element if cropped
  const fullBoundsX = element.x - existingCropX * fullBounds.width;
  const fullBoundsY = element.y - existingCropY * fullBounds.height;

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
    </Group>
  );
}
