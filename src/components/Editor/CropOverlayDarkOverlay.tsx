import { Group, Rect } from 'react-konva';

interface CropOverlayDarkOverlayProps {
  fullBoundsX: number;
  fullBoundsY: number;
  fullBounds: { width: number; height: number };
  overlayCropRect: { x: number; y: number; width: number; height: number };
}

/**
 * Component for rendering the dark overlay around the crop area
 */
export function CropOverlayDarkOverlay({
  fullBoundsX,
  fullBoundsY,
  fullBounds,
  overlayCropRect,
}: CropOverlayDarkOverlayProps) {
  return (
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
  );
}

