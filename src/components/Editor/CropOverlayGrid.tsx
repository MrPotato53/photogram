import { Rect } from 'react-konva';

interface CropOverlayGridProps {
  cropRect: { x: number; y: number; width: number; height: number };
}

/**
 * Component for rendering rule of thirds grid lines inside crop area
 */
export function CropOverlayGrid({ cropRect }: CropOverlayGridProps) {
  return (
    <>
      {/* Rule of thirds grid lines */}
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
    </>
  );
}

