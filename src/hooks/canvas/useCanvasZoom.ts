import { useState, useEffect } from 'react';

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 1.5;
const ZOOM_STEP = 0.1;

interface UseCanvasZoomOptions {
  scrollContainerRef: React.RefObject<HTMLDivElement>;
  numSlides: number;
  canvasSize: { width: number; height: number };
}

/**
 * Hook for managing canvas zoom functionality
 * Handles zoom controls, keyboard shortcuts, and mouse wheel zoom
 */
export function useCanvasZoom({
  scrollContainerRef,
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

        const totalContentWidth = numSlides * canvasSize.width * zoomLevel + 48;
        const totalContentHeight = canvasSize.height * zoomLevel;
        const isScrollable = totalContentWidth > container.clientWidth || totalContentHeight > container.clientHeight;

        // Calculate the point under the mouse in content coordinates (before zoom)
        // When content is centered, there's an offset we need to account for
        let contentOffsetX = 0;
        let contentOffsetY = 0;
        if (!isScrollable) {
          // Content is centered - calculate the offset
          contentOffsetX = Math.max(0, (container.clientWidth - totalContentWidth) / 2);
          contentOffsetY = Math.max(0, (container.clientHeight - totalContentHeight) / 2);
        }

        // Mouse position relative to scroll container
        const containerRect = container.getBoundingClientRect();
        const mouseXInContainer = e.clientX - containerRect.left;
        const mouseYInContainer = e.clientY - containerRect.top;

        // Convert to content coordinates (accounting for scroll and centering offset)
        const mouseXInContent = container.scrollLeft + mouseXInContainer - contentOffsetX;
        const mouseYInContent = container.scrollTop + mouseYInContainer - contentOffsetY;

        // Convert to canvas coordinates (in unzoomed space, excluding padding)
        const canvasX = (mouseXInContent - 24) / zoomLevel;
        const canvasY = mouseYInContent / zoomLevel;

        // Normalize scroll delta and apply zoom
        const zoomDelta = -e.deltaY * 0.002;
        const newZoomLevel = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoomLevel + zoomDelta));

        if (newZoomLevel !== zoomLevel) {
          // Calculate new content dimensions
          const newContentWidth = numSlides * canvasSize.width * newZoomLevel + 48;
          const newContentHeight = canvasSize.height * newZoomLevel;
          const widthOverflows = newContentWidth > container.clientWidth;
          const heightOverflows = newContentHeight > container.clientHeight;

          // Calculate target scroll positions based on canvas point under mouse
          const newMouseXInContent = canvasX * newZoomLevel + 24;
          const newMouseYInContent = canvasY * newZoomLevel;

          // Only adjust scroll for dimensions that overflow; let flexbox center the rest
          const targetScrollLeft = widthOverflows
            ? Math.max(0, Math.min(newMouseXInContent - mouseXInContainer, newContentWidth - container.clientWidth))
            : 0;
          const targetScrollTop = heightOverflows
            ? Math.max(0, Math.min(newMouseYInContent - mouseYInContainer, newContentHeight - container.clientHeight))
            : 0;

          // Store scroll targets before zoom change
          const scrollTargets = { left: targetScrollLeft, top: targetScrollTop };

          setZoomLevel(newZoomLevel);

          // Apply scroll adjustment after React re-renders with new zoom
          requestAnimationFrame(() => {
            if (!scrollContainerRef.current) return;
            scrollContainerRef.current.scrollTo({
              left: scrollTargets.left,
              top: scrollTargets.top,
              behavior: 'auto',
            });
          });
        }
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [zoomLevel, numSlides, canvasSize.width, canvasSize.height, scrollContainerRef]);

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

