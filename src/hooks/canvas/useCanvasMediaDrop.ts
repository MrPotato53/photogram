import { useEffect, useRef, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { Element } from '../../types';
import { getSlideIndex, getSlideIndexFromCenter } from '../../utils/slideUtils';
import { embedElementAsset } from '../../services/tauri';
import { useProjectStore } from '../../stores/projectStore';
import { useHistoryStore } from '../../stores/historyStore';
import { useSlideStore } from '../../stores/slideStore';
import { useElementStore } from '../../stores/elementStore';
import { useMediaStore } from '../../stores/mediaStore';
import { updateDragLabel } from '../../components/Editor/DragPreview';
import { findFillBounds, type FillBounds } from '../../utils/snapping';
import { coverCrop } from '../../utils/photoFraming';
import { buildPhotoPayload } from '../../utils/photoTransfer';
import { findPlaceholderAt, type ReplaceTarget } from './useCanvasFillMode';

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
  const selectElement = useElementStore((s) => s.selectElement);
  const draggingMediaId = useMediaStore((s) => s.draggingMediaId);
  const setDraggingMedia = useMediaStore((s) => s.setDraggingMedia);
  const clearMediaSelection = useMediaStore((s) => s.clearMediaSelection);

  // --- Fill preview state (exposed to CanvasArea for rendering) ---
  const fillPreviewRef = useRef<FillBounds | null>(null);
  const fillPreviewListenerRef = useRef<((bounds: FillBounds | null) => void) | null>(null);
  const fillLabelRef = useRef('Drop on canvas');

  const setFillPreview = useCallback((bounds: FillBounds | null, isFrame = false) => {
    fillPreviewRef.current = bounds;
    fillPreviewListenerRef.current?.(bounds);
    const label = bounds ? (isFrame ? 'Fill frame (F)' : 'Fill area (F)') : 'Drop on canvas';
    if (label !== fillLabelRef.current) {
      fillLabelRef.current = label;
      updateDragLabel(label);
    }
  }, []);

  // --- Replace preview state (exposed to CanvasArea for rendering) ---
  const replacePreviewRef = useRef<ReplaceTarget | null>(null);
  const replacePreviewListenerRef = useRef<((target: ReplaceTarget | null) => void) | null>(null);
  const replaceLabelRef = useRef('Drop on canvas');

  const setReplacePreview = useCallback((target: ReplaceTarget | null) => {
    replacePreviewRef.current = target;
    replacePreviewListenerRef.current?.(target);
    const label = target
      ? (target.targetType === 'placeholder' ? 'Fill frame (R)' : 'Replace image (R)')
      : 'Drop on canvas';
    if (label !== replaceLabelRef.current) {
      replaceLabelRef.current = label;
      updateDragLabel(label);
    }
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

      // Fill preview. A placeholder frame under the cursor wins over the
      // snap-line region: the frame IS the fill target (and region lookup
      // is wrong for multi-slide frames, which are split by the
      // slide-boundary snap line).
      const lines = fillLinesRef.current;
      if (fillKeyRef.current && pos) {
        const frame = findPlaceholderAt(state.elements, pos.x, pos.y);
        if (frame) {
          setFillPreview(frame, true);
        } else if (lines) {
          const bounds = findFillBounds(pos.x, pos.y, lines.vertical, lines.horizontal);
          if (bounds.width > 0 && bounds.height > 0) {
            setFillPreview(bounds);
          } else {
            setFillPreview(null);
          }
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
          setDraggingMedia(null);
          clearMediaSelection();

          const projectId = state.project.id;
          const oldElement = state.elements.find((el) => el.id === target.elementId);
          const oldAssetPath = oldElement?.assetPath;

          void (async () => {
            // Embed the new media as the element's own asset copy (same
            // ownership model as addElement). Use a fresh id for the
            // filename — reusing the element id would overwrite the
            // element's existing asset file in place, breaking undo.
            let assetPath: string | undefined;
            try {
              assetPath = await embedElementAsset(projectId, uuidv4(), media.filePath);
            } catch (error) {
              console.error('Failed to embed asset for replace:', error);
            }

            // Placeholder targets become photos (fill the frame); for photo
            // targets this is a no-op. The frame's own canvas rotation is
            // preserved (this is a merge), but the straighten angle and
            // flips are not: they belonged to the OUTGOING photo, and
            // carrying them over would transform the new image by an amount
            // the user never chose for it. A pool item arrives with no edits
            // of its own, so the payload defaults handle that.
            await updateElement(
              target.elementId,
              buildPhotoPayload({
                mediaId: media.id,
                assetPath,
                mediaWidth: media.width,
                mediaHeight: media.height,
                frameWidth: target.width,
                frameHeight: target.height,
              })
            );

            // Select the result — dropping media is an interaction with
            // this element, so the border should land on it.
            selectElement(target.elementId);

            // The replaced element's old embedded asset is no longer
            // referenced by the live project — register it for cleanup
            // when it falls off the history stack (mirrors removeElement).
            if (oldAssetPath && oldAssetPath !== assetPath) {
              useHistoryStore.getState().trackOrphanedAsset(oldAssetPath, oldElement?.mediaId);
            }
          })();

          const slideIndex = getSlideIndexFromCenter(target.x, target.width, state.designSize.width);
          if (slideIndex >= 0 && slideIndex < state.numSlides) {
            setCurrentSlide(slideIndex);
          }
          return;
        }
      }

      // --- Check if dropping on a placeholder frame ---
      // Checked BEFORE fill mode: with F held over a frame, the frame is
      // the fill target. The snap-line region would create a NEW element
      // over the frame (leaving the empty frame beneath) — and for a
      // multi-slide frame the region is split at the slide boundary, so
      // it would only cover half the frame.
      // Topmost frame by z-order — must match the preview's hit-test so
      // the frame that highlights is the frame that fills.
      const placeholderFrame = findPlaceholderAt(state.elements, dropX, dropY);

      // --- Fill mode: F key held + fill lines ready (no frame hit) ---
      const lines = fillLinesRef.current;
      if (!placeholderFrame && fillKeyRef.current && lines) {
        const bounds = findFillBounds(dropX, dropY, lines.vertical, lines.horizontal);
        if (bounds.width > 0 && bounds.height > 0) {
          const crop = coverCrop(media.width, media.height, bounds.width, bounds.height);

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
            ...crop,
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

      if (placeholderFrame) {
        setDraggingMedia(null);
        clearMediaSelection();

        const projectId = state.project.id;
        void (async () => {
          // Embed like addElement does so the element owns its own copy
          // of the image instead of referencing the media pool file.
          // Fresh uuid for the FILENAME (not the element id): the asset
          // path must be unique per fill. Keyed by element id, refilling
          // the same frame (e.g. after an undo) overwrites the previous
          // asset file in place — history snapshots then point at the new
          // image's bytes, and the unchanged URL makes the image cache
          // keep serving the OLD image for the new fill.
          let assetPath: string | undefined;
          try {
            assetPath = await embedElementAsset(projectId, uuidv4(), media.filePath);
          } catch (error) {
            console.error('Failed to embed asset for placeholder fill:', error);
          }

          // Frame rotation is kept (merge); the straighten angle and flips
          // are not — they belonged to whatever was in the frame before.
          await updateElement(
            placeholderFrame.elementId,
            buildPhotoPayload({
              mediaId: media.id,
              assetPath,
              mediaWidth: media.width,
              mediaHeight: media.height,
              frameWidth: placeholderFrame.width,
              frameHeight: placeholderFrame.height,
            })
          );

          // Select the filled frame — same rationale as the replace path.
          selectElement(placeholderFrame.elementId);
        })();

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
  }, [setDraggingMedia, clearMediaSelection, addElement, updateElement, selectElement, setCurrentSlide, screenToDesign, setFillPreview, setReplacePreview, fillKeyRef, replaceKeyRef, fillLinesRef, getReplacementTarget]);

  return {
    fillPreviewRef,
    fillPreviewListenerRef,
    replacePreviewListenerRef,
  };
}
