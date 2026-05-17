import { useState, useEffect } from 'react';

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 1.5;
const ZOOM_STEP = 0.1;

interface UseCanvasZoomOptions {
  scrollContainerRef: React.RefObject<HTMLDivElement>;
  stageContainerRef: React.RefObject<HTMLDivElement>;
  numSlides: number;
  canvasSize: { width: number; height: number };
}

/**
 * Hook for managing canvas zoom functionality
 * Handles zoom controls, keyboard shortcuts, and mouse wheel zoom
 */
export function useCanvasZoom({
  scrollContainerRef,
  stageContainerRef,
  numSlides,
  canvasSize,
}: UseCanvasZoomOptions) {
  const [zoomLevel, setZoomLevel] = useState(1);

  // Handle Cmd/Ctrl + scroll for zoom (relative to mouse position)
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        const stage = stageContainerRef.current;
        if (!stage) return;

        // Canvas point under the mouse, in unzoomed canvas-pixel coordinates.
        // (stageContainer has paddingLeft: 24; canvas content starts there.)
        const stageRect = stage.getBoundingClientRect();
        const canvasX = (e.clientX - stageRect.left - 24) / zoomLevel;
        const canvasY = (e.clientY - stageRect.top) / zoomLevel;

        // Normalize scroll delta and apply zoom
        const zoomDelta = -e.deltaY * 0.002;
        const newZoomLevel = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoomLevel + zoomDelta));
        if (newZoomLevel === zoomLevel) return;

        setZoomLevel(newZoomLevel);

        // After React re-renders with the new zoom, the stage rect has shifted
        // (centering / size change). Compute scroll so the same canvas point
        // ends up under the mouse again. Browser clamps to scroll bounds.
        requestAnimationFrame(() => {
          const scroll = scrollContainerRef.current;
          const stageEl = stageContainerRef.current;
          if (!scroll || !stageEl) return;
          const newStageRect = stageEl.getBoundingClientRect();
          const desiredStageLeft = e.clientX - 24 - canvasX * newZoomLevel;
          const desiredStageTop = e.clientY - canvasY * newZoomLevel;
          scroll.scrollLeft += newStageRect.left - desiredStageLeft;
          scroll.scrollTop += newStageRect.top - desiredStageTop;
        });
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [zoomLevel, numSlides, canvasSize.width, canvasSize.height, scrollContainerRef, stageContainerRef]);

  const zoomIn = () => setZoomLevel((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP));
  const zoomOut = () => setZoomLevel((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP));
  const resetZoom = () => setZoomLevel(1);

  return {
    zoomLevel,
    setZoomLevel,
    zoomIn,
    zoomOut,
    resetZoom,
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
    zoomStep: ZOOM_STEP,
  };
}
