import { useRef, useCallback, useEffect } from 'react';

interface UseCanvasAutoScrollOptions {
  scrollContainerRef: React.RefObject<HTMLDivElement>;
  canvasSize: { width: number };
  zoomLevel: number;
}

/**
 * Hook for managing auto-scroll when dragging elements near canvas edges.
 *
 * Driven entirely by updateScrollSpeed(mouseX), called from Konva dragmove
 * handlers. When the cursor is at/past the container edge, scrolling
 * continues at max speed via the rAF loop even if the cursor stops moving
 * (Konva stops firing dragmove, but the loop keeps the last speed until
 * stopAutoScroll on drag end).
 */
export function useCanvasAutoScroll({
  scrollContainerRef,
  canvasSize,
  zoomLevel,
}: UseCanvasAutoScrollOptions) {
  // Auto-scroll on drag refs
  const autoScrollRef = useRef<number | null>(null); // Animation frame ID
  const dragScrollSpeedRef = useRef<number>(0); // Current scroll speed (pixels per frame)

  // Auto-scroll animation loop
  const animateScroll = useCallback(() => {
    if (dragScrollSpeedRef.current !== 0 && scrollContainerRef.current) {
      scrollContainerRef.current.scrollLeft += dragScrollSpeedRef.current;
      autoScrollRef.current = requestAnimationFrame(animateScroll);
    } else {
      autoScrollRef.current = null;
    }
  }, [scrollContainerRef]);

  // Start auto-scroll animation if not already running
  const startAutoScroll = useCallback(() => {
    if (autoScrollRef.current === null && dragScrollSpeedRef.current !== 0) {
      autoScrollRef.current = requestAnimationFrame(animateScroll);
    }
  }, [animateScroll]);

  // Stop auto-scroll animation
  const stopAutoScroll = useCallback(() => {
    if (autoScrollRef.current !== null) {
      cancelAnimationFrame(autoScrollRef.current);
      autoScrollRef.current = null;
    }
    dragScrollSpeedRef.current = 0;
  }, []);

  // Kill any running loop on unmount
  useEffect(() => stopAutoScroll, [stopAutoScroll]);

  // Update scroll speed during drag move (called from drag handlers)
  const updateScrollSpeed = useCallback((mouseX: number) => {
    if (!scrollContainerRef.current) return;

    const scrollContainer = scrollContainerRef.current;
    const scrollRect = scrollContainer.getBoundingClientRect();
    const visibleLeft = scrollRect.left;
    const visibleRight = scrollRect.right;
    const edgeZone = 100;
    // Max speed: ~2 slides/second at 60fps
    const maxSpeed = (2 * canvasSize.width * zoomLevel) / 60;
    // 1px tolerance so exact edge pixels (fullscreen) count as outside
    const tolerance = 1;

    let scrollSpeed = 0;

    if (mouseX <= visibleLeft + tolerance) {
      // Cursor at or past the left edge — full speed left
      scrollSpeed = -maxSpeed;
    } else if (mouseX >= visibleRight - tolerance) {
      // Cursor at or past the right edge — full speed right
      scrollSpeed = maxSpeed;
    } else {
      const distanceToLeft = mouseX - visibleLeft;
      if (distanceToLeft < edgeZone) {
        const proximity = 1 - (distanceToLeft / edgeZone);
        scrollSpeed = -maxSpeed * proximity;
      }

      const distanceToRight = visibleRight - mouseX;
      if (distanceToRight < edgeZone) {
        const proximity = 1 - (distanceToRight / edgeZone);
        scrollSpeed = Math.max(scrollSpeed, maxSpeed * proximity);
      }
    }

    dragScrollSpeedRef.current = scrollSpeed;
    if (scrollSpeed !== 0) {
      startAutoScroll();
    } else {
      stopAutoScroll();
    }
  }, [scrollContainerRef, canvasSize.width, zoomLevel, startAutoScroll, stopAutoScroll]);

  return {
    startAutoScroll,
    stopAutoScroll,
    updateScrollSpeed,
  };
}
