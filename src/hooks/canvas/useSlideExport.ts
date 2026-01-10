import { useCallback, RefObject } from 'react';
import type Konva from 'konva';
import type { Project } from '../../types';
import { DESIGN_HEIGHT, getSlideWidth } from '../../utils/designConstants';

interface UseSlideExportProps {
  stageRef: RefObject<Konva.Stage>;
  project: Project | null;
  scale: number;
}

export function useSlideExport({ stageRef, project, scale }: UseSlideExportProps) {
  const renderSlideForExport = useCallback(
    (
      slideIndex: number,
      pixelRatio: number,
      format: 'png' | 'jpeg',
      quality: number
    ): string | null => {
      if (!stageRef.current || !project) return null;

      const stage = stageRef.current;
      const slideWidth = getSlideWidth(project.aspectRatio);

      // Calculate slide position in the stage
      const slideLeft = slideIndex * slideWidth;

      try {
        // Export just the region for this slide
        const dataURL = stage.toDataURL({
          x: slideLeft * scale,
          y: 0,
          width: slideWidth * scale,
          height: DESIGN_HEIGHT * scale,
          pixelRatio: pixelRatio,
          mimeType: format === 'png' ? 'image/png' : 'image/jpeg',
          quality: format === 'jpeg' ? quality : undefined,
        });

        return dataURL;
      } catch (error) {
        console.error(`Failed to render slide ${slideIndex + 1}:`, error);
        return null;
      }
    },
    [stageRef, project, scale]
  );

  const renderSlideThumbnail = useCallback(
    (slideIndex: number): string | null => {
      // Render at low quality for thumbnail
      return renderSlideForExport(slideIndex, 0.25, 'jpeg', 0.6);
    },
    [renderSlideForExport]
  );

  return { renderSlideForExport, renderSlideThumbnail };
}
