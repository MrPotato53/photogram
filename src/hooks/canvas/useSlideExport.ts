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
  // Hide all non-content UI nodes (Transformer, crop overlays) before rendering,
  // render, then restore them. Returns the data URL.
  //
  // pixelRatio here is a "design multiplier": output_pixels = design_pixels * pixelRatio.
  // e.g. Instagram multiplier = 1080/slideWidth gives 1080px output regardless of viewport.
  const renderClean = useCallback(
    (
      slideIndex: number,
      pixelRatio: number,
      format: 'png' | 'jpeg',
      quality: number
    ): string | null => {
      if (!stageRef.current || !project) return null;

      const stage = stageRef.current;
      const slideWidth = getSlideWidth(project.aspectRatio);
      const slideLeft = slideIndex * slideWidth;

      // Find and hide UI-only nodes (Transformer, guides, separators)
      const hiddenNodes: Konva.Node[] = [];
      const uiNodes = [
        ...stage.find('Transformer') as Konva.Node[],
        ...stage.find('.ui-guides') as Konva.Node[],
      ];
      for (const node of uiNodes) {
        if (node.isVisible()) {
          node.hide();
          hiddenNodes.push(node);
        }
      }

      // The Layer has an x/y offset (stageOverflow) and a scale that includes both
      // the design-to-canvas ratio and the user's zoom level.
      // stage.toDataURL x/y/width/height are in stage pixel coordinates.
      // We read the layer's actual transform so the capture is correct at any zoom level.
      const layer = stage.getLayers()[0];
      const layerX = layer ? layer.x() : 0;
      const layerY = layer ? layer.y() : 0;
      const layerScale = layer ? layer.scaleX() : scale; // scale * zoomLevel

      // Region in stage pixels for exactly one slide
      const regionX = layerX + slideLeft * layerScale;
      const regionY = layerY;
      const regionWidth = slideWidth * layerScale;
      const regionHeight = DESIGN_HEIGHT * layerScale;

      // Convert design multiplier → Konva pixelRatio (output pixels per stage pixel).
      // output = regionWidth * effectivePixelRatio = slideWidth * layerScale * (pixelRatio / layerScale)
      //        = slideWidth * pixelRatio  ← correct regardless of zoom or viewport size
      const effectivePixelRatio = pixelRatio / layerScale;

      // Clear a KonvaImage node's cache ONLY when the export resolution exceeds
      // THAT node's cached resolution — otherwise its cache is already at least
      // as detailed as the output and re-rasterizing is pure waste (esp. for
      // thumbnails at 0.25x which never need this). The cache density is the
      // user's canvas-resolution preference (times a content-rotation cover
      // factor), recorded per-node as `cachePixelRatio` by CanvasElementRenderer.
      // Comparing per-node is required because that density can now be below the
      // display ratio (e.g. 1080p canvas on a HiDPI screen) — a stage-wide
      // displayPixelRatio baseline would skip refresh and export a blurry cache.
      // Nodes in "Full" mode aren't cached at all, so they always draw from
      // source at the export resolution.
      const displayPixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const wereCached: Konva.Image[] = [];
      const imageNodes = stage.find('Image') as Konva.Image[];
      for (const node of imageNodes) {
        if (!node.isCached()) continue;
        const nodeRatio = (node.getAttr('cachePixelRatio') as number | undefined) ?? displayPixelRatio;
        if (effectivePixelRatio > nodeRatio + 0.01) {
          wereCached.push(node);
          node.clearCache();
        }
      }

      try {
        const dataURL = stage.toDataURL({
          x: regionX,
          y: regionY,
          width: regionWidth,
          height: regionHeight,
          pixelRatio: effectivePixelRatio,
          mimeType: format === 'png' ? 'image/png' : 'image/jpeg',
          quality: format === 'jpeg' ? quality : undefined,
        });

        return dataURL;
      } catch (error) {
        console.error(`Failed to render slide ${slideIndex + 1}:`, error);
        return null;
      } finally {
        // Restore hidden nodes
        for (const node of hiddenNodes) {
          node.show();
        }
        // Re-cache images so drag perf isn't degraded after export. Use the
        // ratio CanvasElementRenderer recorded on the node (which includes
        // the content-rotation cover factor for rotated images) — falling
        // back to plain display pixelRatio.
        if (wereCached.length > 0) {
          for (const node of wereCached) {
            try {
              const ratio = (node.getAttr('cachePixelRatio') as number | undefined) ?? displayPixelRatio;
              node.cache({ pixelRatio: ratio });
            } catch {
              // cache() throws on zero-size nodes; safe to skip
            }
          }
          stage.batchDraw();
        }
      }
    },
    [stageRef, project, scale]
  );

  const renderSlideForExport = useCallback(
    (
      slideIndex: number,
      pixelRatio: number,
      format: 'png' | 'jpeg',
      quality: number
    ): string | null => {
      return renderClean(slideIndex, pixelRatio, format, quality);
    },
    [renderClean]
  );

  const renderSlideThumbnail = useCallback(
    (slideIndex: number): string | null => {
      return renderClean(slideIndex, 0.25, 'jpeg', 0.6);
    },
    [renderClean]
  );

  // Preview render: caller specifies target pixel width, JPEG 0.85 quality, no UI handles
  const renderSlideForPreview = useCallback(
    (slideIndex: number, targetWidth: number): string | null => {
      if (!project) return null;
      const slideWidth = getSlideWidth(project.aspectRatio);
      // pixelRatio = design multiplier: targetWidth / slideWidth gives targetWidth output pixels
      const pixelRatio = targetWidth / slideWidth;
      return renderClean(slideIndex, pixelRatio, 'jpeg', 0.85);
    },
    [renderClean, project]
  );

  return { renderSlideForExport, renderSlideThumbnail, renderSlideForPreview };
}
