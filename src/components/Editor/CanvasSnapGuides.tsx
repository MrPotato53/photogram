import { memo, useMemo } from 'react';
import { Group, Line } from 'react-konva';
import { generateStaticGuides } from '../../utils/snapping';
import { useSnapStore } from '../../stores/snapStore';
import {
  calculateSnapLines,
  prepareFillLines,
} from '../../utils/snapping';
import type { Element } from '../../types';

interface CanvasSnapGuidesProps {
  designSize: { width: number; height: number };
  totalDesignWidth: number;
  numSlides: number;
  scale: number;
  zoomLevel: number;
  elements?: Element[];
}

export const CanvasSnapGuides = memo(function CanvasSnapGuides({
  designSize,
  totalDesignWidth,
  numSlides,
  scale,
  zoomLevel,
  elements,
}: CanvasSnapGuidesProps) {
  // Subscribe directly to snap store - isolates re-renders from activeGuides
  // changes so they don't cascade up to CanvasArea
  const snapSettings = useSnapStore((s) => s.snapSettings);
  const activeGuides = useSnapStore((s) => s.activeGuides);
  const fillModeActive = useSnapStore((s) => s.fillModeActive);
  const snapEnabled = useSnapStore((s) => s.snapEnabled);

  const staticGuides = useMemo(() => generateStaticGuides(
    snapSettings,
    designSize.height,
    designSize.width,
    numSlides
  ), [snapSettings, designSize.height, designSize.width, numSlides]);

  // Fill mode guides: show all enabled snap line positions as faint guides
  // so the user can see the fill grid. Only computed when fill mode is active.
  const fillGuides = useMemo(() => {
    if (!fillModeActive || !snapEnabled) return [];
    const snapLines = calculateSnapLines(
      elements || [], '__fill_guide__', totalDesignWidth, designSize.height,
      snapSettings, designSize.width, numSlides,
    );
    const lines = prepareFillLines(snapLines, designSize.height, totalDesignWidth);

    const guides: { orientation: 'vertical' | 'horizontal'; position: number }[] = [];
    for (const pos of lines.vertical) {
      guides.push({ orientation: 'vertical', position: pos });
    }
    for (const pos of lines.horizontal) {
      guides.push({ orientation: 'horizontal', position: pos });
    }
    return guides;
  }, [fillModeActive, snapEnabled, snapSettings, elements, totalDesignWidth, designSize.height, designSize.width, numSlides]);

  return (
    <Group name="ui-guides" listening={false}>
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

      {/* Fill mode guides (shown while F is held during drag) */}
      {fillGuides.map((guide, index) => (
        <Line
          key={`fill-guide-${index}`}
          points={
            guide.orientation === 'vertical'
              ? [guide.position, 0, guide.position, designSize.height]
              : [0, guide.position, totalDesignWidth, guide.position]
          }
          stroke="rgba(59, 130, 246, 0.3)"
          strokeWidth={1 / (scale * zoomLevel)}
          dash={[3 / (scale * zoomLevel), 3 / (scale * zoomLevel)]}
        />
      ))}

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
    </Group>
  );
});
