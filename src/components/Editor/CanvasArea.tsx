import { useRef, useEffect, useLayoutEffect, useState, useCallback, useMemo } from 'react';
import { Stage, Layer, Group, Transformer, Rect } from 'react-konva';
import type Konva from 'konva';
import type { AspectRatio, Element } from '../../types';
import { useProjectStore } from '../../stores/projectStore';
import { useSlideStore } from '../../stores/slideStore';
import { useElementStore } from '../../stores/elementStore';
import { useMediaStore } from '../../stores/mediaStore';
import { useSnapStore } from '../../stores/snapStore';
import { useCropStore } from '../../stores/cropStore';
import { useTemplatesStore } from '../../stores/templatesStore';
import { useClipboardStore } from '../../stores/clipboardStore';
import { useHistoryStore } from '../../stores/historyStore';
import { usePanelStore } from '../../stores/panelStore';
import { usePreferencesStore } from '../../stores/preferencesStore';
import { canvasResolutionToPixelRatio } from '../../constants/canvasResolutions';
import { saveProjectThumbnail, updateProject } from '../../services/tauri';
import { calculateSnapLines, findSnap, findTransformSnap, guidesEqual, type SnapLines } from '../../utils/snapping';
import { getRotatedBounds } from '../../utils/coordinates';
import {
  FULL_CROP,
  cropForFrame,
  getCropWindow,
  getFullImageRect,
  hasCrop,
} from '../../utils/photoFraming';
import { buildPhotoPayload, emptyFramePayload } from '../../utils/photoTransfer';
import { useEditorHistory } from '../../hooks/useEditorHistory';
import { CropOverlay } from './CropOverlay';
import { ContextMenu, ContextMenuItem } from '../common/ContextMenu';
import { CanvasSlideIndicators } from './CanvasSlideIndicators';
import { CanvasZoomControls } from './CanvasZoomControls';
import { CanvasCropToolbar } from './CanvasCropToolbar';
import { CanvasSnapGuides } from './CanvasSnapGuides';
import { CanvasElementRenderer } from './CanvasElementRenderer';
import { v4 as uuidv4 } from 'uuid';
import { DESIGN_HEIGHT, getDesignSize } from '../../utils/designConstants';
import { getSlideIndex, getSlideIndexFromCenter } from '../../utils/slideUtils';
import { useCanvasZoom, useCanvasFileDrop, useCanvasImages, useCanvasMediaDrop, useCanvasFillMode } from '../../hooks/canvas';
import { findPlaceholderAt, type ReplaceTarget } from '../../hooks/canvas/useCanvasFillMode';
import { useCanvasKeyboard } from '../../hooks/canvas/useCanvasKeyboard';
import { useCanvasAutoScroll } from '../../hooks/canvas/useCanvasAutoScroll';
import { useSlideExport } from '../../hooks/canvas/useSlideExport';

interface CanvasAreaProps {
  aspectRatio: AspectRatio;
  onRenderSlideForExport?: (fn: (slideIndex: number, pixelRatio: number, format: 'png' | 'jpeg', quality: number) => string | null) => void;
  onRenderSlideThumbnail?: (fn: (slideIndex: number) => string | null) => void;
  onRenderSlideForPreview?: (fn: (slideIndex: number, targetWidth: number) => string | null) => void;
}

const MAX_SLIDES = 20;

// Pixel buffer around the canvas where the Konva Stage continues to render
// and accept input. Lets Transformer handles (rotation knob, corner anchors)
// and partly-off-canvas image content remain visible past the canvas edge.
// The scroll container is extended vertically beyond the viewport (negative
// top/bottom inset, matched by paddingTop/paddingBottom = STAGE_OVERFLOW)
// and clipped by the outer container's overflow-hidden, so this Stage
// extension lives entirely inside scroll padding — it never inflates
// scrollHeight at default zoom, even though the canvas now fills the viewport.
// Kept at 60 (covers Konva's 50px rotation knob + handle radius) because
// every extra pixel of Stage grows the GPU composite cost on every redraw.
const STAGE_OVERFLOW = 60;

// Extra paddingTop above STAGE_OVERFLOW. Reserved exclusively for the slide
// number tags ({CanvasSlideIndicators} renders at -20 from stageContainer
// top, so anything less than ~24 here would clip them at default zoom).
const SLIDE_INDICATOR_GUTTER = 30;

