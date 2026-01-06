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

export function CanvasElementRenderer({
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
        draggable={!element.locked && !cropModeElementId}
        onClick={(e) => onElementClick(element.id, e)}
        onTap={(e) => onElementClick(element.id, e as unknown as Konva.KonvaEventObject<MouseEvent>)}
        onDragStart={onDragStart}
        onDragMove={(e) => onDragMove(element.id, e)}
        onDragEnd={(e) => onDragEnd(element.id, e)}
        onTransformEnd={(e) => onTransformEnd(element.id, e)}
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
        />
        {/* Plus icon - horizontal line */}
        <Rect
          x={centerX - plusSize / 2}
          y={centerY - plusSize / 12}
          width={plusSize}
          height={plusSize / 6}
          fill="#9ca3af"
        />
        {/* Plus icon - vertical line */}
        <Rect
          x={centerX - plusSize / 12}
          y={centerY - plusSize / 2}
          width={plusSize / 6}
          height={plusSize}
          fill="#9ca3af"
        />
      </Group>
    );
  }

  // Render photo elements
  if (element.type !== 'photo' || !loadedImage) return null;

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
      draggable={!element.locked && !cropModeElementId}
      onClick={(e) => onElementClick(element.id, e)}
      onTap={(e) => onElementClick(element.id, e as unknown as Konva.KonvaEventObject<MouseEvent>)}
      onDragStart={onDragStart}
      onDragMove={(e) => onDragMove(element.id, e)}
      onDragEnd={(e) => onDragEnd(element.id, e)}
      onTransformEnd={(e) => onTransformEnd(element.id, e)}
      stroke={isSelected ? '#3b82f6' : undefined}
      strokeWidth={isSelected ? 2 / zoomLevel : 0}
      strokeScaleEnabled={false}
    />
  );
}

