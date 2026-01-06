import { Line } from 'react-konva';
import type { Guide } from '../../types';
import { generateStaticGuides } from '../../utils/snapping';
import type { SnapSettings } from '../../stores/snapStore';

interface CanvasSnapGuidesProps {
  snapSettings: SnapSettings;
  activeGuides: Guide[];
  designSize: { width: number; height: number };
  totalDesignWidth: number;
  numSlides: number;
  scale: number;
  zoomLevel: number;
}

export function CanvasSnapGuides({
  snapSettings,
  activeGuides,
  designSize,
  totalDesignWidth,
  numSlides,
  scale,
  zoomLevel,
}: CanvasSnapGuidesProps) {
  const staticGuides = generateStaticGuides(
    snapSettings,
    designSize.height,
    designSize.width,
    numSlides
  );

  return (
    <>
      {/* Slide separator lines (thin dark lines) */}
      {Array.from({ length: numSlides - 1 }, (_, index) => {
        const slideX = (index + 1) * designSize.width;
        return (
          <Line
            key={`separator-${index}`}
            points={[slideX, 0, slideX, designSize.height]}
            stroke="#374151"
            strokeWidth={2 / (scale * zoomLevel)}
          />
        );
      })}

      {/* Static guide visualization (always visible when enabled) */}
      {staticGuides.map((guide, index) => {
        // Different colors for different guide types
        const colors = {
          canvas: 'rgba(147, 197, 253, 0.4)', // blue-300 with opacity
          margin: 'rgba(252, 211, 77, 0.4)',  // amber-300 with opacity
          grid: 'rgba(167, 139, 250, 0.35)',  // violet-400 with opacity
        };
        return (
          <Line
            key={`static-guide-${index}`}
            points={
              guide.orientation === 'vertical'
                ? [guide.position, 0, guide.position, designSize.height]
                : [0, guide.position, totalDesignWidth, guide.position]
            }
            stroke={colors[guide.type]}
            strokeWidth={1 / (scale * zoomLevel)}
          />
        );
      })}

      {/* Active snap guides (shown during drag/resize) */}
      {activeGuides.map((guide, index) => (
        <Line
          key={`guide-${index}`}
          points={
            guide.orientation === 'vertical'
              ? [guide.position, 0, guide.position, designSize.height]
              : [0, guide.position, totalDesignWidth, guide.position]
          }
          stroke="#3b82f6"
          strokeWidth={1 / (scale * zoomLevel)}
          dash={[4 / (scale * zoomLevel), 4 / (scale * zoomLevel)]}
        />
      ))}
    </>
  );
}

