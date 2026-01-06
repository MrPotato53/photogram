import { Rect } from 'react-konva';
import type Konva from 'konva';

interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CropOverlayHandlesProps {
  cropRect: CropRect;
  handleSize: number;
  handleColor: string;
  handleStroke: string;
  getHandlePosition: (edge: 'top' | 'bottom' | 'left' | 'right', rect: CropRect) => { x: number; y: number };
  getCornerPosition: (corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right', rect: CropRect) => { x: number; y: number };
  onEdgeDragStart: () => void;
  onEdgeDrag: (edge: 'top' | 'bottom' | 'left' | 'right', e: Konva.KonvaEventObject<any>) => void;
  onEdgeDragEnd: () => void;
  onCornerDrag: (corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right', e: Konva.KonvaEventObject<any>) => void;
  onCornerDragEnd: () => void;
}

/**
 * Component for rendering crop handles (edges and corners)
 */
export function CropOverlayHandles({
  cropRect,
  handleSize,
  handleColor,
  handleStroke,
  getHandlePosition,
  getCornerPosition,
  onEdgeDragStart,
  onEdgeDrag,
  onEdgeDragEnd,
  onCornerDrag,
  onCornerDragEnd,
}: CropOverlayHandlesProps) {
  const edges: Array<'top' | 'bottom' | 'left' | 'right'> = ['top', 'bottom', 'left', 'right'];
  const corners: Array<'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'> = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

  return (
    <>
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
            onDragStart={onEdgeDragStart}
            onDragMove={(e) => onEdgeDrag(edge, e)}
            onDragEnd={onEdgeDragEnd}
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
            onDragMove={(e) => onCornerDrag(corner, e)}
            onDragEnd={onCornerDragEnd}
          />
        );
      })}
    </>
  );
}

