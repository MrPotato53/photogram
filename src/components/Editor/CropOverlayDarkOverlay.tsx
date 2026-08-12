import { Group, Rect, Shape } from 'react-konva';

interface CropOverlayDarkOverlayProps {
  fullBoundsX: number;
  fullBoundsY: number;
  fullBounds: { width: number; height: number };
  overlayCropRect: { x: number; y: number; width: number; height: number };
  // When the content-rotation preview is active, the image node no longer
  // occupies the axis-aligned fullBounds rect — it's rotated/cover-scaled
  // around the crop-rect center. The parent passes the transformed image
  // footprint (4 corners, absolute design coords, clockwise) plus the crop
  // window (absolute design coords) so the shadow tracks the rotated image
  // instead of the stale upright rect.
  rotatedShadow?: {
    footprint: { x: number; y: number }[];
    hole: { x: number; y: number; width: number; height: number };
  } | null;
}

/**
 * Component for rendering the dark overlay around the crop area
 */
export function CropOverlayDarkOverlay({
  fullBoundsX,
  fullBoundsY,
  fullBounds,
  overlayCropRect,
  rotatedShadow,
}: CropOverlayDarkOverlayProps) {
  if (rotatedShadow) {
    const { footprint, hole } = rotatedShadow;
    return (
      <Shape
        sceneFunc={(ctx, shape) => {
          ctx.beginPath();
          // Rotated image footprint, clockwise
          ctx.moveTo(footprint[0].x, footprint[0].y);
          for (let i = 1; i < footprint.length; i++) {
            ctx.lineTo(footprint[i].x, footprint[i].y);
          }
          ctx.closePath();
          // Crop window wound counterclockwise — the nonzero fill rule
          // subtracts it from the footprint, leaving the shadow only on
          // image regions outside the crop frame.
          ctx.moveTo(hole.x, hole.y);
          ctx.lineTo(hole.x, hole.y + hole.height);
          ctx.lineTo(hole.x + hole.width, hole.y + hole.height);
          ctx.lineTo(hole.x + hole.width, hole.y);
          ctx.closePath();
          ctx.fillStrokeShape(shape);
        }}
        fill="rgba(0,0,0,0.6)"
        listening={false}
      />
    );
  }

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
