import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { Stage, Layer, Group, Transformer, Rect } from 'react-konva';
import type Konva from 'konva';
import type { AspectRatio, Element, Template } from '../../types';
import { useProjectStore } from '../../stores/projectStore';
import { useSlideStore } from '../../stores/slideStore';
import { useElementStore } from '../../stores/elementStore';
import { useMediaStore } from '../../stores/mediaStore';
import { useSnapStore } from '../../stores/snapStore';
import { useCropStore } from '../../stores/cropStore';
import { useTemplatesStore } from '../../stores/templatesStore';
import { useClipboardStore } from '../../stores/clipboardStore';
import { useHistoryStore } from '../../stores/historyStore';
import { saveProjectThumbnail } from '../../services/tauri';
import { calculateSnapLines, findSnap, findTransformSnap } from '../../utils/snapping';
import { CropOverlay } from './CropOverlay';
import { ContextMenu, ContextMenuItem } from '../common/ContextMenu';
import { TemplatePickerModal } from './TemplatePickerModal';
import { CanvasSlideIndicators } from './CanvasSlideIndicators';
import { CanvasZoomControls } from './CanvasZoomControls';
import { CanvasCropToolbar } from './CanvasCropToolbar';
import { CanvasSnapGuides } from './CanvasSnapGuides';
import { CanvasElementRenderer } from './CanvasElementRenderer';
import { v4 as uuidv4 } from 'uuid';
import { DESIGN_HEIGHT, getDesignSize } from '../../utils/designConstants';
import { getSlideIndex, getSlideIndexFromCenter } from '../../utils/slideUtils';
import { useCanvasZoom, useCanvasFileDrop, useCanvasImages, useCanvasMediaDrop } from '../../hooks/canvas';
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
  const addSlideWithTemplate = useSlideStore((s) => s.addSlideWithTemplate);
  const removeSlide = useSlideStore((s) => s.removeSlide);

  // Element store
  const selectedElementId = useElementStore((s) => s.selectedElementId);
  const selectElement = useElementStore((s) => s.selectElement);
  const updateElement = useElementStore((s) => s.updateElement);
  const updateElementLocal = useElementStore((s) => s.updateElementLocal);
  const removeElement = useElementStore((s) => s.removeElement);
  const sendToFront = useElementStore((s) => s.sendToFront);
  const sendToBack = useElementStore((s) => s.sendToBack);
  const addElement = useElementStore((s) => s.addElement);
  const copySelectedElement = useElementStore((s) => s.copySelectedElement);
  const pasteElements = useElementStore((s) => s.pasteElements);

  // Media store - use selector to avoid re-renders from drag position updates
  const draggingMediaId = useMediaStore((s) => s.draggingMediaId);

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

  // History store
  const undo = useHistoryStore((s) => s.undo);
  const redo = useHistoryStore((s) => s.redo);

  // Template picker modal state
  const [isTemplatePickerOpen, setIsTemplatePickerOpen] = useState(false);

  const handleSelectTemplate = useCallback((template: Template) => {
    addSlideWithTemplate(template);
    setIsTemplatePickerOpen(false);
  }, [addSlideWithTemplate]);

  const slides = project?.slides || [];
  const elements = project?.elements || [];
  const numSlides = slides.length;

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

  // Throttle refs for drag operations - reduce expensive calculations during drag
  const lastSnapCalcRef = useRef<{ x: number; y: number; time: number }>({ x: 0, y: 0, time: 0 });
  const lastSnapTargetRef = useRef<{ x: number; y: number; snappedX: boolean; snappedY: boolean }>({ x: 0, y: 0, snappedX: false, snappedY: false });
  const SNAP_THROTTLE_MS = 32; // ~30fps for snap calculations
  const SNAP_MIN_DISTANCE = 3; // Minimum pixels moved before recalculating snaps
  const { stopAutoScroll, updateScrollSpeed } = useCanvasAutoScroll({
    scrollContainerRef,
    canvasSize,
    zoomLevel,
    isDragging: isDraggingRef.current,
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

  // Media drop hook
  useCanvasMediaDrop({
    stageContainerRef,
    numSlides,
    canvasSize,
    scale,
    zoomLevel,
    designSize,
    totalDesignWidth,
    elements,
  });

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

  // Middle-mouse panning. Press-and-hold middle button anywhere inside the
  // scroll container to drag-scroll the canvas; releases or pointer leaves
  // the window to cancel. Prevents the browser's native middle-click
  // auto-scroll from activating.
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    let panning = false;
    let startClientX = 0;
    let startClientY = 0;
    let startScrollLeft = 0;
    let startScrollTop = 0;
    const prevCursor = container.style.cursor;

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 1) return;
      // Suppress the browser's native auto-scroll UI.
      e.preventDefault();
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
      container.style.cursor = prevCursor;
    };

    const onMouseUp = (e: MouseEvent) => {
      if (e.button !== 1) return;
      endPan();
    };

    // Block the middle-click auto-scroll icon that some browsers show.
    const onAuxClick = (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault();
    };

    container.addEventListener('mousedown', onMouseDown);
    container.addEventListener('auxclick', onAuxClick);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('blur', endPan);

    return () => {
      container.removeEventListener('mousedown', onMouseDown);
      container.removeEventListener('auxclick', onAuxClick);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('blur', endPan);
    };
  }, []);

  // Crop aspect ratio state
  const [cropAspectRatio, setCropAspectRatio] = useState<number | null>(null);
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

      // Use most of the available height (leaving minimal padding)
      const padding = 60;
      const availableHeight = containerHeight - padding;

      const height = Math.max(200, availableHeight);
      const width = height * targetRatio;

      setCanvasSize({ width, height });
    };

    updateCanvasSize();

    const resizeObserver = new ResizeObserver(updateCanvasSize);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => resizeObserver.disconnect();
  }, [aspectRatio]);

  // Snapshot generator function (memoized via ref to avoid stale closures)
  const generateSnapshot = useCallback(() => {
    if (!stageRef.current) return null;
    try {
      const stage = stageRef.current;
      console.time('generateSnapshot');
      // Use a fixed low resolution for fast thumbnail generation
      const result = stage.toDataURL({
        pixelRatio: 0.5, // Low res for speed
        mimeType: 'image/jpeg',
        quality: 0.7,
      });
      console.timeEnd('generateSnapshot');
      return result;
    } catch (error) {
      console.error('Failed to generate snapshot:', error);
      return null;
    }
  }, []);

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
        transformer.getLayer()?.batchDraw();
      }
    } else {
      transformer.nodes([]);
      transformer.getLayer()?.batchDraw();
    }
  }, [selectedElementId, cropModeElementId, loadedImages.get(selectedElementId ?? '')]);

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

  // Keyboard handling hook
  useCanvasKeyboard({
    selectedElementId,
    elements,
    cropModeElementId,
    onSelectElement: selectElement,
    onUpdateElement: updateElement,
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

        const newIds = await pasteElements({ centerX: clampedX, centerY: clampedY });

        // Scroll to first pasted element if needed
        if (newIds.length > 0) {
          const firstElement = elementMap.get(newIds[0]);
          if (firstElement) {
            scrollToElement(firstElement);
          }
        }
      }
    },
  });

  // Removed: This effect was conflicting with the restore ratio effect below.
  // The ratio is now reset to null only in the else branch of the restore effect.

  // Zoom logic is handled by useCanvasZoom hook

  // Scroll to current slide when it changes (only if not fully visible)
  useEffect(() => {
    if (!scrollContainerRef.current || canvasSize.width <= 0) return;

    const container = scrollContainerRef.current;
    const slideScreenWidth = canvasSize.width * zoomLevel;
    const totalContentWidth = numSlides * slideScreenWidth + 48; // 48 = left + right padding
    const viewPadding = 24; // Padding to show part of adjacent slides

    // If content fits in viewport, all slides are visible - no need to scroll
    if (totalContentWidth <= container.clientWidth) return;

    // Calculate slide position within content (relative to content left edge)
    const slideLeftInContent = 24 + currentSlideIndex * slideScreenWidth;
    const slideRightInContent = slideLeftInContent + slideScreenWidth;

    // Get visible range
    const visibleLeft = container.scrollLeft;
    const visibleRight = container.scrollLeft + container.clientWidth;

    // Check visibility with padding
    const isOffLeft = slideLeftInContent < visibleLeft + viewPadding;
    const isOffRight = slideRightInContent > visibleRight - viewPadding;

    // Only scroll if slide is not fully visible (with padding)
    if (isOffLeft && !isOffRight) {
      // Slide is off to the left - align left edge with padding
      container.scrollTo({
        left: Math.max(0, slideLeftInContent - viewPadding),
        behavior: 'smooth',
      });
    } else if (isOffRight && !isOffLeft) {
      // Slide is off to the right - align right edge with padding
      container.scrollTo({
        left: Math.max(0, slideRightInContent - container.clientWidth + viewPadding),
        behavior: 'smooth',
      });
    } else if (isOffLeft && isOffRight) {
      // Slide is larger than viewport or completely off-screen - center it
      const slideCenterInContent = slideLeftInContent + slideScreenWidth / 2;
      container.scrollTo({
        left: Math.max(0, slideCenterInContent - container.clientWidth / 2),
        behavior: 'smooth',
      });
    }
  }, [currentSlideIndex, canvasSize.width, zoomLevel, numSlides]);

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
      const slideIndex = getSlideIndexFromCenter(element.x, element.width, designSize.width);
      if (slideIndex >= 0 && slideIndex < numSlides) {
        setCurrentSlide(slideIndex);
      }
    }
  }, [selectElement, elementMap, designSize.width, numSlides, setCurrentSlide]);

  // Clamp element to visible bounds (can span across entire canvas)
  const clampToVisibleBounds = useCallback(
    (x: number, y: number, elementWidth: number, elementHeight: number) => {
      const minVisible = 50;
      const clampedX = Math.max(
        -elementWidth + minVisible,
        Math.min(x, totalDesignWidth - minVisible)
      );
      const clampedY = Math.max(
        -elementHeight + minVisible,
        Math.min(y, designSize.height - minVisible)
      );
      return { x: clampedX, y: clampedY };
    },
    [totalDesignWidth, designSize.height]
  );

  // Auto-scroll logic is handled by useCanvasAutoScroll hook

  // Handle drag with snapping - THROTTLED to reduce CPU usage
  const handleDragMove = useCallback(
    (elementId: string, e: Konva.KonvaEventObject<DragEvent>) => {
      const node = e.target;
      const element = elementMap.get(elementId);
      if (!element) return;

      let newX = node.x();
      let newY = node.y();

      // Apply snapping (snap to slide boundaries and other elements)
      // THROTTLED: Only recalculate snap lines if enough time/distance has passed,
      // but always apply the cached snap offset so the element "sticks" to the snap
      // position instead of jittering between raw and snapped positions.
      if (snapEnabled) {
        const now = performance.now();
        const lastCalc = lastSnapCalcRef.current;
        const dx = Math.abs(newX - lastCalc.x);
        const dy = Math.abs(newY - lastCalc.y);
        const timeSinceLastCalc = now - lastCalc.time;

        // Only recalculate if moved enough or enough time passed
        if (dx >= SNAP_MIN_DISTANCE || dy >= SNAP_MIN_DISTANCE || timeSinceLastCalc >= SNAP_THROTTLE_MS) {
          const snapLines = calculateSnapLines(
            elements,
            elementId,
            totalDesignWidth,
            designSize.height,
            snapSettings,
            designSize.width,
            numSlides
          );

          const elementRect = {
            x: newX,
            y: newY,
            width: element.width,
            height: element.height,
          };
          const snapResult = findSnap(elementRect, snapLines, 10);

          // Cache the snap target so throttled frames stick to it
          lastSnapTargetRef.current = {
            x: snapResult.x,
            y: snapResult.y,
            snappedX: snapResult.x !== newX,
            snappedY: snapResult.y !== newY,
          };

          newX = snapResult.x;
          newY = snapResult.y;
          setActiveGuides(snapResult.guides);

          // Update last calculation tracking
          lastSnapCalcRef.current = { x: newX, y: newY, time: now };
        } else {
          // Throttled frame: force to cached snap target for sticky feel
          const lastSnap = lastSnapTargetRef.current;
          if (lastSnap.snappedX) newX = lastSnap.x;
          if (lastSnap.snappedY) newY = lastSnap.y;
        }
      }

      // Clamp to bounds (cheap operation, always do it)
      const clamped = clampToVisibleBounds(newX, newY, element.width, element.height);
      node.x(clamped.x);
      node.y(clamped.y);

      // Update auto-scroll based on mouse position
      updateScrollSpeed(e.evt.clientX);
    },
    [elementMap, snapEnabled, snapSettings, totalDesignWidth, designSize.width, designSize.height, numSlides, setActiveGuides, clampToVisibleBounds, updateScrollSpeed, elements]
  );

  // Handle drag start
  const handleDragStart = useCallback(() => {
    isDraggingRef.current = true;
    lastSnapTargetRef.current = { x: 0, y: 0, snappedX: false, snappedY: false };
  }, []);

  // Handle drag end - apply final snap and persist position
  const handleDragEnd = useCallback(
    (elementId: string, e: Konva.KonvaEventObject<DragEvent>) => {
      const node = e.target;
      const element = elementMap.get(elementId);
      if (!element) return;

      // Stop auto-scroll and reset drag state
      stopAutoScroll();
      isDraggingRef.current = false;

      let newX = node.x();
      let newY = node.y();

      // Apply final snap calculation on drop (since drag snap was throttled)
      if (snapEnabled) {
        const snapLines = calculateSnapLines(
          elements,
          elementId,
          totalDesignWidth,
          designSize.height,
          snapSettings,
          designSize.width,
          numSlides
        );
        const elementRect = {
          x: newX,
          y: newY,
          width: element.width,
          height: element.height,
        };
        const snapResult = findSnap(elementRect, snapLines, 10);
        newX = snapResult.x;
        newY = snapResult.y;
      }

      setActiveGuides([]);
      const clamped = clampToVisibleBounds(newX, newY, element.width, element.height);
      updateElement(elementId, { x: clamped.x, y: clamped.y });

      // Update current slide based on where element was dropped
      const slideIndex = getSlideIndexFromCenter(clamped.x, element.width, designSize.width);
      if (slideIndex >= 0 && slideIndex < numSlides) {
        setCurrentSlide(slideIndex);
      }
    },
    [elementMap, updateElement, setActiveGuides, clampToVisibleBounds, designSize.width, designSize.height, numSlides, setCurrentSlide, stopAutoScroll, snapEnabled, snapSettings, totalDesignWidth, elements]
  );

  // Handle transform end
  const handleTransformEnd = useCallback(
    (elementId: string, e: Konva.KonvaEventObject<Event>) => {
      const node = e.target;
      const scaleX = node.scaleX();
      const scaleY = node.scaleY();

      node.scaleX(1);
      node.scaleY(1);

      const newWidth = Math.max(20, node.width() * scaleX);
      const newHeight = Math.max(20, node.height() * scaleY);

      // Clear guides and anchor ref
      setActiveGuides([]);
      activeAnchorRef.current = null;

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
  }, []);

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

    const snapLines = calculateSnapLines(
      elements,
      selectedElementId,
      totalDesignWidth,
      designSize.height,
      snapSettings,
      designSize.width,
      numSlides
    );

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
  }, [snapEnabled, selectedElementId, elements, totalDesignWidth, designSize.height, designSize.width, numSlides, snapSettings, setActiveGuides]);

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

    const existingCropX = element.cropX ?? 0;
    const existingCropY = element.cropY ?? 0;
    const existingCropW = element.cropWidth ?? 1;
    const existingCropH = element.cropHeight ?? 1;

    if (existingCropX === 0 && existingCropY === 0 && existingCropW === 1 && existingCropH === 1) {
      setContextMenu({ ...contextMenu, isOpen: false });
      return;
    }

    const fullWidth = element.width / existingCropW;
    const fullHeight = element.height / existingCropH;
    const fullX = element.x - existingCropX * fullWidth;
    const fullY = element.y - existingCropY * fullHeight;

    updateElement(contextMenu.elementId, {
      cropX: 0,
      cropY: 0,
      cropWidth: 1,
      cropHeight: 1,
      x: fullX,
      y: fullY,
      width: fullWidth,
      height: fullHeight,
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

    const newIds = await pasteElements({
      centerX: contextMenu.designPosition.x,
      centerY: contextMenu.designPosition.y,
    });

    // Scroll to first pasted element if needed
    if (newIds.length > 0 && scrollContainerRef.current) {
      const firstElement = elementMap.get(newIds[0]);
      if (firstElement) {
        scrollToElement(firstElement);
      }
    }

    setContextMenu({ ...contextMenu, isOpen: false });
  };

  const duplicateSlide = useSlideStore((s) => s.duplicateSlide);
  const hasClipboardData = useClipboardStore((s) => s.hasClipboardData);

  const handleDuplicateSlide = () => {
    const slideIndex = contextMenu.slideIndex ?? currentSlideIndex;
    duplicateSlide(slideIndex);
    setContextMenu({ ...contextMenu, isOpen: false });
  };

  // Scroll to make an element visible
  const scrollToElement = (element: Element) => {
    if (!scrollContainerRef.current) return;

    const container = scrollContainerRef.current;

    // Calculate element center in screen coordinates
    const elementCenterX = (element.x + element.width / 2) * scale * zoomLevel + 24;

    // Get visible range
    const visibleLeft = container.scrollLeft;
    const visibleRight = container.scrollLeft + container.clientWidth;

    // Check if element is visible
    const elementLeft = element.x * scale * zoomLevel + 24;
    const elementRight = (element.x + element.width) * scale * zoomLevel + 24;

    if (elementLeft < visibleLeft || elementRight > visibleRight) {
      // Scroll to center the element
      container.scrollTo({
        left: Math.max(0, elementCenterX - container.clientWidth / 2),
        behavior: 'smooth',
      });
    }
  };

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

      const existingCropX = element.cropX ?? 0;
      const existingCropY = element.cropY ?? 0;
      const existingCropW = element.cropWidth ?? 1;
      const existingCropH = element.cropHeight ?? 1;
      const fullBoundsWidth = element.width / existingCropW;
      const fullBoundsHeight = element.height / existingCropH;
      const fullBoundsX = element.x - existingCropX * fullBoundsWidth;
      const fullBoundsY = element.y - existingCropY * fullBoundsHeight;

      const newX = fullBoundsX + crop.cropX * fullBoundsWidth;
      const newY = fullBoundsY + crop.cropY * fullBoundsHeight;

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
  // Also reset to null when exiting crop mode
  const prevCropModeElementIdRef = useRef<string | null>(null);
  useEffect(() => {
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
    } else if (!cropModeElementId && prevCropModeElementIdRef.current) {
      // Exiting crop mode - reset ratio
      setCropAspectRatio(null);
      setShowCustomRatio(false);
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

  const croppingFullBounds = croppingElement
    ? {
        width: croppingElement.width / (croppingElement.cropWidth ?? 1),
        height: croppingElement.height / (croppingElement.cropHeight ?? 1),
      }
    : null;

  const showDropZone = draggingMediaId !== null;
  const totalCanvasWidth = numSlides * canvasSize.width;

  // Dynamic Stage overflow so Transformer handles are never clipped.
  // Sized to the largest element (handles can be at most elementSize away from canvas edge).
  const maxElementDim = useMemo(() => {
    let max = 0;
    for (const el of elements) {
      if (el.width > max) max = el.width;
      if (el.height > max) max = el.height;
    }
    return max;
  }, [elements]);
  const stageOverflow = Math.min(Math.ceil(maxElementDim * scale * zoomLevel) + 20, 800);
  stageOverflowRef.current = stageOverflow;

  // Check if content should be centered (when it doesn't overflow)
  const containerWidth = containerRef.current?.clientWidth || 0;
  const containerHeight = containerRef.current?.clientHeight || 0;
  const contentFitsWidth = totalCanvasWidth * zoomLevel + 48 < containerWidth;
  const contentFitsHeight = canvasSize.height * zoomLevel + 40 < containerHeight; // 40 = paddingTop + paddingBottom

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 flex flex-col overflow-hidden"
      onContextMenu={handleContextMenu}
    >
      {/* Scrolling canvas container - overflow-auto for zoom support */}
      <div
        ref={scrollContainerRef}
        className={`flex-1 overflow-auto flex ${contentFitsHeight ? 'items-center' : 'items-start'} ${contentFitsWidth ? 'justify-center' : ''}`}
        style={{ paddingTop: 30, paddingBottom: 10 }}
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
            className={`absolute bg-white shadow-lg ${showDropZone || isFileDragOver ? 'ring-2 ring-blue-400 ring-opacity-50' : ''}`}
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
              height={canvasSize.height * zoomLevel + stageOverflow}
              style={{ position: 'absolute', left: 24 - stageOverflow, top: -stageOverflow, pointerEvents: showDropZone ? 'none' : undefined }}
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
                />

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
                      snapEnabled={snapEnabled}
                      snapSettings={snapSettings}
                      elements={elements}
                      totalDesignWidth={totalDesignWidth}
                      canvasHeight={designSize.height}
                      slideWidth={designSize.width}
                      numSlides={numSlides}
                      resetKey={cropResetKey}
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
        }}
        onCancel={handleCropCancel}
        onApply={() => {
          const event = new KeyboardEvent('keydown', { key: 'Enter' });
          window.dispatchEvent(event);
        }}
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
            <ContextMenuItem onClick={handleCropFromMenu}>
              Crop
            </ContextMenuItem>
            <ContextMenuItem onClick={handleCopyElement}>
              Copy
            </ContextMenuItem>
            <ContextMenuItem onClick={handlePasteAtCursor}>
              Paste
            </ContextMenuItem>
            <ContextMenuItem onClick={handleResetCrop}>
              Reset Crop
            </ContextMenuItem>
            <ContextMenuItem onClick={handleResetAspectRatio}>
              Reset Aspect Ratio
            </ContextMenuItem>
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

      {/* Template picker modal */}
      <TemplatePickerModal
        isOpen={isTemplatePickerOpen}
        onClose={() => setIsTemplatePickerOpen(false)}
        onSelect={handleSelectTemplate}
        aspectRatio={aspectRatio}
      />
    </div>
  );
}
