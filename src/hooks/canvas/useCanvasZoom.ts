import { useState, useEffect, useRef } from 'react';

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
  // Latest zoom target, updated synchronously per wheel event. Fast
  // trackpad gestures fire several wheel events between React renders;
  // accumulating on the closure's zoomLevel would compute every step from
  // the same stale base and silently drop all but the last one.
  const zoomTargetRef = useRef(zoomLevel);
  useEffect(() => {
    zoomTargetRef.current = zoomLevel;
  }, [zoomLevel]);

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
        // Uses the closure zoomLevel (the zoom the DOM is rendered at), not
        // the accumulation target, so the anchor matches the visible layout.
        const stageRect = stage.getBoundingClientRect();
        const canvasX = (e.clientX - stageRect.left - 24) / zoomLevel;
        const canvasY = (e.clientY - stageRect.top) / zoomLevel;

        // Normalize scroll delta and apply zoom on the accumulation target
        const zoomDelta = -e.deltaY * 0.002;
        const newZoomLevel = Math.max(
          MIN_ZOOM,
          Math.min(MAX_ZOOM, zoomTargetRef.current + zoomDelta)
        );
        if (newZoomLevel === zoomTargetRef.current) return;
        zoomTargetRef.current = newZoomLevel;

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

  // Button/keyboard zoom anchored on the current viewport center. Without
  // this anchor the scroll offset is preserved in pixels, which means the
  // top-left of the visible region drifts toward the canvas origin — the
  // user perceives this as "the viewport keeps snapping to slide 1".
  const zoomBy = (delta: number) => {
    setZoomLevel((z) => {
      const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z + delta));
      if (next === z) return z;
      const scroll = scrollContainerRef.current;
      const stage = stageContainerRef.current;
      if (!scroll || !stage) return next;
      // Pin the canvas point currently at the viewport center.
      const stageRect = stage.getBoundingClientRect();
      const scrollRect = scroll.getBoundingClientRect();
      const viewportCenterX = scrollRect.left + scroll.clientWidth / 2;
      const viewportCenterY = scrollRect.top + scroll.clientHeight / 2;
      const canvasX = (viewportCenterX - stageRect.left - 24) / z;
      const canvasY = (viewportCenterY - stageRect.top) / z;
      // Apply scroll correction after React re-renders at the new zoom.
      requestAnimationFrame(() => {
        const s = scrollContainerRef.current;
        const st = stageContainerRef.current;
        if (!s || !st) return;
        const newStageRect = st.getBoundingClientRect();
        const desiredStageLeft = viewportCenterX - 24 - canvasX * next;
        const desiredStageTop = viewportCenterY - canvasY * next;
        s.scrollLeft += newStageRect.left - desiredStageLeft;
        s.scrollTop += newStageRect.top - desiredStageTop;
      });
      return next;
    });
  };

  const zoomIn = () => zoomBy(ZOOM_STEP);
  const zoomOut = () => zoomBy(-ZOOM_STEP);
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
