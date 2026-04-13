import { useEffect, useRef, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { Element } from '../../types';
import { getSlideIndex, getSlideIndexFromCenter } from '../../utils/slideUtils';
import { useProjectStore } from '../../stores/projectStore';
import { useSlideStore } from '../../stores/slideStore';
import { useElementStore } from '../../stores/elementStore';
import { useMediaStore } from '../../stores/mediaStore';
import { updateDragLabel } from '../../components/Editor/DragPreview';
import { findFillBounds, type FillBounds } from '../../utils/snapping';
import type { ReplaceTarget } from './useCanvasFillMode';

interface UseCanvasMediaDropOptions {
  stageContainerRef: React.RefObject<HTMLDivElement>;
  numSlides: number;
  canvasSize: { width: number; height: number };
  scale: number;
  zoomLevel: number;
  designSize: { width: number; height: number };
  totalDesignWidth: number;
  elements: Element[];
  fillKeyRef: React.RefObject<boolean>;
  replaceKeyRef: React.RefObject<boolean>;
  fillLinesRef: React.RefObject<{ vertical: number[]; horizontal: number[] } | null>;
  getReplacementTarget: (designX: number, designY: number, excludeId?: string) => ReplaceTarget | null;
}

/**
 * Hook for handling media drop from media pool onto canvas.
 * Fill mode (hold F) fills the snap-line-bounded region.
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
  fillKeyRef,
  replaceKeyRef,
  fillLinesRef,
  getReplacementTarget,
}: UseCanvasMediaDropOptions) {
  const project = useProjectStore((s) => s.project);
  const setCurrentSlide = useSlideStore((s) => s.setCurrentSlide);
  const addElement = useElementStore((s) => s.addElement);
  const updateElement = useElementStore((s) => s.updateElement);
  const draggingMediaId = useMediaStore((s) => s.draggingMediaId);
  const setDraggingMedia = useMediaStore((s) => s.setDraggingMedia);
  const clearMediaSelection = useMediaStore((s) => s.clearMediaSelection);

  // --- Fill preview state (exposed to CanvasArea for rendering) ---
  const fillPreviewRef = useRef<FillBounds | null>(null);
  const fillPreviewListenerRef = useRef<((bounds: FillBounds | null) => void) | null>(null);

  const setFillPreview = useCallback((bounds: FillBounds | null) => {
    const changed = (fillPreviewRef.current === null) !== (bounds === null);
    fillPreviewRef.current = bounds;
    fillPreviewListenerRef.current?.(bounds);
    if (changed) updateDragLabel(bounds ? 'Fill area (F)' : 'Drop on canvas');
  }, []);

  // --- Replace preview state (exposed to CanvasArea for rendering) ---
  const replacePreviewRef = useRef<ReplaceTarget | null>(null);
  const replacePreviewListenerRef = useRef<((target: ReplaceTarget | null) => void) | null>(null);

  const setReplacePreview = useCallback((target: ReplaceTarget | null) => {
    const changed = (replacePreviewRef.current === null) !== (target === null);
    replacePreviewRef.current = target;
    replacePreviewListenerRef.current?.(target);
    if (changed) updateDragLabel(target ? 'Replace image (R)' : 'Drop on canvas');
  }, []);

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

  // Helper: screen position → design coordinates
  const screenToDesign = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
    const container = stageContainerRef.current;
    if (!container) return null;
    const state = dropStateRef.current;
    const rect = container.getBoundingClientRect();
    const sx = clientX - rect.left - 24;
    const sy = clientY - rect.top;
    const totalScreenW = state.numSlides * state.canvasSize.width;
    if (sx < 0 || sx > totalScreenW || sy < 0 || sy > state.canvasSize.height) return null;
    return {
      x: sx / (state.scale * state.zoomLevel),
      y: sy / (state.scale * state.zoomLevel),
    };
  }, [stageContainerRef]);

  // Mousemove handler for fill/replace preview during media drag
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const state = dropStateRef.current;
      if (!state.draggingMediaId) return;

      const pos = screenToDesign(e.clientX, e.clientY);

      // Fill preview
      const lines = fillLinesRef.current;
      if (fillKeyRef.current && lines && pos) {
        const bounds = findFillBounds(pos.x, pos.y, lines.vertical, lines.horizontal);
        if (bounds.width > 0 && bounds.height > 0) {
          setFillPreview(bounds);
        } else {
          setFillPreview(null);
        }
      } else if (fillPreviewRef.current) {
        setFillPreview(null);
      }

      // Replace preview
      if (replaceKeyRef.current && pos) {
        const target = getReplacementTarget(pos.x, pos.y);
        if (target) {
          setReplacePreview(target);
        } else {
          setReplacePreview(null);
        }
      } else if (replacePreviewRef.current) {
        setReplacePreview(null);
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [screenToDesign, setFillPreview, setReplacePreview, fillKeyRef, replaceKeyRef, fillLinesRef, getReplacementTarget]);

  // Handle drop of media onto canvas via window mouseup
  useEffect(() => {
    const handleMouseUp = (e: MouseEvent) => {
      const state = dropStateRef.current;
      if (!state.draggingMediaId) return;

      setFillPreview(null);
      setReplacePreview(null);

      if (!state.project || !stageContainerRef.current) {
        setDraggingMedia(null);
        return;
      }

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

      const pos = screenToDesign(e.clientX, e.clientY);
      if (!pos) {
        setDraggingMedia(null);
        return;
      }

      const dropX = pos.x;
      const dropY = pos.y;

      // --- Replace mode: R key held, replace target element's media ---
      if (replaceKeyRef.current) {
        const target = getReplacementTarget(dropX, dropY);
        if (target) {
          const frameRatio = target.width / target.height;
          const mediaRatio = media.width / media.height;

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

          updateElement(target.elementId, {
            mediaId: media.id,
            assetPath: undefined,
            cropX,
            cropY,
            cropWidth,
            cropHeight,
            lastCropRatio: null,
          });

          const slideIndex = getSlideIndexFromCenter(target.x, target.width, state.designSize.width);
          if (slideIndex >= 0 && slideIndex < state.numSlides) {
            setCurrentSlide(slideIndex);
          }
          return;
        }
      }

      // --- Fill mode: F key held + fill lines ready ---
      const lines = fillLinesRef.current;
      if (fillKeyRef.current && lines) {
        const bounds = findFillBounds(dropX, dropY, lines.vertical, lines.horizontal);
        if (bounds.width > 0 && bounds.height > 0) {
          const frameRatio = bounds.width / bounds.height;
          const mediaRatio = media.width / media.height;

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

          const maxZIndex = state.elements.length > 0
            ? Math.max(...state.elements.map(el => el.zIndex)) + 1
            : 0;

          const newElement: Element = {
            id: uuidv4(),
            type: 'photo',
            mediaId: media.id,
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
            rotation: 0,
            scale: 1,
            locked: false,
            zIndex: maxZIndex,
            cropX,
            cropY,
            cropWidth,
            cropHeight,
            lastCropRatio: null,
          };

          setDraggingMedia(null);
          clearMediaSelection();
          addElement(newElement);

          const slideIndex = getSlideIndexFromCenter(bounds.x, bounds.width, state.designSize.width);
          if (slideIndex >= 0 && slideIndex < state.numSlides) {
            setCurrentSlide(slideIndex);
          }
          return;
        }
      }

      // --- Check if dropping on a placeholder frame ---
      const placeholderFrame = state.elements.find((el) => {
        if (el.type !== 'placeholder') return false;
        return dropX >= el.x && dropX <= el.x + el.width && dropY >= el.y && dropY <= el.y + el.height;
      });

      if (placeholderFrame) {
        const frameRatio = placeholderFrame.width / placeholderFrame.height;
        const mediaRatio = media.width / media.height;

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

      // --- Normal drop ---
      const mediaRatio = media.width / media.height;
      let elementWidth = Math.min(state.designSize.width * 0.5, media.width);
      let elementHeight = elementWidth / mediaRatio;

      if (elementHeight > state.designSize.height * 0.5) {
        elementHeight = state.designSize.height * 0.5;
        elementWidth = elementHeight * mediaRatio;
      }

      const x = Math.max(0, Math.min(dropX - elementWidth / 2, state.totalDesignWidth - elementWidth));
      const y = Math.max(0, Math.min(dropY - elementHeight / 2, state.designSize.height - elementHeight));

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
  }, [setDraggingMedia, clearMediaSelection, addElement, updateElement, setCurrentSlide, screenToDesign, setFillPreview, setReplacePreview, fillKeyRef, replaceKeyRef, fillLinesRef, getReplacementTarget]);

  return {
    fillPreviewRef,
    fillPreviewListenerRef,
    replacePreviewListenerRef,
  };
}