export function CanvasArea({ aspectRatio, onRenderSlideForExport, onRenderSlideThumbnail, onRenderSlideForPreview }: CanvasAreaProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const stageContainerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  // Design size is fixed based on aspect ratio (per slide)
  const designSize = getDesignSize(aspectRatio);

  const scale = canvasSize.height > 0 ? canvasSize.height / DESIGN_HEIGHT : 1;

  // Project store - use selectors to avoid re-renders from unrelated store changes
  const project = useProjectStore((s) => s.project);

  // Slide store
  const currentSlideIndex = useSlideStore((s) => s.currentSlideIndex);
  const setCurrentSlide = useSlideStore((s) => s.setCurrentSlide);
  const addSlide = useSlideStore((s) => s.addSlide);
  const removeSlide = useSlideStore((s) => s.removeSlide);

  // Element store
  const selectedElementId = useElementStore((s) => s.selectedElementId);
  const selectElement = useElementStore((s) => s.selectElement);
  const focusElement = useElementStore((s) => s.focusElement);
  const focusRequestId = useElementStore((s) => s.focusRequestId);
  const updateElement = useElementStore((s) => s.updateElement);
  const updateElementLocal = useElementStore((s) => s.updateElementLocal);
  const removeElement = useElementStore((s) => s.removeElement);
  const sendToFront = useElementStore((s) => s.sendToFront);
  const sendToBack = useElementStore((s) => s.sendToBack);
  const moveLayerForward = useElementStore((s) => s.moveLayerForward);
  const moveLayerBackward = useElementStore((s) => s.moveLayerBackward);
  const duplicateSelectedElement = useElementStore((s) => s.duplicateSelectedElement);
  const addElement = useElementStore((s) => s.addElement);
  const copySelectedElement = useElementStore((s) => s.copySelectedElement);
  const pasteElements = useElementStore((s) => s.pasteElements);

  // NOTE: draggingMediaId is NOT subscribed here — it would trigger a full
  // CanvasArea re-render on drag start (measured at >1.5s on large projects).
  // The two places that need it (drop-zone ring + Stage pointerEvents) are
  // toggled imperatively via refs in the effect below.
  const backdropRef = useRef<HTMLDivElement>(null);

  // Snap store - activeGuides is subscribed directly in CanvasSnapGuides
  // to avoid re-rendering the entire CanvasArea on every guide change during drag
  const snapEnabled = useSnapStore((s) => s.snapEnabled);
  const snapSettings = useSnapStore((s) => s.snapSettings);
  const setActiveGuides = useSnapStore((s) => s.setActiveGuides);

  // Crop store
  const cropModeElementId = useCropStore((s) => s.cropModeElementId);
  const enterCropMode = useCropStore((s) => s.enterCropMode);
  const exitCropMode = useCropStore((s) => s.exitCropMode);

  const templates = useTemplatesStore((s) => s.templates);
  const saveSlideAsTemplate = useTemplatesStore((s) => s.saveSlideAsTemplate);

  // History. Undo/redo route themselves to the crop-local stack while crop
  // mode is open — see useEditorHistory.
  const { undo, redo } = useEditorHistory();
  const pushState = useHistoryStore((s) => s.pushState);
  const setProjectSilent = useProjectStore((s) => s.setProjectSilent);

  // Template picker open state lives in panelStore; the modal itself is
  // rendered by SlidesPanel. Only the setter is needed here for the
  // "Add slide from template" button below.
  const setIsTemplatePickerOpen = usePanelStore((s) => s.setTemplatePickerOpen);

  // Canvas working resolution — controls the pixelRatio photos are rasterized
  // at on-canvas (Konva cache). Independent of design coords + export. Changing
  // it re-renders every CanvasElementRenderer, whose cache effect re-rasterizes
  // at the new density. null = "full" (no rasterization).
  const canvasResolutionKey = usePreferencesStore((s) => s.preferences.canvasResolution);
  const cachePixelRatio = useMemo(
    () => canvasResolutionToPixelRatio(canvasResolutionKey),
    [canvasResolutionKey]
  );

  const slides = project?.slides || [];
  const elements = project?.elements || [];
  const numSlides = slides.length;

  // Latest elements for high-frequency drag handlers — lets handleDragMove
  // hit-test placeholder frames without adding `elements` to its deps
  // (which would re-render every CanvasElementRenderer on each change).
  const elementsRef = useRef(elements);
  elementsRef.current = elements;

  // Element lookup map for O(1) access by ID (replaces repeated .find() calls)
  const elementMap = useMemo(() => {
    const map = new Map<string, Element>();
    for (const el of elements) {
      map.set(el.id, el);
    }
    return map;
  }, [elements]);

  // Pre-computed max zIndex for new element creation
  const maxZIndex = useMemo(() => {
    let max = 0;
    for (const el of elements) {
      if (el.zIndex > max) max = el.zIndex;
    }
    return max;
  }, [elements]);

  // Sorted elements for rendering (memoized to avoid re-sorting every render)
  const sortedElements = useMemo(
    () => [...elements].sort((a, b) => a.zIndex - b.zIndex),
    [elements]
  );

  // Total canvas width in design coordinates
  const totalDesignWidth = numSlides * designSize.width;

  // Image loading hook
  const loadedImages = useCanvasImages(elements);

  // Zoom hook (must be before other hooks that use zoomLevel)
  const { zoomLevel, zoomIn, zoomOut, resetZoom } = useCanvasZoom({
    scrollContainerRef,
    stageContainerRef,
    numSlides,
    canvasSize,
  });

  // Track shift key for centered scaling
  const isShiftPressed = useRef(false);
  // State version for crop mode shift+pan (triggers re-renders)
  const [cropShiftPressed, setCropShiftPressed] = useState(false);

  // Track active anchor for transform snapping
  const activeAnchorRef = useRef<string | null>(null);

  // Stage overflow ref for access inside useCallbacks without adding as dependency
  const stageOverflowRef = useRef(200);

  // Auto-scroll hook
  const isDraggingRef = useRef<boolean>(false); // Track if we're currently dragging

  // Snap lines for the active drag/transform. Computed once on drag or
  // transform start (they depend only on other elements + slide geometry,
  // which are frozen during the gesture) and reused by every move event —
  // recomputing them per-move was the dominant per-frame drag cost.
  const dragSnapLinesRef = useRef<SnapLines | null>(null);
  const transformSnapLinesRef = useRef<SnapLines | null>(null);
  const { stopAutoScroll, updateScrollSpeed } = useCanvasAutoScroll({
    scrollContainerRef,
    canvasSize,
    zoomLevel,
  });

  // Track original element state when entering crop mode (for cancellation)
  const cropOriginalStateRef = useRef<{
    x: number;
    y: number;
    cropX: number;
    cropY: number;
    cropWidth: number;
    cropHeight: number;
  } | null>(null);

  // Reset key for crop overlay - increment to trigger reset to full bounds
  const [cropResetKey, setCropResetKey] = useState(0);

  // Imperative crop-apply handle, assigned by CropOverlay while mounted.
  // Lets the crop toolbar's Apply button run the exact Enter-key code path.
  const cropApplyRef = useRef<(() => void) | null>(null);

  // File drag-drop hook
  const { isFileDragOver } = useCanvasFileDrop({
    stageContainerRef,
    numSlides,
    canvasSize,
    scale,
    zoomLevel,
    designSize,
    totalDesignWidth,
  });

  // Imperative subscription to mediaStore.draggingMediaId — avoids
  // re-rendering this component (a full pass is ~1.5s on large projects)
  // on drag start. Toggles the drop-zone ring and Stage pointerEvents.
  useEffect(() => {
    const apply = (draggingId: string | null) => {
      const show = draggingId !== null;
      const el = backdropRef.current;
      if (el) {
        if (show) {
          el.classList.add('ring-2', 'ring-blue-400', 'ring-opacity-50');
        } else if (!isFileDragOver) {
          el.classList.remove('ring-2', 'ring-blue-400', 'ring-opacity-50');
        }
      }
      const stage = stageRef.current;
      if (stage) {
        const container = stage.container();
        if (container) container.style.pointerEvents = show ? 'none' : '';
      }
    };
    apply(useMediaStore.getState().draggingMediaId);
    return useMediaStore.subscribe((s) => apply(s.draggingMediaId));
  }, [isFileDragOver]);

  // Fill mode hook (F-key fill, shared between media drop and element drag)
  // Replace mode hook (R-key replace, shared between media drop and element drag)
  // Swap mode (S-key swap, canvas element drags only)
  const { fillKeyRef, replaceKeyRef, swapKeyRef, getSwapTarget, fillLinesRef, getFillBoundsExcluding, getReplacementTarget } = useCanvasFillMode({
    elements,
    totalDesignWidth,
    designSize,
    numSlides,
  });

  // Media drop hook (fill preview state for F-key fill mode)
  const [fillPreview, setFillPreviewState] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  // Replace preview state (R-key replace mode — highlights the target element)
  const [replacePreview, setReplacePreviewState] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  // Swap preview: the other photo whose image will trade places with the
  // dragged one (S held during a canvas element drag).
  const [swapPreview, setSwapPreviewState] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const { fillPreviewListenerRef, replacePreviewListenerRef } = useCanvasMediaDrop({
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
  });
  // Register listeners so hooks can push preview updates without going through zustand
  useEffect(() => {
    fillPreviewListenerRef.current = setFillPreviewState;
    return () => { fillPreviewListenerRef.current = null; };
  }, [fillPreviewListenerRef]);
  useEffect(() => {
    replacePreviewListenerRef.current = setReplacePreviewState;
    return () => { replacePreviewListenerRef.current = null; };
  }, [replacePreviewListenerRef]);

  // Export hook - expose rendering functions to parent
  const { renderSlideForExport, renderSlideThumbnail, renderSlideForPreview } = useSlideExport({ stageRef, project, scale });

  useEffect(() => {
    if (onRenderSlideForExport) {
      onRenderSlideForExport(renderSlideForExport);
    }
  }, [onRenderSlideForExport, renderSlideForExport]);

  useEffect(() => {
    if (onRenderSlideThumbnail) {
      onRenderSlideThumbnail(renderSlideThumbnail);
    }
  }, [onRenderSlideThumbnail, renderSlideThumbnail]);

  useEffect(() => {
    if (onRenderSlideForPreview) {
      onRenderSlideForPreview(renderSlideForPreview);
    }
  }, [onRenderSlideForPreview, renderSlideForPreview]);

  // Canvas panning. Two triggers:
  //   - Middle mouse button (hold + drag)
  //   - Space held + left-click drag (Figma-style; hand cursor while Space
  //     is held so the affordance is visible before the user clicks)
  // Releases or window blur cancels. Space is suppressed while typing in
  // inputs so it doesn't hijack the space bar.
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    let panning = false;
    let spaceHeld = false;
    let startClientX = 0;
    let startClientY = 0;
    let startScrollLeft = 0;
    let startScrollTop = 0;
    const prevCursor = container.style.cursor;

    const setHandCursor = () => {
      container.style.cursor = panning ? 'grabbing' : 'grab';
    };
    const resetCursor = () => {
      container.style.cursor = prevCursor;
    };

    const onMouseDown = (e: MouseEvent) => {
      // Middle button always pans. Left button only pans when Space is held.
      if (e.button !== 1 && !(e.button === 0 && spaceHeld)) return;
      e.preventDefault();
      // Space+left: stop propagation so Konva doesn't start an element drag
      // or deselect on click.
      if (e.button === 0) e.stopPropagation();
      panning = true;
      startClientX = e.clientX;
      startClientY = e.clientY;
      startScrollLeft = container.scrollLeft;
      startScrollTop = container.scrollTop;
      container.style.cursor = 'grabbing';
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!panning) return;
      const dx = e.clientX - startClientX;
      const dy = e.clientY - startClientY;
      container.scrollLeft = startScrollLeft - dx;
      container.scrollTop = startScrollTop - dy;
    };

    const endPan = () => {
      if (!panning) return;
      panning = false;
      if (spaceHeld) setHandCursor();
      else resetCursor();
    };

    const onMouseUp = () => {
      // End on any button release; we started the drag, so we finish it.
      endPan();
    };

    // Block the middle-click auto-scroll icon that some browsers show.
    const onAuxClick = (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      // Don't swallow Space while typing.
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      // Ignore autorepeat — only care about the first press.
      if (spaceHeld) {
        e.preventDefault();
        return;
      }
      spaceHeld = true;
      e.preventDefault();
      if (!panning) setHandCursor();
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      spaceHeld = false;
      if (!panning) resetCursor();
    };

    // Capture-phase so the Space+drag intercept beats Konva's mousedown
    // handler on the inner Stage (otherwise the click would start an
    // element drag or deselect before we see it).
    container.addEventListener('mousedown', onMouseDown, { capture: true });
    container.addEventListener('auxclick', onAuxClick);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('blur', endPan);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    return () => {
      container.removeEventListener('mousedown', onMouseDown, { capture: true } as any);
      container.removeEventListener('auxclick', onAuxClick);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('blur', endPan);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      container.style.cursor = prevCursor;
    };
  }, []);

  // Crop aspect ratio state
  const [cropAspectRatio, setCropAspectRatio] = useState<number | null>(null);
  // Straighten slider state (content rotation inside the frame). Lives here
  // (not on the element) during crop mode — the CropOverlay preview is
  // imperative, so Cancel needs no element restore. Committed on Apply.
  const [cropContentRotation, setCropContentRotation] = useState(0);
  const [customRatioWidth, setCustomRatioWidth] = useState<string>('16');
  const [customRatioHeight, setCustomRatioHeight] = useState<string>('9');
  const [showCustomRatio, setShowCustomRatio] = useState(false);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    isOpen: boolean;
    position: { x: number; y: number };
    elementId: string | null;
    designPosition?: { x: number; y: number }; // For canvas context menu
    slideIndex?: number; // For "Save as Template" on canvas context menu
  }>({ isOpen: false, position: { x: 0, y: 0 }, elementId: null });

  // Calculate canvas size based on container - maximize vertical space
  useEffect(() => {
    const updateCanvasSize = () => {
      if (!containerRef.current) return;

      const container = containerRef.current;
      const containerHeight = container.clientHeight;

      const targetRatio = aspectRatio.width / aspectRatio.height;

      // Canvas fills the viewport vertically at default zoom, minus the
      // SLIDE_INDICATOR_GUTTER reserved at the top for the slide number
      // tags. The Stage's handle-rendering buffer is absorbed by
      // scrollContainer's padding (which lives outside the viewport via
      // negative inset — see render).
      const height = Math.max(200, containerHeight - SLIDE_INDICATOR_GUTTER);
      const width = height * targetRatio;

      // Only update if values actually changed — avoids expensive re-render
      // cascade when only container width changes (e.g. docked panel resize)
      setCanvasSize(prev =>
        prev.width === width && prev.height === height ? prev : { width, height }
      );
    };

    updateCanvasSize();

    const resizeObserver = new ResizeObserver(updateCanvasSize);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => resizeObserver.disconnect();
  }, [aspectRatio]);

  // Project thumbnail generator. Renders the FIRST slide only (most
  // recognizable) via the clean single-slide export path (UI hidden, one
  // slide) at ~480px tall — instead of a low-res whole-canvas capture.
  const generateSnapshot = useCallback(() => {
    // targetWidth chosen so the slide renders ~480px tall regardless of aspect
    // ratio (height = DESIGN_HEIGHT * targetWidth / slideWidth = 480).
    const targetWidth = designSize.width * (480 / DESIGN_HEIGHT);
    return renderSlideForPreview(0, targetWidth);
  }, [renderSlideForPreview, designSize.width]);

  // Debounced background thumbnail save on content changes
  const thumbnailTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<string>('');

  useEffect(() => {
    if (!project?.id || elements.length === 0) return;

    // Skip if currently dragging - wait until drag ends
    if (isDraggingRef.current) return;

    // Clear any pending save
    if (thumbnailTimeoutRef.current) {
      clearTimeout(thumbnailTimeoutRef.current);
    }

    // Debounce: save thumbnail 5 seconds after last change (increased from 3)
    thumbnailTimeoutRef.current = setTimeout(() => {
      // Double-check we're not dragging when the timeout fires
      if (isDraggingRef.current) return;

      // Use requestIdleCallback for low-priority work
      const saveThumb = () => {
        // Final check before expensive operation
        if (isDraggingRef.current) return;

        const imageData = generateSnapshot();
        if (imageData && imageData !== lastSavedRef.current) {
          lastSavedRef.current = imageData;
          saveProjectThumbnail(project.id, imageData).catch((err) => {
            console.error('Background thumbnail save failed:', err);
          });
        }
      };

      if ('requestIdleCallback' in window) {
        requestIdleCallback(saveThumb, { timeout: 10000 });
      } else {
        setTimeout(saveThumb, 100);
      }
    }, 5000);

    return () => {
      if (thumbnailTimeoutRef.current) {
        clearTimeout(thumbnailTimeoutRef.current);
      }
    };
  }, [project?.id, elements, generateSnapshot]);

  // Image loading is handled by useCanvasImages hook

  // Update transformer when selection changes
  useEffect(() => {
    if (!transformerRef.current || !stageRef.current) return;

    const stage = stageRef.current;
    const transformer = transformerRef.current;

    if (selectedElementId && !cropModeElementId) {
      const selectedNode = stage.findOne(`#${selectedElementId}`);
      if (selectedNode) {
        transformer.nodes([selectedNode]);
      } else {
        // Selected element no longer has a node (deleted, or consumed by
        // a fill/replace transfer). Without this, the transformer keeps
        // drawing its box around the destroyed node until the user
        // clicks elsewhere.
        transformer.nodes([]);
      }
      transformer.getLayer()?.batchDraw();
    } else {
      transformer.nodes([]);
      transformer.getLayer()?.batchDraw();
    }
    // The selected element reference is a dep because toggling contentRotation
    // 0 ↔ non-zero changes the renderer's node tree shape (plain image ↔
    // clipped group + proxy), remounting the node the transformer points at.
  }, [selectedElementId, cropModeElementId, loadedImages.get(selectedElementId ?? ''), elements.find((el) => el.id === selectedElementId)]);

  // Track shift key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        isShiftPressed.current = true;
        // Update state for crop mode shift+pan
        if (cropModeElementId) {
          setCropShiftPressed(true);
        }
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        isShiftPressed.current = false;
        setCropShiftPressed(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [cropModeElementId]);

  // Clamp element to visible bounds (can span across entire canvas).
  // Declared before the keyboard hook because nudges use it too.
  const clampToVisibleBounds = useCallback(
    (x: number, y: number, elementWidth: number, elementHeight: number, rotation = 0) => {
      const minVisible = 50;
      // Clamp the element's VISIBLE box, not the naive [x, x+w]×[y, y+h]
      // rect: elements rotate about their top-left anchor, so at 90° the
      // footprint sits entirely to the LEFT of the anchor and a naive clamp
      // stops the drag up to a full dimension early. At 0° the offsets are
      // (0, 0, w, h) and this reduces exactly to the original clamp.
      const b = getRotatedBounds(0, 0, elementWidth, elementHeight, rotation);
      const clampedX = Math.max(
        minVisible - (b.x + b.width),
        Math.min(x, totalDesignWidth - minVisible - b.x)
      );
      const clampedY = Math.max(
        minVisible - (b.y + b.height),
        Math.min(y, designSize.height - minVisible - b.y)
      );
      return { x: clampedX, y: clampedY };
    },
    [totalDesignWidth, designSize.height]
  );

  // Keyboard nudges go through the same visibility clamp as drags —
  // without it, arrow keys can push an element fully off-canvas where
  // only Tab-cycling or the layers panel can recover it.
  const updateElementClamped = useCallback(
    (elementId: string, updates: Partial<Element>) => {
      if (updates.x !== undefined || updates.y !== undefined) {
        const el = elementMap.get(elementId);
        if (el) {
          const clamped = clampToVisibleBounds(
            updates.x ?? el.x,
            updates.y ?? el.y,
            el.width,
            el.height,
            el.rotation
          );
          updates = { ...updates, x: clamped.x, y: clamped.y };
        }
      }
      updateElement(elementId, updates);
    },
    [elementMap, clampToVisibleBounds, updateElement]
  );

  // Keyboard handling hook
  useCanvasKeyboard({
    selectedElementId,
    elements,
    cropModeElementId,
    onSelectElement: selectElement,
    onFocusElement: focusElement,
    onUpdateElement: updateElementClamped,
    onRemoveElement: removeElement,
    onEnterCropMode: enterCropMode,
    onExitCropMode: exitCropMode,
    onZoomIn: zoomIn,
    onZoomOut: zoomOut,
    onResetZoom: resetZoom,
    onRestoreCropState: () => {
      if (cropModeElementId && cropOriginalStateRef.current) {
        const original = cropOriginalStateRef.current;
        // Local-only — discard in-crop edits without polluting global history.
        updateElementLocal(cropModeElementId, {
          x: original.x,
          y: original.y,
          cropX: original.cropX,
          cropY: original.cropY,
          cropWidth: original.cropWidth,
          cropHeight: original.cropHeight,
        });
        cropOriginalStateRef.current = null;
        setCropShiftPressed(false);
      }
    },
    onCopy: copySelectedElement,
    onUndo: undo,
    onRedo: redo,
    onPaste: async () => {
      // Calculate viewport center in design coordinates
      if (scrollContainerRef.current && stageContainerRef.current) {
        const container = scrollContainerRef.current;
        const stageContainer = stageContainerRef.current;

        // Get viewport dimensions
        const viewportWidth = container.clientWidth;
        const viewportHeight = container.clientHeight;

        // Get stage container position and dimensions
        const stageRect = stageContainer.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();

        // Calculate center of viewport in container coordinates
        const viewportCenterX = viewportWidth / 2;
        const viewportCenterY = viewportHeight / 2;

        // Calculate where viewport center intersects with stage
        // Stage position relative to container viewport
        const stageLeftInViewport = stageRect.left - containerRect.left;
        const stageTopInViewport = stageRect.top - containerRect.top;
        const stageRightInViewport = stageLeftInViewport + stageRect.width;
        const stageBottomInViewport = stageTopInViewport + stageRect.height;

        // Clamp viewport center to stage bounds (in viewport coordinates)
        const clampedViewportX = Math.max(stageLeftInViewport, Math.min(stageRightInViewport, viewportCenterX));
        const clampedViewportY = Math.max(stageTopInViewport, Math.min(stageBottomInViewport, viewportCenterY));

        // Convert to stage coordinates (relative to stage container)
        const stageLocalX = clampedViewportX - stageLeftInViewport;
        const stageLocalY = clampedViewportY - stageTopInViewport;

        // Convert to design coordinates
        const designX = (stageLocalX - 24) / (scale * zoomLevel);
        const designY = stageLocalY / (scale * zoomLevel);

        // Determine which slide this position is in
        const slideWidth = designSize.width;
        const targetSlideIndex = Math.floor(designX / slideWidth);
        const clampedSlideIndex = Math.max(0, Math.min(slides.length - 1, targetSlideIndex));

        // Clamp to the detected slide bounds
        const slideLeft = clampedSlideIndex * slideWidth;
        const slideRight = (clampedSlideIndex + 1) * slideWidth;
        const clampedX = Math.max(slideLeft, Math.min(slideRight, designX));
        const clampedY = Math.max(0, Math.min(designSize.height, designY));

        // Paste target is the (clamped) viewport center, so the pasted
        // elements land on screen by construction — no scroll needed.
        await pasteElements({ centerX: clampedX, centerY: clampedY });
      }
    },
    onDuplicate: duplicateSelectedElement,
    onBringForward: moveLayerForward,
    onSendBackward: moveLayerBackward,
    onBringToFront: sendToFront,
    onSendToBack: sendToBack,
    onPrevSlide: () => setCurrentSlide(Math.max(0, currentSlideIndex - 1)),
    onNextSlide: () => setCurrentSlide(Math.min(numSlides - 1, currentSlideIndex + 1)),
  });

  // Removed: This effect was conflicting with the restore ratio effect below.
  // The ratio is now reset to null only in the else branch of the restore effect.

  // Zoom logic is handled by useCanvasZoom hook

  // Scroll to bring the current slide into view ONLY when the slide
  // selection changes. Previously this effect also depended on zoomLevel /
  // canvasSize.width, so every zoom click would "re-anchor" the viewport
  // on the current slide (snapping to slide 1 by default and stealing the
  // user's pan position). Zoom focal-point preservation lives in the zoom
  // hook itself.
  useEffect(() => {
    if (!scrollContainerRef.current || canvasSize.width <= 0) return;

    const container = scrollContainerRef.current;
    const slideScreenWidth = canvasSize.width * zoomLevel;
    const totalContentWidth = numSlides * slideScreenWidth + 48; // 48 = left + right padding
    const viewPadding = 24;

    if (totalContentWidth <= container.clientWidth) return;

    const slideLeftInContent = 24 + currentSlideIndex * slideScreenWidth;
    const slideRightInContent = slideLeftInContent + slideScreenWidth;
    const visibleLeft = container.scrollLeft;
    const visibleRight = container.scrollLeft + container.clientWidth;
    const isOffLeft = slideLeftInContent < visibleLeft + viewPadding;
    const isOffRight = slideRightInContent > visibleRight - viewPadding;

    if (isOffLeft && !isOffRight) {
      container.scrollTo({ left: Math.max(0, slideLeftInContent - viewPadding), behavior: 'smooth' });
    } else if (isOffRight && !isOffLeft) {
      container.scrollTo({
        left: Math.max(0, slideRightInContent - container.clientWidth + viewPadding),
        behavior: 'smooth',
      });
    } else if (isOffLeft && isOffRight) {
      const slideCenterInContent = slideLeftInContent + slideScreenWidth / 2;
      container.scrollTo({
        left: Math.max(0, slideCenterInContent - container.clientWidth / 2),
        behavior: 'smooth',
      });
    }
    // Intentionally NOT depending on zoomLevel or canvasSize.width — see comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSlideIndex, numSlides]);

  // File drop and media drop are handled by hooks (useCanvasFileDrop, useCanvasMediaDrop)

  // Handle stage click - deselect if clicking empty space
  const handleStageClick = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.target === e.target.getStage()) {
      selectElement(null);
      // Update current slide based on click position
      const stage = stageRef.current;
      if (stage) {
        const pointerPos = stage.getPointerPosition();
        if (pointerPos) {
          const designX = (pointerPos.x - stageOverflowRef.current) / (scale * zoomLevel);
          const slideIndex = getSlideIndex(designX, designSize.width);
          if (slideIndex >= 0 && slideIndex < numSlides) {
            setCurrentSlide(slideIndex);
          }
        }
      }
    }
  }, [selectElement, scale, zoomLevel, designSize.width, numSlides, setCurrentSlide]);

  const handleElementClick = useCallback((elementId: string, e: Konva.KonvaEventObject<MouseEvent>) => {
    e.cancelBubble = true;
    selectElement(elementId);

    // Update current slide based on element position
    const element = elementMap.get(elementId);
    if (element) {
      const eb = getRotatedBounds(element.x, element.y, element.width, element.height, element.rotation);
      const slideIndex = getSlideIndexFromCenter(eb.x, eb.width, designSize.width);
      if (slideIndex >= 0 && slideIndex < numSlides) {
        setCurrentSlide(slideIndex);
      }
    }
  }, [selectElement, elementMap, designSize.width, numSlides, setCurrentSlide]);

  // Auto-scroll logic is handled by useCanvasAutoScroll hook

  // Handle drag with snapping - THROTTLED to reduce CPU usage
  // Fill preview for element drag (updated during handleDragMove)
  const elementFillPreviewRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  // Replace preview for element drag (updated during handleDragMove)
  const elementReplacePreviewRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  // Swap preview for element drag (updated during handleDragMove)
  const elementSwapPreviewRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);

  const handleDragMove = useCallback(
    (elementId: string, e: Konva.KonvaEventObject<DragEvent>) => {
      const node = e.target;
      const element = elementMap.get(elementId);
      if (!element) return;

      let newX = node.x();
      let newY = node.y();

      // Compute cursor position in design space (shared by fill + replace)
      const stage = node.getStage();
      const pointerPos = stage?.getPointerPosition();
      const layer = node.getLayer();
      const layerScale = layer?.scaleX() ?? 1;
      const layerX = layer?.x() ?? 0;
      const layerY = layer?.y() ?? 0;
      const cursorX = pointerPos ? (pointerPos.x - layerX) / layerScale : newX + element.width / 2;
      const cursorY = pointerPos ? (pointerPos.y - layerY) / layerScale : newY + element.height / 2;

      // Fill mode preview during element drag. A placeholder frame under
      // the cursor wins over the snap-line region (the frame is the fill
      // target; region lookup splits multi-slide frames at the slide
      // boundary). Frame fill moves the element's media, so only preview
      // it for elements that have media.
      if (fillKeyRef.current) {
        const frame = element.mediaId
          ? findPlaceholderAt(elementsRef.current, cursorX, cursorY, elementId)
          : null;
        const bounds = frame ?? getFillBoundsExcluding(cursorX, cursorY, elementId);
        if (bounds && (
          !elementFillPreviewRef.current ||
          elementFillPreviewRef.current.x !== bounds.x ||
          elementFillPreviewRef.current.y !== bounds.y ||
          elementFillPreviewRef.current.width !== bounds.width ||
          elementFillPreviewRef.current.height !== bounds.height
        )) {
          elementFillPreviewRef.current = bounds;
          setFillPreviewState(bounds);
        }
      } else if (elementFillPreviewRef.current) {
        elementFillPreviewRef.current = null;
        setFillPreviewState(null);
      }

      // Replace mode preview during element drag
      if (replaceKeyRef.current) {
        const target = getReplacementTarget(cursorX, cursorY, elementId);
        if (target && (
          !elementReplacePreviewRef.current ||
          elementReplacePreviewRef.current.x !== target.x ||
          elementReplacePreviewRef.current.y !== target.y
        )) {
          elementReplacePreviewRef.current = target;
          setReplacePreviewState(target);
        } else if (!target && elementReplacePreviewRef.current) {
          elementReplacePreviewRef.current = null;
          setReplacePreviewState(null);
        }
      } else if (elementReplacePreviewRef.current) {
        elementReplacePreviewRef.current = null;
        setReplacePreviewState(null);
      }

      // Swap mode preview: highlight the frame this one will trade with.
      // Valid in both directions — dragging a photo onto an empty frame
      // (leaving an empty frame behind) or an empty frame onto a photo.
      if (swapKeyRef.current) {
        const target = getSwapTarget(cursorX, cursorY, elementId);
        if (target && (
          !elementSwapPreviewRef.current ||
          elementSwapPreviewRef.current.x !== target.x ||
          elementSwapPreviewRef.current.y !== target.y
        )) {
          elementSwapPreviewRef.current = target;
          setSwapPreviewState(target);
        } else if (!target && elementSwapPreviewRef.current) {
          elementSwapPreviewRef.current = null;
          setSwapPreviewState(null);
        }
      } else if (elementSwapPreviewRef.current) {
        elementSwapPreviewRef.current = null;
        setSwapPreviewState(null);
      }

      // Apply snapping (snap to slide boundaries and other elements).
      // Snap lines are computed ONCE per drag in handleDragStart (they
      // depend only on other elements + slide geometry, which are frozen
      // while dragging), so per-move work is just the cheap findSnap scan —
      // no throttle needed, and snapping responds on every frame.
      if (snapEnabled && !fillKeyRef.current && !replaceKeyRef.current && !swapKeyRef.current && dragSnapLinesRef.current) {
        // Snap the element's VISIBLE box. A rotated element's footprint is
        // not [x, x+width] (it rotates about its top-left anchor), so
        // snapping raw x/y would align an invisible box and leave the image
        // sitting somewhere off the guide.
        const elementRect = getRotatedBounds(
          newX,
          newY,
          element.width,
          element.height,
          element.rotation
        );
        const snapResult = findSnap(elementRect, dragSnapLinesRef.current, 10);
        // findSnap moved the visible box; shift the element's anchor by the
        // same amount (identical to assigning directly when unrotated).
        newX += snapResult.x - elementRect.x;
        newY += snapResult.y - elementRect.y;
        // Only push guides to the store when they actually changed — a
        // store set per mousemove would re-render CanvasSnapGuides for
        // nothing on most frames.
        if (!guidesEqual(useSnapStore.getState().activeGuides, snapResult.guides)) {
          setActiveGuides(snapResult.guides);
        }
      }

      // Clamp to bounds (cheap operation, always do it)
      const clamped = clampToVisibleBounds(newX, newY, element.width, element.height, element.rotation);
      node.x(clamped.x);
      node.y(clamped.y);

      // Update auto-scroll based on mouse position
      updateScrollSpeed(e.evt.clientX);
    },
    [elementMap, snapEnabled, setActiveGuides, clampToVisibleBounds, updateScrollSpeed, fillKeyRef, replaceKeyRef, swapKeyRef, getFillBoundsExcluding, getReplacementTarget, getSwapTarget, setFillPreviewState, setReplacePreviewState, setSwapPreviewState]
  );

  // Handle drag start — compute this drag's snap lines once (see ref above)
  const handleDragStart = useCallback((elementId: string) => {
    isDraggingRef.current = true;
    // Publish the drag so crop mode refuses to open mid-move and so `s`
    // switches from "toggle slides panel" to "swap" for its duration.
    useElementStore.getState().setDraggingElement(true);
    // Dragging is an interaction: select the element (border + transformer
    // + current slide), same as a click. Konva fires dragstart without a
    // click when the user presses and immediately moves, which previously
    // left the dragged element unselected.
    if (useElementStore.getState().selectedElementId !== elementId) {
      selectElement(elementId);
      const el = elementMap.get(elementId);
      if (el) {
        const eb = getRotatedBounds(el.x, el.y, el.width, el.height, el.rotation);
        const slideIndex = getSlideIndexFromCenter(eb.x, eb.width, designSize.width);
        if (slideIndex >= 0 && slideIndex < numSlides) {
          setCurrentSlide(slideIndex);
        }
      }
    }
    dragSnapLinesRef.current = snapEnabled
      ? calculateSnapLines(
          elements,
          elementId,
          totalDesignWidth,
          designSize.height,
          snapSettings,
          designSize.width,
          numSlides
        )
      : null;
  }, [snapEnabled, elements, totalDesignWidth, designSize.height, designSize.width, numSlides, snapSettings, selectElement, elementMap, setCurrentSlide]);

  // Handle drag end - apply final snap (or fill mode) and persist position
  const handleDragEnd = useCallback(
    (elementId: string, e: Konva.KonvaEventObject<DragEvent>) => {
      const node = e.target;
      const element = elementMap.get(elementId);
      if (!element) return;

      // Stop auto-scroll and reset drag state
      stopAutoScroll();
      isDraggingRef.current = false;
      useElementStore.getState().setDraggingElement(false);

      // Take this drag's snap lines and clear the ref (covers every exit
      // path below, including the replace/fill early returns)
      const dragSnapLines = dragSnapLinesRef.current;
      dragSnapLinesRef.current = null;

      // Clear fill/replace/swap previews
      elementFillPreviewRef.current = null;
      setFillPreviewState(null);
      elementReplacePreviewRef.current = null;
      setReplacePreviewState(null);
      elementSwapPreviewRef.current = null;
      setSwapPreviewState(null);

      let newX = node.x();
      let newY = node.y();

      // Cursor position in design space (shared by replace + fill modes)
      const stage = node.getStage();
      const pointerPos = stage?.getPointerPosition();
      const layer = node.getLayer();
      const layerScale = layer?.scaleX() ?? 1;
      const layerX = layer?.x() ?? 0;
      const layerY = layer?.y() ?? 0;
      const cursorX = pointerPos ? (pointerPos.x - layerX) / layerScale : newX + element.width / 2;
      const cursorY = pointerPos ? (pointerPos.y - layerY) / layerScale : newY + element.height / 2;

      // Replace mode: swap dragged element's media into the target
      // (photo or placeholder frame). Fill mode over a frame is the same
      // operation — the frame consumes the dragged element's media.
      // ── Swap: trade the two photos between their frames ────────────────
      // Both frames keep their own geometry (position, size, rotation,
      // z-order); only the image payloads change places. Each photo's own
      // edits travel with it — its straighten angle, flips, and crop — with
      // the crop re-shaped for the frame it lands in so nothing stretches.
      if (swapKeyRef.current) {
        const target = getSwapTarget(cursorX, cursorY, elementId);
        const partner = target && project
          ? project.elements.find(el => el.id === target.elementId) ?? null
          : null;
        // At least one side must hold an image — trading two empty frames
        // would be a no-op.
        if (project && partner && (element.mediaId || partner.mediaId)) {
          const mediaPool = project.mediaPool || [];

            // Put `source`'s image into `frame`, carrying its edits across.
            // An empty source empties the frame instead — that is the "leave
            // an empty frame behind" half of a swap with a placeholder.
            // `carry` preserves the user's framing and zoom, which is what
            // separates a swap from a replace (replace re-covers the frame).
            const moveInto = (source: Element, frame: Element): Element => {
              if (!source.mediaId) return { ...frame, ...emptyFramePayload() };
              const media = mediaPool.find(m => m.id === source.mediaId);
              return {
                ...frame,
                ...buildPhotoPayload({
                  mediaId: source.mediaId,
                  assetPath: source.assetPath,
                  mediaWidth: media?.width ?? frame.width,
                  mediaHeight: media?.height ?? frame.height,
                  frameWidth: frame.width,
                  frameHeight: frame.height,
                  contentRotation: source.contentRotation ?? 0,
                  flipX: source.flipX,
                  flipY: source.flipY,
                  carry: getCropWindow(source),
                }),
              };
            };

            const swappedDragged = moveInto(partner, element);
            const swappedPartner = moveInto(element, partner);

            const updatedElements = project.elements.map(el => {
              if (el.id === element.id) return swappedDragged;
              if (el.id === partner.id) return swappedPartner;
              return el;
            });
            const updatedProject = { ...project, elements: updatedElements };

            // Neither asset is orphaned — both are still referenced, just by
            // the other element — so unlike replace there is nothing to
            // register for cleanup.
            setProjectSilent(updatedProject);
            // Return the dragged node to where it started: a swap moves
            // images, never frames.
            node.x(element.x);
            node.y(element.y);
            selectElement(element.id);
            pushState(updatedProject, { source: 'element', actionType: 'update', elementId: element.id });
            updateProject(updatedProject).catch(err => console.error('Failed to persist swap:', err));

            setActiveGuides([]);
            return;
        }
        // S held but not over a swappable frame — fall through and treat it
        // as an ordinary move rather than silently doing nothing.
      }

      if (element.mediaId && (replaceKeyRef.current || fillKeyRef.current)) {
        const target: ReplaceTarget | null = replaceKeyRef.current
          ? getReplacementTarget(cursorX, cursorY, elementId)
          : findPlaceholderAt(elementsRef.current, cursorX, cursorY, elementId);
        if (target && element.mediaId) {
          const mediaPool = project?.mediaPool || [];
          const media = mediaPool.find(m => m.id === element.mediaId);
          // No `carry`: replace re-covers the destination frame with a fresh
          // centred crop. The photo's own edits (straighten, flips) still
          // travel with it — the source element is being consumed, so the
          // target also takes ownership of its embedded asset file.
          const payload = buildPhotoPayload({
            mediaId: element.mediaId,
            assetPath: element.assetPath,
            mediaWidth: media?.width ?? element.width,
            mediaHeight: media?.height ?? element.height,
            frameWidth: target.width,
            frameHeight: target.height,
            contentRotation: element.contentRotation ?? 0,
            flipX: element.flipX,
            flipY: element.flipY,
          });

          // Apply both mutations (update target + remove source) as a single
          // atomic operation so undo/redo treats it as one step.
          if (project) {
            const targetElement = project.elements.find(el => el.id === target.elementId);
            const updatedElements = project.elements
              .filter(el => el.id !== elementId) // remove the replacer
              .map(el => (el.id === target.elementId ? { ...el, ...payload } : el));

            const updatedProject = { ...project, elements: updatedElements };

            // Synchronous local update for immediate UI
            setProjectSilent(updatedProject);

            // The dragged element no longer exists — select the target
            // that received its media so the selection border lands on
            // the result instead of lingering on the destroyed node.
            selectElement(target.elementId);

            // Single history entry
            pushState(updatedProject, { source: 'element', actionType: 'update', elementId: target.elementId });

            // Persist to backend
            updateProject(updatedProject).catch(err => console.error('Failed to persist replace:', err));

            // The target's old embedded asset is no longer referenced by
            // the live project — register it for cleanup when it falls off
            // the history stack (mirrors removeElement).
            const oldAssetPath = targetElement?.assetPath;
            if (oldAssetPath && oldAssetPath !== element.assetPath) {
              useHistoryStore.getState().trackOrphanedAsset(oldAssetPath, targetElement?.mediaId);
            }
          }

          setActiveGuides([]);
          return;
        }
      }

      // Fill mode: snap element into the bounded region (use cursor, not
      // element center). Frame targets were already handled above.
      if (fillKeyRef.current) {
        const bounds = getFillBoundsExcluding(cursorX, cursorY, elementId);
        if (bounds) {
          // The element keeps its own image and stays selected — only its
          // frame changes — so this is a re-cover for the new bounds rather
          // than a transfer. The straighten angle stays with it, and the
          // crop is re-fitted for that angle so the tilt can't expose blank
          // corners in the new shape.
          const mediaPool = project?.mediaPool || [];
          const media = element.mediaId ? mediaPool.find(m => m.id === element.mediaId) : null;
          const crop = cropForFrame({
            mediaWidth: media?.width ?? element.width,
            mediaHeight: media?.height ?? element.height,
            frameWidth: bounds.width,
            frameHeight: bounds.height,
            contentRotation: element.contentRotation ?? 0,
          });

          const fillUpdates = {
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
            ...crop,
            lastCropRatio: null,
          };

          // Set node position immediately so Konva doesn't flash the drag position
          node.x(bounds.x);
          node.y(bounds.y);

          // Synchronous local update so React renders correct position immediately
          // (updateElement is async — without this, a re-render from setFillPreviewState
          // would briefly show the element at its pre-drag position)
          updateElementLocal(elementId, fillUpdates);
          // Persist + push history entry
          updateElement(elementId, fillUpdates);

          setActiveGuides([]);

          const slideIndex = getSlideIndexFromCenter(bounds.x, bounds.width, designSize.width);
          if (slideIndex >= 0 && slideIndex < numSlides) {
            setCurrentSlide(slideIndex);
          }
          return;
        }
      }

      // Apply final snap on drop, reusing the lines computed at drag start
      if (snapEnabled && dragSnapLines) {
        // Snap the element's VISIBLE box. A rotated element's footprint is
        // not [x, x+width] (it rotates about its top-left anchor), so
        // snapping raw x/y would align an invisible box and leave the image
        // sitting somewhere off the guide.
        const elementRect = getRotatedBounds(
          newX,
          newY,
          element.width,
          element.height,
          element.rotation
        );
        const snapResult = findSnap(elementRect, dragSnapLines, 10);
        // findSnap moved the visible box; shift the element's anchor by the
        // same amount (identical to assigning directly when unrotated).
        newX += snapResult.x - elementRect.x;
        newY += snapResult.y - elementRect.y;
      }

      setActiveGuides([]);
      const clamped = clampToVisibleBounds(newX, newY, element.width, element.height, element.rotation);
      updateElement(elementId, { x: clamped.x, y: clamped.y });

      // Update current slide based on where element was dropped
      const db = getRotatedBounds(clamped.x, clamped.y, element.width, element.height, element.rotation);
      const slideIndex = getSlideIndexFromCenter(db.x, db.width, designSize.width);
      if (slideIndex >= 0 && slideIndex < numSlides) {
        setCurrentSlide(slideIndex);
      }
    },
    [elementMap, updateElement, updateElementLocal, setProjectSilent, pushState, setActiveGuides, clampToVisibleBounds, designSize.width, designSize.height, numSlides, setCurrentSlide, stopAutoScroll, snapEnabled, snapSettings, totalDesignWidth, elements, fillKeyRef, replaceKeyRef, swapKeyRef, getFillBoundsExcluding, getReplacementTarget, getSwapTarget, setFillPreviewState, setReplacePreviewState, setSwapPreviewState, project, selectElement, updateProject]
  );

  // Handle transform end
  const handleTransformEnd = useCallback(
    (elementId: string, e: Konva.KonvaEventObject<Event>) => {
      const node = e.target;
      const scaleX = node.scaleX();
      const scaleY = node.scaleY();

      const newWidth = Math.max(20, node.width() * scaleX);
      const newHeight = Math.max(20, node.height() * scaleY);

      // Imperatively sync the Konva node to the new committed state BEFORE
      // React dispatches the state update. Otherwise the node has scale=1 but
      // width/height still at the pre-resize value until React's commit syncs
      // them — any paint in that window (combined with cleared cache) would
      // render the image at its original pre-resize size for one frame.
      node.scaleX(1);
      node.scaleY(1);
      node.width(newWidth);
      node.height(newHeight);

      // Clear guides, anchor ref, and this transform's snap lines
      setActiveGuides([]);
      activeAnchorRef.current = null;
      transformSnapLinesRef.current = null;

      updateElement(elementId, {
        x: node.x(),
        y: node.y(),
        width: newWidth,
        height: newHeight,
        rotation: node.rotation(),
      });
    },
    [updateElement, setActiveGuides]
  );

  const handleTransformStart = useCallback((_e: Konva.KonvaEventObject<Event>) => {
    const transformer = transformerRef.current;
    if (transformer) {
      transformer.centeredScaling(isShiftPressed.current);
      // Store the active anchor name
      activeAnchorRef.current = transformer.getActiveAnchor() || null;
    }
    // Compute this transform's snap lines once (other elements + slide
    // geometry are frozen during the gesture) — same optimization as drag.
    transformSnapLinesRef.current = snapEnabled && selectedElementId
      ? calculateSnapLines(
          elements,
          selectedElementId,
          totalDesignWidth,
          designSize.height,
          snapSettings,
          designSize.width,
          numSlides
        )
      : null;
  }, [snapEnabled, selectedElementId, elements, totalDesignWidth, designSize.height, designSize.width, numSlides, snapSettings]);

  const handleTransform = useCallback((e: Konva.KonvaEventObject<Event>) => {
    const transformer = transformerRef.current;
    const isCenteredScaling = isShiftPressed.current;
    if (transformer) {
      transformer.centeredScaling(isCenteredScaling);
    }

    // Apply transform snapping
    if (!snapEnabled || !selectedElementId) return;

    const node = e.target;
    const anchorName = activeAnchorRef.current;

    // Skip snapping for rotation (rotater anchor) or if no anchor
    if (!anchorName || anchorName === 'rotater') return;

    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    const originalWidth = node.width();
    const originalHeight = node.height();

    // Get current bounds in design coordinates
    // Note: node.x() and node.y() always return the top-left corner, even during centered scaling
    // Konva's centeredScaling mode automatically adjusts the top-left to keep center fixed
    const currentWidth = originalWidth * Math.abs(scaleX);
    const currentHeight = originalHeight * Math.abs(scaleY);

    // For centered scaling, calculate the center position (which should stay fixed)
    // The node's current position is the top-left after Konva's centered scaling adjustment
    const currentX = node.x();
    const currentY = node.y();
    const centerX = currentX + currentWidth / 2;
    const centerY = currentY + currentHeight / 2;

    // Bounds are always the top-left corner
    const boundsX = currentX;
    const boundsY = currentY;

    // Snap lines were computed once in handleTransformStart
    const snapLines = transformSnapLinesRef.current;
    if (!snapLines) return;

    // For centered scaling, check all edges (not just the ones being dragged)
    const effectiveAnchor = isCenteredScaling ? 'top-left-bottom-right' : anchorName;

    const snapResult = findTransformSnap(
      { x: boundsX, y: boundsY, width: currentWidth, height: currentHeight },
      effectiveAnchor,
      snapLines,
      10
    );

    // Apply snapped dimensions
    if (snapResult.guides.length > 0) {
      // Check if this is a corner anchor (aspect-ratio-locked resize)
      const isCornerAnchor = anchorName.includes('-') &&
        (anchorName.includes('top') || anchorName.includes('bottom')) &&
        (anchorName.includes('left') || anchorName.includes('right'));

      let finalWidth = snapResult.width;
      let finalHeight = snapResult.height;
      let finalX = snapResult.x;
      let finalY = snapResult.y;

      // For centered scaling or corner anchors, maintain aspect ratio
      if (isCenteredScaling || isCornerAnchor) {
        const aspectRatio = originalWidth / originalHeight;
        const widthChanged = Math.abs(snapResult.width - currentWidth) > 0.1;
        const heightChanged = Math.abs(snapResult.height - currentHeight) > 0.1;

        if (widthChanged && !heightChanged) {
          // Width was snapped - calculate height proportionally
          finalHeight = finalWidth / aspectRatio;
        } else if (heightChanged && !widthChanged) {
          // Height was snapped - calculate width proportionally
          finalWidth = finalHeight * aspectRatio;
        } else if (widthChanged && heightChanged) {
          // Both snapped - use the smaller scale factor to maintain aspect ratio
          const widthScale = snapResult.width / currentWidth;
          const heightScale = snapResult.height / currentHeight;

          if (widthScale < heightScale) {
            finalHeight = finalWidth / aspectRatio;
          } else {
            finalWidth = finalHeight * aspectRatio;
          }
        }

        if (isCenteredScaling) {
          // For centered scaling, recalculate position to keep center fixed
          // centerX/centerY is where the center should stay, so new top-left is center minus half the new size
          finalX = centerX - finalWidth / 2;
          finalY = centerY - finalHeight / 2;
        } else {
          // For non-centered corner anchors, adjust position based on anchor
          if (anchorName.includes('top')) {
            finalY = boundsY + currentHeight - finalHeight;
          }
          if (anchorName.includes('left')) {
            finalX = boundsX + currentWidth - finalWidth;
          }
        }
      }

      // Calculate and apply new scale factors
      const newScaleX = (finalWidth / originalWidth) * Math.sign(scaleX);
      const newScaleY = (finalHeight / originalHeight) * Math.sign(scaleY);

      node.scaleX(newScaleX);
      node.scaleY(newScaleY);

      // For centered scaling, we need to set the position to keep the center fixed
      // For non-centered scaling, we set position based on which anchor was dragged
      node.x(finalX);
      node.y(finalY);

      setActiveGuides(snapResult.guides);
    } else {
      setActiveGuides([]);
    }
  }, [snapEnabled, selectedElementId, setActiveGuides]);

  // Context menu handlers
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    // Don't show context menu during crop mode
    if (cropModeElementId) return;
    if (selectedElementId) {
      setContextMenu({
        isOpen: true,
        position: { x: e.clientX, y: e.clientY },
        elementId: selectedElementId,
      });
    }
  }, [selectedElementId, cropModeElementId]);

  // Canvas context menu for empty space right-clicks
  const handleStageContextMenu = useCallback((e: Konva.KonvaEventObject<PointerEvent>) => {
    // Don't show context menu during crop mode
    if (cropModeElementId) return;
    // Only show menu if clicking on empty stage area
    if (e.target === e.target.getStage()) {
      e.evt.preventDefault();
      e.evt.stopPropagation(); // Prevent bubbling to wrapper div's handleContextMenu

      // Deselect any selected element first
      selectElement(null);

      const stage = e.target.getStage();
      const pointerPos = stage?.getPointerPosition();
      const overflow = stageOverflowRef.current;
      const designPos = pointerPos ? {
        x: (pointerPos.x - overflow) / (scale * zoomLevel),
        y: (pointerPos.y - overflow) / (scale * zoomLevel),
      } : { x: 0, y: 0 };

      // Calculate which slide was clicked
      const clickedSlideIndex = getSlideIndex(designPos.x, designSize.width);

      setContextMenu({
        isOpen: true,
        position: { x: e.evt.clientX, y: e.evt.clientY },
        elementId: null, // null means canvas context menu
        designPosition: designPos,
        slideIndex: clickedSlideIndex >= 0 && clickedSlideIndex < numSlides ? clickedSlideIndex : currentSlideIndex,
      });
    }
  }, [scale, selectElement, designSize.width, numSlides, currentSlideIndex, cropModeElementId]);

  const handleFlipHorizontal = () => {
    if (!contextMenu.elementId) return;
    const element = elementMap.get(contextMenu.elementId!);
    if (!element) return;
    updateElement(contextMenu.elementId, { flipX: !element.flipX });
    setContextMenu({ ...contextMenu, isOpen: false });
  };

  const handleFlipVertical = () => {
    if (!contextMenu.elementId) return;
    const element = elementMap.get(contextMenu.elementId!);
    if (!element) return;
    updateElement(contextMenu.elementId, { flipY: !element.flipY });
    setContextMenu({ ...contextMenu, isOpen: false });
  };

  const handleCenterOnCanvas = () => {
    if (!contextMenu.elementId) return;
    const element = elementMap.get(contextMenu.elementId!);
    if (!element) return;
    // Center on current slide
    const slideOffsetX = currentSlideIndex * designSize.width;
    const centerX = slideOffsetX + (designSize.width - element.width) / 2;
    const centerY = (designSize.height - element.height) / 2;
    updateElement(contextMenu.elementId, { x: centerX, y: centerY });
    setContextMenu({ ...contextMenu, isOpen: false });
  };

  const handleSendToFront = () => {
    if (!contextMenu.elementId) return;
    sendToFront(contextMenu.elementId);
    setContextMenu({ ...contextMenu, isOpen: false });
  };

  const handleSendToBack = () => {
    if (!contextMenu.elementId) return;
    sendToBack(contextMenu.elementId);
    setContextMenu({ ...contextMenu, isOpen: false });
  };

  const handleCropFromMenu = () => {
    if (!contextMenu.elementId) return;
    enterCropMode(contextMenu.elementId);
    setContextMenu({ ...contextMenu, isOpen: false });
  };

  const handleDeleteFromMenu = () => {
    if (!contextMenu.elementId) return;
    removeElement(contextMenu.elementId);
    setContextMenu({ ...contextMenu, isOpen: false });
  };

  const handleResetCrop = () => {
    if (!contextMenu.elementId) return;
    const element = elementMap.get(contextMenu.elementId!);
    if (!element) return;

    const hasContentRotation = (element.contentRotation ?? 0) !== 0;
    if (!hasCrop(element) && !hasContentRotation) {
      setContextMenu({ ...contextMenu, isOpen: false });
      return;
    }

    // Grow the frame out to the whole image so the visible content stays
    // exactly where it is — only the hidden parts come back.
    const full = getFullImageRect(element);

    updateElement(contextMenu.elementId, {
      ...FULL_CROP,
      x: full.x,
      y: full.y,
      width: full.width,
      height: full.height,
      contentRotation: 0,
    });
    setContextMenu({ ...contextMenu, isOpen: false });
  };

  const handleResetAspectRatio = () => {
    if (!contextMenu.elementId) return;
    const element = elementMap.get(contextMenu.elementId!);
    if (!element) return;

    const loadedImage = loadedImages.get(element.id);
    if (!loadedImage) return;

    // Calculate the target aspect ratio based on the visible (cropped) region
    // Crop values are normalized (0-1). When no crop: cropWidth=1, cropHeight=1
    const cropW = element.cropWidth ?? 1;
    const cropH = element.cropHeight ?? 1;

    // The visible area's dimensions (accounting for crop)
    const visibleWidth = cropW * loadedImage.naturalWidth;
    const visibleHeight = cropH * loadedImage.naturalHeight;
    const targetRatio = visibleWidth / visibleHeight;

    const currentArea = element.width * element.height;
    const newHeight = Math.sqrt(currentArea / targetRatio);
    const newWidth = newHeight * targetRatio;

    const centerX = element.x + element.width / 2;
    const centerY = element.y + element.height / 2;
    const newX = centerX - newWidth / 2;
    const newY = centerY - newHeight / 2;

    updateElement(contextMenu.elementId, {
      x: newX,
      y: newY,
      width: newWidth,
      height: newHeight,
    });
    setContextMenu({ ...contextMenu, isOpen: false });
  };

  const handleCreateFrame = async () => {
    if (!contextMenu.elementId) return;
    const element = elementMap.get(contextMenu.elementId!);
    if (!element) return;

    // Create a placeholder frame with same dimensions, offset diagonally
    const newFrame: Element = {
      id: uuidv4(),
      type: 'placeholder',
      x: element.x + 30,
      y: element.y + 30,
      width: element.width,
      height: element.height,
      rotation: element.rotation,
      scale: 1,
      locked: false,
      zIndex: maxZIndex + 1,
    };

    await addElement(newFrame);
    selectElement(newFrame.id);
    setContextMenu({ ...contextMenu, isOpen: false });
  };

  const handleAddFrame = async () => {
    if (!contextMenu.designPosition) return;

    // Default frame size (reasonable starting size)
    const frameWidth = 300;
    const frameHeight = 200;

    // Center the frame on the click position
    const newFrame: Element = {
      id: uuidv4(),
      type: 'placeholder',
      x: contextMenu.designPosition.x - frameWidth / 2,
      y: contextMenu.designPosition.y - frameHeight / 2,
      width: frameWidth,
      height: frameHeight,
      rotation: 0,
      scale: 1,
      locked: false,
      zIndex: maxZIndex + 1,
    };

    await addElement(newFrame);
    selectElement(newFrame.id);
    setContextMenu({ ...contextMenu, isOpen: false });
  };

  const handleSaveSlideAsTemplate = () => {
    if (!project) return;
    const slideIndex = contextMenu.slideIndex ?? currentSlideIndex;
    const templateName = `Template ${templates.length + 1}`;
    saveSlideAsTemplate(
      slideIndex,
      templateName,
      project.aspectRatio,
      elements,
      designSize.width
    );
    setContextMenu({ ...contextMenu, isOpen: false });
  };

  const handleDeleteSlide = () => {
    const slideIndex = contextMenu.slideIndex ?? currentSlideIndex;
    if (slides.length > 1) {
      removeSlide(slideIndex);
    }
    setContextMenu({ ...contextMenu, isOpen: false });
  };

  const handleCopyElement = () => {
    if (!contextMenu.elementId) return;
    const element = elementMap.get(contextMenu.elementId!);
    if (!element) return;
    useClipboardStore.getState().copyElements([element]);
    setContextMenu({ ...contextMenu, isOpen: false });
  };

  const handlePasteAtCursor = async () => {
    // Right-click paste - use cursor position for both element and canvas
    if (!contextMenu.designPosition) return;

    // Paste target is the cursor position, already on screen — no scroll needed.
    await pasteElements({
      centerX: contextMenu.designPosition.x,
      centerY: contextMenu.designPosition.y,
    });

    setContextMenu({ ...contextMenu, isOpen: false });
  };

  const duplicateSlide = useSlideStore((s) => s.duplicateSlide);
  const hasClipboardData = useClipboardStore((s) => s.hasClipboardData);

  const handleDuplicateSlide = () => {
    const slideIndex = contextMenu.slideIndex ?? currentSlideIndex;
    duplicateSlide(slideIndex);
    setContextMenu({ ...contextMenu, isOpen: false });
  };

  // External focus request (e.g. layers panel double-click / drag start).
  // Switches to the element's slide and centers it in the viewport.
  useEffect(() => {
    if (focusRequestId === 0 || !selectedElementId) return;
    const element = elementMap.get(selectedElementId);
    if (!element) return;

    const slideIndex = getSlideIndexFromCenter(element.x, element.width, designSize.width);
    if (slideIndex >= 0 && slideIndex < numSlides) {
      setCurrentSlide(slideIndex);
    }

    // Defer to rAF so the slide-switch effect's scroll (triggered by the
    // setCurrentSlide above) runs first. Our scroll then supersedes it and
    // centers the element specifically. Use the live stage rect to compute
    // the element's position in scroll-content coords (handles paddingTop
    // and flex centering offsets without hardcoded constants).
    requestAnimationFrame(() => {
      const container = scrollContainerRef.current;
      const stage = stageContainerRef.current;
      if (!container || !stage) return;
      const stageRect = stage.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const stageLeftInScrollContent = (stageRect.left - containerRect.left) + container.scrollLeft;
      const stageTopInScrollContent = (stageRect.top - containerRect.top) + container.scrollTop;
      const elementCenterX = stageLeftInScrollContent + element.x * scale * zoomLevel + (element.width / 2) * scale * zoomLevel + 24;
      const elementCenterY = stageTopInScrollContent + (element.y + element.height / 2) * scale * zoomLevel;
      container.scrollTo({
        left: Math.max(0, elementCenterX - container.clientWidth / 2),
        top: Math.max(0, elementCenterY - container.clientHeight / 2),
        behavior: 'smooth',
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequestId]);

  const handleAddSlide = () => {
    if (slides.length < MAX_SLIDES) {
      addSlide();
    }
  };

  // Crop handlers
  const handleCropConfirm = (crop: {
    cropX: number;
    cropY: number;
    cropWidth: number;
    cropHeight: number;
    newWidth: number;
    newHeight: number;
  }) => {
    if (cropModeElementId) {
      const element = elementMap.get(cropModeElementId);
      if (!element) return;

      // The new crop values are normalized against the FULL image, so the
      // frame's new position is that rect's origin plus the window offset.
      const full = getFullImageRect(element);
      const newX = full.x + crop.cropX * full.width;
      const newY = full.y + crop.cropY * full.height;

      // Don't await - let the update happen in background to avoid race conditions
      // with component unmounting when exitCropMode is called
      updateElement(cropModeElementId, {
        cropX: crop.cropX,
        cropY: crop.cropY,
        cropWidth: crop.cropWidth,
        cropHeight: crop.cropHeight,
        x: newX,
        y: newY,
        width: crop.newWidth,
        height: crop.newHeight,
        lastCropRatio: cropAspectRatio,
        contentRotation: cropContentRotation,
      });
    }
    // Clear original state ref since crop was confirmed (not cancelled)
    cropOriginalStateRef.current = null;
    setCropShiftPressed(false);
    exitCropMode();
  };

  const croppingElement = cropModeElementId
    ? elementMap.get(cropModeElementId) ?? null
    : null;

  // Capture original element state when entering crop mode
  useEffect(() => {
    if (cropModeElementId && croppingElement && !cropOriginalStateRef.current) {
      cropOriginalStateRef.current = {
        x: croppingElement.x,
        y: croppingElement.y,
        cropX: croppingElement.cropX ?? 0,
        cropY: croppingElement.cropY ?? 0,
        cropWidth: croppingElement.cropWidth ?? 1,
        cropHeight: croppingElement.cropHeight ?? 1,
      };
    } else if (!cropModeElementId) {
      // Only clear ref when actually exiting crop mode (not during transient state updates)
      cropOriginalStateRef.current = null;
    }
  }, [cropModeElementId, croppingElement]);

  // Set initial crop ratio when entering crop mode (from element's saved ratio)
  // Also reset to null when exiting crop mode.
  // useLayoutEffect (not useEffect) so the Straighten value is seeded from the
  // element's saved contentRotation BEFORE the browser paints the first
  // crop-mode frame. As a post-paint effect it left cropContentRotation at 0
  // for one frame, so the crop-mode image (whose rotation is applied
  // imperatively from this value by CropOverlay's preview layout-effect) flashed
  // unrotated before snapping back to the saved rotation.
  const prevCropModeElementIdRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (cropModeElementId && cropModeElementId !== prevCropModeElementIdRef.current) {
      // Entering crop mode for a new element
      const element = elementMap.get(cropModeElementId);

      // Check if lastCropRatio exists on the element (could be null for Free, or a number)
      if ('lastCropRatio' in (element || {})) {
        setCropAspectRatio(element!.lastCropRatio ?? null);
        setShowCustomRatio(false);
      } else {
        // Default to free if no saved ratio
        setCropAspectRatio(null);
        setShowCustomRatio(false);
      }
      // Seed the Straighten slider from the element's saved content rotation
      setCropContentRotation(element?.contentRotation ?? 0);
    } else if (!cropModeElementId && prevCropModeElementIdRef.current) {
      // Exiting crop mode - reset ratio
      setCropAspectRatio(null);
      setShowCustomRatio(false);
      setCropContentRotation(0);
    }
    prevCropModeElementIdRef.current = cropModeElementId;
  }, [cropModeElementId, elements]);

  const handleCropCancel = () => {
    // Restore original element state (position and crop values) as a LOCAL
    // update — no history push, no backend call. Since shift+pan edits made
    // during crop mode were also local, the backend is still at the original
    // state and the global undo stack reflects whatever it held before crop
    // mode was entered.
    if (cropModeElementId && cropOriginalStateRef.current) {
      const original = cropOriginalStateRef.current;
      updateElementLocal(cropModeElementId, {
        x: original.x,
        y: original.y,
        cropX: original.cropX,
        cropY: original.cropY,
        cropWidth: original.cropWidth,
        cropHeight: original.cropHeight,
      });
    }
    cropOriginalStateRef.current = null;
    setCropShiftPressed(false);
    exitCropMode();
  };

  const handleCropElementDrag = useCallback((x: number, y: number) => {
    if (cropModeElementId) {
      // Local-only during crop mode — committed on confirm, discarded on cancel.
      updateElementLocal(cropModeElementId, { x, y });
    }
  }, [cropModeElementId, updateElementLocal]);

  const handleCropElementScale = useCallback((props: { cropX: number; cropY: number; cropWidth: number; cropHeight: number }) => {
    if (cropModeElementId) {
      updateElementLocal(cropModeElementId, props);
    }
  }, [cropModeElementId, updateElementLocal]);

  const croppingFullBounds = croppingElement
    ? {
        width: croppingElement.width / (croppingElement.cropWidth ?? 1),
        height: croppingElement.height / (croppingElement.cropHeight ?? 1),
      }
    : null;

  // Element the context menu is open on (photo-only items are gated on it)
  const contextMenuElement = contextMenu.elementId
    ? elementMap.get(contextMenu.elementId) ?? null
    : null;

  const totalCanvasWidth = numSlides * canvasSize.width;

  const stageOverflow = STAGE_OVERFLOW;
  stageOverflowRef.current = stageOverflow;

  // Check if content should be centered (when it doesn't overflow)
  const containerWidth = containerRef.current?.clientWidth || 0;
  const containerHeight = containerRef.current?.clientHeight || 0;
  const contentFitsWidth = totalCanvasWidth * zoomLevel + 48 < containerWidth;
  const contentFitsHeight = canvasSize.height * zoomLevel <= containerHeight;

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-hidden"
      onContextMenu={handleContextMenu}
    >
      {/* Scroll container extends STAGE_OVERFLOW px above/below the viewport
          (negative top/bottom inset), matched by paddingTop/paddingBottom.
          The outer container's overflow-hidden clips the overhang, so the
          Stage's handle buffer renders inside scroll padding without ever
          inflating scrollHeight at default zoom. Scrollbar hidden because
          its track would otherwise be clipped at top/bottom; horizontal
          scrolling is preserved via mouse wheel / pan. */}
      <div
        ref={scrollContainerRef}
        className={`absolute overflow-auto flex ${contentFitsHeight ? 'items-center' : 'items-start'} ${contentFitsWidth ? 'justify-center' : ''} [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`}
        style={{
          top: -stageOverflow,
          bottom: -stageOverflow,
          left: 0,
          right: 0,
          // Extra top gutter is asymmetric on purpose: it reserves room
          // for the slide number indicators which render above the canvas.
          paddingTop: stageOverflow + SLIDE_INDICATOR_GUTTER,
          paddingBottom: stageOverflow,
        }}
      >
        <div
          ref={stageContainerRef}
          className="relative"
          style={{
            width: totalCanvasWidth * zoomLevel + 48,
            height: canvasSize.height * zoomLevel,
            paddingLeft: 24,
            paddingRight: 24,
            flexShrink: 0,
          }}
        >
          {/* Slide number indicators */}
          <CanvasSlideIndicators
            slides={slides}
            currentSlideIndex={currentSlideIndex}
            canvasSize={canvasSize}
            zoomLevel={zoomLevel}
            onSlideClick={setCurrentSlide}
            onSlideDelete={removeSlide}
          />

          {/* Canvas background (white slides) */}
          <div
            ref={backdropRef}
            className={`absolute bg-white shadow-lg ${isFileDragOver ? 'ring-2 ring-blue-400 ring-opacity-50' : ''}`}
            style={{
              left: 24,
              top: 0,
              width: totalCanvasWidth * zoomLevel,
              height: canvasSize.height * zoomLevel,
            }}
          />

          {/* Konva Stage */}
          {canvasSize.width > 0 && canvasSize.height > 0 && (
            <Stage
              ref={stageRef}
              width={totalCanvasWidth * zoomLevel + 2 * stageOverflow}
              height={canvasSize.height * zoomLevel + 2 * stageOverflow}
              style={{
                position: 'absolute',
                left: 24 - stageOverflow,
                top: -stageOverflow,
                // CanvasSlideIndicators (a DOM sibling within the same
                // positioned ancestor) sets z-30, which always paints above
                // this z-index:auto Stage regardless of DOM order — so the
                // crop rotation dial (drawn on this canvas) rendered under
                // it. Only bump while actively cropping, so normal editing
                // keeps the original stacking (elements below the tabs).
                zIndex: cropModeElementId ? 40 : undefined,
              }}
              onClick={handleStageClick}
              onContextMenu={handleStageContextMenu}
            >
              <Layer scaleX={scale * zoomLevel} scaleY={scale * zoomLevel} x={stageOverflow} y={stageOverflow}>
                {/* White background for thumbnail captures */}
                <Rect
                  x={0}
                  y={0}
                  width={totalDesignWidth}
                  height={designSize.height}
                  fill="white"
                  listening={false}
                />
                {/* Clip group keeps element images within canvas bounds while
                    allowing the Transformer (outside this Group) to draw handles beyond */}
                <Group
                  clipFunc={(ctx) => {
                    ctx.rect(0, 0, totalDesignWidth, designSize.height);
                  }}
                >
                  {/* Render all elements sorted by zIndex */}
                  {sortedElements.map((element) => {
                      const loadedImage = loadedImages.get(element.id);
                      return (
                        <CanvasElementRenderer
                          key={element.id}
                          element={element}
                          loadedImage={loadedImage || null}
                          isSelected={selectedElementId === element.id}
                          isBeingCropped={cropModeElementId === element.id}
                          zoomLevel={zoomLevel}
                          onElementClick={handleElementClick}
                          onDragStart={handleDragStart}
                          onDragMove={handleDragMove}
                          onDragEnd={handleDragEnd}
                          onTransformEnd={handleTransformEnd}
                          cropModeElementId={cropModeElementId}
                          cachePixelRatio={cachePixelRatio}
                        />
                      );
                    })}
                </Group>

                {/* Snap guides and slide separators */}
                <CanvasSnapGuides
                  designSize={designSize}
                  totalDesignWidth={totalDesignWidth}
                  numSlides={numSlides}
                  scale={scale}
                  zoomLevel={zoomLevel}
                  elements={elements}
                />

                {/* Fill preview overlay (F-key fill mode during media drag) */}
                {fillPreview && (
                  <Rect
                    x={fillPreview.x}
                    y={fillPreview.y}
                    width={fillPreview.width}
                    height={fillPreview.height}
                    fill="rgba(59, 130, 246, 0.15)"
                    stroke="#3b82f6"
                    strokeWidth={2 / (scale * zoomLevel)}
                    dash={[6 / (scale * zoomLevel), 4 / (scale * zoomLevel)]}
                    listening={false}
                  />
                )}

                {/* Replace preview overlay (R-key replace mode during drag) */}
                {replacePreview && (
                  <Rect
                    x={replacePreview.x}
                    y={replacePreview.y}
                    width={replacePreview.width}
                    height={replacePreview.height}
                    fill="rgba(168, 85, 247, 0.2)"
                    stroke="#a855f7"
                    strokeWidth={2 / (scale * zoomLevel)}
                    dash={[6 / (scale * zoomLevel), 4 / (scale * zoomLevel)]}
                    listening={false}
                  />
                )}

                {/* Swap preview overlay (S-key swap during element drag) */}
                {swapPreview && (
                  <Rect
                    x={swapPreview.x}
                    y={swapPreview.y}
                    width={swapPreview.width}
                    height={swapPreview.height}
                    fill="rgba(16, 185, 129, 0.2)"
                    stroke="#10b981"
                    strokeWidth={2 / (scale * zoomLevel)}
                    dash={[6 / (scale * zoomLevel), 4 / (scale * zoomLevel)]}
                    listening={false}
                  />
                )}

                {/* Transformer */}
                {!cropModeElementId && (
                  <Transformer
                    ref={transformerRef}
                    boundBoxFunc={(oldBox, newBox) => {
                      if (newBox.width < 20 || newBox.height < 20) {
                        return oldBox;
                      }
                      return newBox;
                    }}
                    rotateEnabled={true}
                    rotationSnaps={[0, 90, 180, 270]}
                    rotationSnapTolerance={5}
                    onTransformStart={handleTransformStart}
                    onTransform={handleTransform}
                    enabledAnchors={[
                      'top-left',
                      'top-right',
                      'bottom-left',
                      'bottom-right',
                      'middle-left',
                      'middle-right',
                      'top-center',
                      'bottom-center',
                    ]}
                  />
                )}

                {/* Crop overlay */}
                {croppingElement && croppingFullBounds && (
                  <>
                    <CropOverlay
                      element={croppingElement}
                      fullBounds={croppingFullBounds}
                      aspectRatio={cropAspectRatio}
                      onCropConfirm={handleCropConfirm}
                      onCancel={handleCropCancel}
                      shiftPressed={cropShiftPressed}
                      onElementDrag={handleCropElementDrag}
                      onElementScale={handleCropElementScale}
                      snapEnabled={snapEnabled}
                      snapSettings={snapSettings}
                      elements={elements}
                      totalDesignWidth={totalDesignWidth}
                      canvasHeight={designSize.height}
                      slideWidth={designSize.width}
                      numSlides={numSlides}
                      layerScale={scale * zoomLevel}
                      resetKey={cropResetKey}
                      contentRotation={cropContentRotation}
                      onContentRotationChange={setCropContentRotation}
                      applyRef={cropApplyRef}
                    />
                  </>
                )}
              </Layer>
            </Stage>
          )}

          {/* Add slide buttons */}
          {slides.length < MAX_SLIDES && (
            <div
              className="absolute flex flex-col gap-2"
              style={{
                left: 24 + totalCanvasWidth * zoomLevel + 8,
                top: (canvasSize.height * zoomLevel) / 2 - 36,
              }}
            >
              {/* Add empty slide button */}
              <button
                onClick={handleAddSlide}
                className="flex items-center justify-center w-8 h-8 bg-gray-700 hover:bg-gray-600 text-white rounded-full shadow-md transition-colors"
                title="Add empty slide"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 4v16m8-8H4"
                  />
                </svg>
              </button>
              {/* Add slide with template button */}
              <button
                onClick={() => setIsTemplatePickerOpen(true)}
                className="flex items-center justify-center w-8 h-8 bg-gray-700 hover:bg-gray-600 text-white rounded-full shadow-md transition-colors"
                title="Add slide with template"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z"
                  />
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Zoom controls */}
      <CanvasZoomControls
        zoomLevel={zoomLevel}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onResetZoom={resetZoom}
      />

      {/* Crop toolbar */}
      <CanvasCropToolbar
        cropAspectRatio={cropAspectRatio}
        showCustomRatio={showCustomRatio}
        customRatioWidth={customRatioWidth}
        customRatioHeight={customRatioHeight}
        croppingFullBounds={croppingFullBounds}
        contentRotation={cropContentRotation}
        onContentRotationChange={setCropContentRotation}
        onRatioChange={setCropAspectRatio}
        onCustomRatioToggle={() => {
          if (!showCustomRatio) {
            setShowCustomRatio(true);
            const w = parseFloat(customRatioWidth);
            const h = parseFloat(customRatioHeight);
            if (w > 0 && h > 0) {
              setCropAspectRatio(w / h);
            }
          } else {
            setShowCustomRatio(false);
          }
        }}
        onCustomWidthChange={(value) => {
          setCustomRatioWidth(value);
          const w = parseFloat(value);
          const h = parseFloat(customRatioHeight);
          if (w > 0 && h > 0) {
            setCropAspectRatio(w / h);
          }
        }}
        onCustomHeightChange={(value) => {
          setCustomRatioHeight(value);
          const w = parseFloat(customRatioWidth);
          const h = parseFloat(value);
          if (w > 0 && h > 0) {
            setCropAspectRatio(w / h);
          }
        }}
        onReset={() => {
          setCropResetKey((k) => k + 1);
          setCropAspectRatio(null);
          setShowCustomRatio(false);
          setCropContentRotation(0);
        }}
        onCancel={handleCropCancel}
        onApply={() => cropApplyRef.current?.()}
      />

      {/* Context menu - shows different items for elements vs empty canvas */}
      <ContextMenu
        isOpen={contextMenu.isOpen}
        onClose={() => setContextMenu({ ...contextMenu, isOpen: false })}
        position={contextMenu.position}
      >
        {contextMenu.elementId ? (
          <>
            <ContextMenuItem onClick={handleFlipHorizontal}>
              Flip Horizontal
            </ContextMenuItem>
            <ContextMenuItem onClick={handleFlipVertical}>
              Flip Vertical
            </ContextMenuItem>
            {contextMenuElement?.type === 'photo' && (
              <ContextMenuItem onClick={handleCropFromMenu}>
                Crop
              </ContextMenuItem>
            )}
            <ContextMenuItem onClick={handleCopyElement}>
              Copy
            </ContextMenuItem>
            <ContextMenuItem onClick={handlePasteAtCursor}>
              Paste
            </ContextMenuItem>
            {contextMenuElement?.type === 'photo' && (
              <>
                <ContextMenuItem onClick={handleResetCrop}>
                  Reset Crop
                </ContextMenuItem>
                <ContextMenuItem onClick={handleResetAspectRatio}>
                  Reset Aspect Ratio
                </ContextMenuItem>
              </>
            )}
            <ContextMenuItem onClick={handleCenterOnCanvas}>
              Center on Canvas
            </ContextMenuItem>
            <ContextMenuItem onClick={handleSendToFront}>
              Send to Front
            </ContextMenuItem>
            <ContextMenuItem onClick={handleSendToBack}>
              Send to Back
            </ContextMenuItem>
            <ContextMenuItem onClick={handleCreateFrame}>
              Create Frame
            </ContextMenuItem>
            <ContextMenuItem onClick={handleDeleteFromMenu} danger>
              Delete
            </ContextMenuItem>
          </>
        ) : (
          <>
            <ContextMenuItem onClick={handleAddFrame}>
              Add Frame
            </ContextMenuItem>
            {hasClipboardData() && (
              <ContextMenuItem onClick={handlePasteAtCursor}>
                Paste
              </ContextMenuItem>
            )}
            <ContextMenuItem onClick={handleDuplicateSlide}>
              Duplicate Slide
            </ContextMenuItem>
            <ContextMenuItem onClick={handleSaveSlideAsTemplate}>
              Save Slide as Template
            </ContextMenuItem>
            {slides.length > 1 && (
              <ContextMenuItem onClick={handleDeleteSlide} danger>
                Delete Slide
              </ContextMenuItem>
            )}
          </>
        )}
      </ContextMenu>
    </div>
  );
}
