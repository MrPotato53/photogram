import { memo, useCallback } from 'react';
import { Image as KonvaImage, Group, Rect } from 'react-konva';
import type Konva from 'konva';
import type { Element } from '../../types';

interface CanvasElementRendererProps {
  element: Element;
  loadedImage: HTMLImageElement | null;
  isSelected: boolean;
  isBeingCropped: boolean;
  zoomLevel: number;
  onElementClick: (elementId: string, e: Konva.KonvaEventObject<MouseEvent>) => void;
  onDragStart: () => void;
  onDragMove: (elementId: string, e: Konva.KonvaEventObject<any>) => void;
  onDragEnd: (elementId: string, e: Konva.KonvaEventObject<any>) => void;
  onTransformEnd: (elementId: string, e: Konva.KonvaEventObject<Event>) => void;
  cropModeElementId: string | null;
}

/**
 * Simple rectangle hit function for Konva elements.
 * Replaces Konva's default pixel-perfect hit detection (which draws the full image
 * to a hidden canvas and calls getImageData on every mousemove) with a simple
 * rectangle fill. This reduces hit testing from O(image_pixels) to O(1) per element.
 */
function rectHitFunc(context: Konva.Context, shape: Konva.Shape) {
  context.beginPath();
  context.rect(0, 0, shape.width(), shape.height());
  context.closePath();
  context.fillStrokeShape(shape);
}

