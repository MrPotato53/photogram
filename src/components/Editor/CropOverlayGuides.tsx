import { Line } from 'react-konva';
import type { Guide } from '../../types';

interface CropOverlayGuidesProps {
  activeGuides: Guide[];
  fullBoundsX: number;
  fullBoundsY: number;
  fullBounds: { width: number; height: number };
}

/**
 * Component for rendering active snap guides in crop overlay
 */
export function CropOverlayGuides({
  activeGuides,
  fullBoundsX,
  fullBoundsY,
  fullBounds,
}: CropOverlayGuidesProps) {
  return (
    <>
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
    </>
  );
}

