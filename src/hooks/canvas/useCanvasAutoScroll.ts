import { useRef, useCallback, useEffect } from 'react';

interface UseCanvasAutoScrollOptions {
  scrollContainerRef: React.RefObject<HTMLDivElement>;
  canvasSize: { width: number };
  zoomLevel: number;
  isDragging: boolean;
}

/**
 * Hook for managing auto-scroll when dragging elements near canvas edges
 */
export function useCanvasAutoScroll({
  scrollContainerRef,
  canvasSize,
  zoomLevel,
  isDragging,
}: UseCanvasAutoScrollOptions) {
  // Auto-scroll on drag refs
  const autoScrollRef = useRef<number | null>(null); // Animation frame ID
  const dragScrollSpeedRef = useRef<number>(0); // Current scroll speed (pixels per frame)
  const isDraggingRef = useRef<boolean>(false); // Track if we're currently dragging
  const lastMouseXRef = useRef<number | null>(null); // Last known mouse X position

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

  // Update dragging state
  useEffect(() => {
    isDraggingRef.current = isDragging;
    if (!isDragging) {
      stopAutoScroll();
      lastMouseXRef.current = null;
    }
  }, [isDragging, stopAutoScroll]);

  // Global mouse move handler for auto-scroll when cursor leaves window
  // ONLY attached when actively dragging to avoid unnecessary event handling
  useEffect(() => {
    // Don't attach listener if not dragging
    if (!isDragging) return;

    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (!scrollContainerRef.current) return;

      const scrollContainer = scrollContainerRef.current;
      const scrollRect = scrollContainer.getBoundingClientRect();
      const mouseX = e.clientX;
      lastMouseXRef.current = mouseX;

      // Get visible viewport edges in screen coordinates
      const visibleLeft = scrollRect.left;
      const visibleRight = scrollRect.right;

      // Edge zone: ~100px from container edge
      const edgeZone = 100;
      // Max speed: ~2 slides/second = 2 * canvasSize.width pixels per second
      // At 60fps, that's about 2 * canvasSize.width / 60 pixels per frame
      const maxSpeed = (2 * canvasSize.width * zoomLevel) / 60;

      let scrollSpeed = 0;

      // Check if cursor is outside the container (with small tolerance for edge pixels)
      // Use <= and >= to handle exact edge pixels in fullscreen mode
      const tolerance = 1; // 1px tolerance for edge detection
      const isOutsideLeft = mouseX <= visibleLeft + tolerance;
      const isOutsideRight = mouseX >= visibleRight - tolerance;
      const isInside = !isOutsideLeft && !isOutsideRight;

      if (isInside) {
        // Cursor is inside - normal edge detection
        const distanceToLeft = mouseX - visibleLeft;
        if (distanceToLeft < edgeZone && distanceToLeft >= 0) {
          const proximity = 1 - (distanceToLeft / edgeZone);
          scrollSpeed = -maxSpeed * proximity;
        }

        const distanceToRight = visibleRight - mouseX;
        if (distanceToRight < edgeZone && distanceToRight >= 0) {
          const proximity = 1 - (distanceToRight / edgeZone);
          scrollSpeed = Math.max(scrollSpeed, maxSpeed * proximity);
        }
      } else {
        // Cursor is outside (or at exact edge) - continue scrolling in the direction it left
        if (isOutsideLeft) {
          // Cursor left to the left - scroll left at max speed
          scrollSpeed = -maxSpeed;
        } else if (isOutsideRight) {
          // Cursor left to the right - scroll right at max speed
          scrollSpeed = maxSpeed;
        }
      }

      // Update scroll speed and start animation if needed
      dragScrollSpeedRef.current = scrollSpeed;
      if (scrollSpeed !== 0) {
        startAutoScroll();
      } else {
        stopAutoScroll();
      }
    };

    window.addEventListener('mousemove', handleGlobalMouseMove);
    return () => window.removeEventListener('mousemove', handleGlobalMouseMove);
  }, [isDragging, zoomLevel, canvasSize.width, startAutoScroll, stopAutoScroll, scrollContainerRef]);

  // Update scroll speed during drag move (called from drag handlers)
  const updateScrollSpeed = useCallback((mouseX: number) => {
    if (!scrollContainerRef.current) return;

    const scrollContainer = scrollContainerRef.current;
    const scrollRect = scrollContainer.getBoundingClientRect();
    const visibleLeft = scrollRect.left;
    const visibleRight = scrollRect.right;
    const edgeZone = 100;
    const maxSpeed = (2 * canvasSize.width * zoomLevel) / 60;

    let scrollSpeed = 0;

    const distanceToLeft = mouseX - visibleLeft;
    if (distanceToLeft < edgeZone && distanceToLeft >= 0) {
      const proximity = 1 - (distanceToLeft / edgeZone);
      scrollSpeed = -maxSpeed * proximity;
    }

    const distanceToRight = visibleRight - mouseX;
    if (distanceToRight < edgeZone && distanceToRight >= 0) {
      const proximity = 1 - (distanceToRight / edgeZone);
      scrollSpeed = Math.max(scrollSpeed, maxSpeed * proximity);
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