export const CanvasElementRenderer = memo(function CanvasElementRenderer({
  element,
  loadedImage,
  isSelected,
  isBeingCropped,
  zoomLevel,
  onElementClick,
  onDragStart,
  onDragMove,
  onDragEnd,
  onTransformEnd,
  cropModeElementId,
}: CanvasElementRendererProps) {
  // Stable callbacks to avoid re-creating inline functions
  const handleClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => onElementClick(element.id, e),
    [element.id, onElementClick]
  );
  const handleTap = useCallback(
    (e: Konva.KonvaEventObject<TouchEvent>) =>
      onElementClick(element.id, e as unknown as Konva.KonvaEventObject<MouseEvent>),
    [element.id, onElementClick]
  );
  const handleDragMove = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => onDragMove(element.id, e),
    [element.id, onDragMove]
  );
  const handleDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => onDragEnd(element.id, e),
    [element.id, onDragEnd]
  );
  const handleTransformEnd = useCallback(
    (e: Konva.KonvaEventObject<Event>) => onTransformEnd(element.id, e),
    [element.id, onTransformEnd]
  );

  const isDraggable = !element.locked && !cropModeElementId;

  // Render placeholder/frame elements
  if (element.type === 'placeholder') {
    const plusSize = Math.min(element.width, element.height) * 0.3;
    const centerX = element.width / 2;
    const centerY = element.height / 2;

    return (
      <Group
        key={element.id}
        id={element.id}
        x={element.x}
        y={element.y}
        width={element.width}
        height={element.height}
        rotation={element.rotation}
        draggable={isDraggable}
        onClick={handleClick}
        onTap={handleTap}
        onDragStart={onDragStart}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        onTransformEnd={handleTransformEnd}
      >
        {/* Gray background */}
        <Rect
          width={element.width}
          height={element.height}
          fill="#e5e7eb"
          stroke={isSelected ? '#3b82f6' : '#d1d5db'}
          strokeWidth={isSelected ? 2 / zoomLevel : 1 / zoomLevel}
          strokeScaleEnabled={false}
          dash={isSelected ? undefined : [8, 4]}
          hitFunc={rectHitFunc}
        />
        {/* Plus icon - horizontal line */}
        <Rect
          x={centerX - plusSize / 2}
          y={centerY - plusSize / 12}
          width={plusSize}
          height={plusSize / 6}
          fill="#9ca3af"
          listening={false}
        />
        {/* Plus icon - vertical line */}
        <Rect
          x={centerX - plusSize / 12}
          y={centerY - plusSize / 2}
          width={plusSize / 6}
          height={plusSize}
          fill="#9ca3af"
          listening={false}
        />
      </Group>
    );
  }

  // Render photo elements
  if (element.type !== 'photo') return null;

  // Show placeholder for missing/broken images
  if (!loadedImage) {
    return (
      <Group
        key={element.id}
        id={element.id}
        x={element.x}
        y={element.y}
        width={element.width}
        height={element.height}
        rotation={element.rotation}
        draggable={isDraggable}
        onClick={handleClick}
        onTap={handleTap}
        onDragStart={onDragStart}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        onTransformEnd={handleTransformEnd}
      >
        {/* Error background */}
        <Rect
          width={element.width}
          height={element.height}
          fill="#fef2f2"
          stroke={isSelected ? '#3b82f6' : '#fca5a5'}
          strokeWidth={isSelected ? 2 / zoomLevel : 1 / zoomLevel}
          strokeScaleEnabled={false}
          hitFunc={rectHitFunc}
        />
        {/* X icon - diagonal lines */}
        <Rect
          x={element.width / 2 - 2}
          y={element.height / 2 - 15}
          width={4}
          height={30}
          fill="#ef4444"
          rotation={45}
          offsetX={2}
          offsetY={15}
          listening={false}
        />
        <Rect
          x={element.width / 2 - 2}
          y={element.height / 2 - 15}
          width={4}
          height={30}
          fill="#ef4444"
          rotation={-45}
          offsetX={2}
          offsetY={15}
          listening={false}
        />
      </Group>
    );
  }

  const flipScaleX = element.flipX ? -1 : 1;
  const flipScaleY = element.flipY ? -1 : 1;

  const existingCropX = element.cropX ?? 0;
  const existingCropY = element.cropY ?? 0;
  const existingCropW = element.cropWidth ?? 1;
  const existingCropH = element.cropHeight ?? 1;
  const hasCrop = existingCropX > 0 || existingCropY > 0 || existingCropW < 1 || existingCropH < 1;

  if (isBeingCropped) {
    const fullWidth = element.width / existingCropW;
    const fullHeight = element.height / existingCropH;
    const fullX = element.x - existingCropX * fullWidth;
    const fullY = element.y - existingCropY * fullHeight;
    const fullOffsetX = element.flipX ? fullWidth : 0;
    const fullOffsetY = element.flipY ? fullHeight : 0;

    return (
      <KonvaImage
        key={element.id}
        id={element.id}
        image={loadedImage}
        x={fullX}
        y={fullY}
        width={fullWidth}
        height={fullHeight}
        rotation={element.rotation}
        scaleX={flipScaleX}
        scaleY={flipScaleY}
        offsetX={fullOffsetX}
        offsetY={fullOffsetY}
        draggable={false}
        listening={false}
        perfectDrawEnabled={false}
      />
    );
  }

  const offsetX = element.flipX ? element.width : 0;
  const offsetY = element.flipY ? element.height : 0;
  const cropConfig = hasCrop ? {
    x: existingCropX * loadedImage.naturalWidth,
    y: existingCropY * loadedImage.naturalHeight,
    width: existingCropW * loadedImage.naturalWidth,
    height: existingCropH * loadedImage.naturalHeight,
  } : undefined;

  return (
    <KonvaImage
      key={element.id}
      id={element.id}
      image={loadedImage}
      x={element.x}
      y={element.y}
      width={element.width}
      height={element.height}
      rotation={element.rotation}
      scaleX={flipScaleX}
      scaleY={flipScaleY}
      offsetX={offsetX}
      offsetY={offsetY}
      crop={cropConfig}
      draggable={isDraggable}
      onClick={handleClick}
      onTap={handleTap}
      onDragStart={onDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onTransformEnd={handleTransformEnd}
      stroke={isSelected ? '#3b82f6' : undefined}
      strokeWidth={isSelected ? 2 / zoomLevel : 0}
      strokeScaleEnabled={false}
      perfectDrawEnabled={false}
      hitFunc={rectHitFunc}
    />
  );
});
