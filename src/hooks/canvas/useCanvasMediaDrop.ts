import { useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { Element } from '../../types';
import { getSlideIndex, getSlideIndexFromCenter } from '../../utils/slideUtils';
import { useProjectStore } from '../../stores/projectStore';
import { useSlideStore } from '../../stores/slideStore';
import { useElementStore } from '../../stores/elementStore';
import { useMediaStore } from '../../stores/mediaStore';

interface UseCanvasMediaDropOptions {
  stageContainerRef: React.RefObject<HTMLDivElement>;
  numSlides: number;
  canvasSize: { width: number; height: number };
  scale: number;
  zoomLevel: number;
  designSize: { width: number; height: number };
  totalDesignWidth: number;
  elements: Element[];
}

/**
 * Hook for handling media drop from media pool onto canvas
 */
export function useCanvasMediaDrop({
  stageContainerRef,
  numSlides,
  canvasSize,
  scale,
  zoomLevel,
  designSize,
  totalDesignWidth,
  elements,
}: UseCanvasMediaDropOptions) {
  const project = useProjectStore((s) => s.project);
  const setCurrentSlide = useSlideStore((s) => s.setCurrentSlide);
  const addElement = useElementStore((s) => s.addElement);
  const updateElement = useElementStore((s) => s.updateElement);
  const draggingMediaId = useMediaStore((s) => s.draggingMediaId);
  const setDraggingMedia = useMediaStore((s) => s.setDraggingMedia);
  const clearMediaSelection = useMediaStore((s) => s.clearMediaSelection);

  // Refs for drop handling (to avoid stale closures in always-attached listener)
  const dropStateRef = useRef({
    draggingMediaId: null as string | null,
    project: null as typeof project,
    numSlides: 0,
    canvasSize: { width: 0, height: 0 },
    scale: 1,
    zoomLevel: 1,
    designSize: { width: 0, height: 0 },
    totalDesignWidth: 0,
    elements: [] as Element[],
  });

  // Keep refs updated
  useEffect(() => {
    dropStateRef.current = {
      draggingMediaId,
      project,
      numSlides,
      canvasSize,
      scale,
      zoomLevel,
      designSize,
      totalDesignWidth,
      elements,
    };
  }, [draggingMediaId, project, numSlides, canvasSize, scale, zoomLevel, designSize, totalDesignWidth, elements]);

  // Handle drop of media onto canvas via window mouseup (always attached, reads from refs)
  useEffect(() => {
    const handleMouseUp = (e: MouseEvent) => {
      const state = dropStateRef.current;

      // Only handle if we're dragging
      if (!state.draggingMediaId) return;

      if (!state.project || !stageContainerRef.current) {
        setDraggingMedia(null);

        return;
      }

      // Check if mouse is over a panel or other drop-cancel zone
      const elementUnderMouse = document.elementFromPoint(e.clientX, e.clientY);
      if (elementUnderMouse) {
        const isOverPanel = elementUnderMouse.closest('[data-panel]') !== null;
        if (isOverPanel) {
          setDraggingMedia(null);
  
          return;
        }
      }

      const media = state.project.mediaPool.find((m) => m.id === state.draggingMediaId);
      if (!media) {
        setDraggingMedia(null);

        return;
      }

      // Get the stage container's bounding rect
      const stageRect = stageContainerRef.current.getBoundingClientRect();

      // Calculate drop position relative to the stage container (accounting for padding)
      const dropScreenX = e.clientX - stageRect.left - 24; // 24px left padding
      const dropScreenY = e.clientY - stageRect.top;

      // Check if drop is within canvas bounds
      const totalScreenWidth = state.numSlides * state.canvasSize.width;
      if (dropScreenX < 0 || dropScreenX > totalScreenWidth || dropScreenY < 0 || dropScreenY > state.canvasSize.height) {
        setDraggingMedia(null);

        return;
      }

      // Convert to design coordinates (global across all slides)
      const dropX = dropScreenX / (state.scale * state.zoomLevel);
      const dropY = dropScreenY / (state.scale * state.zoomLevel);

      // Check if dropping on a placeholder frame
      const placeholderFrame = state.elements.find((el) => {
        if (el.type !== 'placeholder') return false;
        const inX = dropX >= el.x && dropX <= el.x + el.width;
        const inY = dropY >= el.y && dropY <= el.y + el.height;
        return inX && inY;
      });

      if (placeholderFrame) {
        // Fill the placeholder with the image, calculating crop to cover the frame
        const frameRatio = placeholderFrame.width / placeholderFrame.height;
        const mediaRatio = media.width / media.height;

        // Calculate crop to fill the frame (cover mode)
        let cropX = 0;
        let cropY = 0;
        let cropWidth = 1;
        let cropHeight = 1;

        if (mediaRatio > frameRatio) {
          cropWidth = frameRatio / mediaRatio;
          cropX = (1 - cropWidth) / 2;
        } else if (mediaRatio < frameRatio) {
          cropHeight = mediaRatio / frameRatio;
          cropY = (1 - cropHeight) / 2;
        }

        setDraggingMedia(null);

        clearMediaSelection();

        updateElement(placeholderFrame.id, {
          type: 'photo',
          mediaId: media.id,
          cropX,
          cropY,
          cropWidth,
          cropHeight,
        });

        const slideIndex = getSlideIndexFromCenter(placeholderFrame.x, placeholderFrame.width, state.designSize.width);
        if (slideIndex >= 0 && slideIndex < state.numSlides) {
          setCurrentSlide(slideIndex);
        }
        return;
      }

      // Calculate element size (50% of slide while maintaining aspect ratio)
      const mediaRatio = media.width / media.height;
      let elementWidth = Math.min(state.designSize.width * 0.5, media.width);
      let elementHeight = elementWidth / mediaRatio;

      if (elementHeight > state.designSize.height * 0.5) {
        elementHeight = state.designSize.height * 0.5;
        elementWidth = elementHeight * mediaRatio;
      }

      // Center on drop position, clamp to total canvas bounds
      const x = Math.max(0, Math.min(dropX - elementWidth / 2, state.totalDesignWidth - elementWidth));
      const y = Math.max(0, Math.min(dropY - elementHeight / 2, state.designSize.height - elementHeight));

      // Calculate max zIndex
      const maxZIndex = state.elements.length > 0
        ? Math.max(...state.elements.map(el => el.zIndex)) + 1
        : 0;

      const newElement: Element = {
        id: uuidv4(),
        type: 'photo',
        mediaId: media.id,
        x,
        y,
        width: elementWidth,
        height: elementHeight,
        rotation: 0,
        scale: 1,
        locked: false,
        zIndex: maxZIndex,
      };

      setDraggingMedia(null);
      clearMediaSelection();

      addElement(newElement);

      const slideIndex = getSlideIndex(dropX, state.designSize.width);
      if (slideIndex >= 0 && slideIndex < state.numSlides) {
        setCurrentSlide(slideIndex);
      }
    };

    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, [setDraggingMedia, clearMediaSelection, addElement, updateElement, setCurrentSlide]);

  return {};
}

