import { useRef, useEffect, useState, useCallback } from 'react';
import { Stage, Layer, Image as KonvaImage, Transformer, Line, Rect, Group } from 'react-konva';
import { convertFileSrc } from '@tauri-apps/api/core';
import type Konva from 'konva';
import type { AspectRatio, Element, Template } from '../../types';
import { useEditorStore } from '../../stores/editorStore';
import { useTemplatesStore } from '../../stores/templatesStore';
import { calculateSnapLines, findSnap, findTransformSnap, generateStaticGuides } from '../../utils/snapping';
import { CropOverlay } from './CropOverlay';
import { ContextMenu, ContextMenuItem } from '../common/ContextMenu';
import { TemplatePickerModal } from './TemplatePickerModal';
import { v4 as uuidv4 } from 'uuid';

interface CanvasAreaProps {
  aspectRatio: AspectRatio;
}

// Fixed design height for consistent element sizing
const DESIGN_HEIGHT = 1080;
const MAX_SLIDES = 20;

// Zoom constraints
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 1.5;
const ZOOM_STEP = 0.1;

export function CanvasArea({ aspectRatio }: CanvasAreaProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const stageContainerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [loadedImages, setLoadedImages] = useState<Map<string, HTMLImageElement>>(new Map());

  // Design size is fixed based on aspect ratio (per slide)
  const designSize = {
    width: DESIGN_HEIGHT * (aspectRatio.width / aspectRatio.height),
    height: DESIGN_HEIGHT,
  };

  const scale = canvasSize.height > 0 ? canvasSize.height / DESIGN_HEIGHT : 1;

  const {
    project,
    currentSlideIndex,
    setCurrentSlide,
    selectedElementId,
    selectElement,
    updateElement,
    removeElement,
    sendToFront,
    sendToBack,
    draggingMediaId,
    setDraggingMedia,
    setDragMousePosition,
    cropModeElementId,
    enterCropMode,
    exitCropMode,
    addSlide,
    addSlideWithTemplate,
    removeSlide,
    addElement,
    clearMediaSelection,
    snapEnabled,
    snapSettings,
    activeGuides,
    setActiveGuides,
  } = useEditorStore();

  const { templates, saveSlideAsTemplate } = useTemplatesStore();

  // Template picker modal state
  const [isTemplatePickerOpen, setIsTemplatePickerOpen] = useState(false);

  const handleSelectTemplate = useCallback((template: Template) => {
    addSlideWithTemplate(template);
    setIsTemplatePickerOpen(false);
  }, [addSlideWithTemplate]);

  const slides = project?.slides || [];
  const elements = project?.elements || [];
  const numSlides = slides.length;

  // Total canvas width in design coordinates
  const totalDesignWidth = numSlides * designSize.width;

  // Track shift key for centered scaling
  const isShiftPressed = useRef(false);
  // State version for crop mode shift+pan (triggers re-renders)
  const [cropShiftPressed, setCropShiftPressed] = useState(false);

  // Track active anchor for transform snapping
  const activeAnchorRef = useRef<string | null>(null);

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
  }, []);

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

  // Track original element position when entering crop mode (for cancellation)
  const cropOriginalPositionRef = useRef<{ x: number; y: number } | null>(null);

  // Zoom state for canvas
  const [zoomLevel, setZoomLevel] = useState(1);

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

  // Crop aspect ratio state
  const [cropAspectRatio, setCropAspectRatio] = useState<number | null>(null);

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

  // Load images for all elements
  useEffect(() => {
    const loadImages = async () => {
      const newLoadedImages = new Map<string, HTMLImageElement>();

      for (const element of elements) {
        if (element.type === 'photo' && element.mediaId) {
          let imagePath: string | null = null;

          if (element.assetPath) {
            imagePath = element.assetPath;
          } else {
            const media = project?.mediaPool.find((m) => m.id === element.mediaId);
            if (media) {
              imagePath = media.filePath;
            }
          }

          if (imagePath) {
            const existingImage = loadedImages.get(element.id);
            if (existingImage) {
              newLoadedImages.set(element.id, existingImage);
            } else {
              const img = new window.Image();
              img.crossOrigin = 'anonymous';
              img.src = convertFileSrc(imagePath);
              await new Promise<void>((resolve) => {
                img.onload = () => resolve();
                img.onerror = () => resolve();
              });
              newLoadedImages.set(element.id, img);
            }
          }
        }
      }

      setLoadedImages(newLoadedImages);
    };

    loadImages();
  }, [elements, project?.mediaPool]);

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
  }, [selectedElementId, cropModeElementId, loadedImages]);

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

  // Handle keyboard events
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (e.key === 'Escape') {
        if (cropModeElementId) {
          // Restore original element position if it was moved during Shift+pan
          if (cropOriginalPositionRef.current) {
            const originalPos = cropOriginalPositionRef.current;
            updateElement(cropModeElementId, {
              x: originalPos.x,
              y: originalPos.y,
            });
          }
          cropOriginalPositionRef.current = null;
          setCropShiftPressed(false);
          exitCropMode();
          return;
        }
        selectElement(null);
        return;
      }

      // Zoom with Cmd/Ctrl + Plus/Minus
      if ((e.metaKey || e.ctrlKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        setZoomLevel((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP));
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '-') {
        e.preventDefault();
        setZoomLevel((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP));
        return;
      }
      // Reset zoom with Cmd/Ctrl + 0
      if ((e.metaKey || e.ctrlKey) && e.key === '0') {
        e.preventDefault();
        setZoomLevel(1);
        return;
      }

      if ((e.key === 'c' || e.key === 'C') && !e.ctrlKey && !e.metaKey) {
        if (selectedElementId && !cropModeElementId) {
          e.preventDefault();
          enterCropMode(selectedElementId);
          return;
        }
      }

      if (!selectedElementId) return;

      const element = elements.find((el) => el.id === selectedElementId);
      if (!element || element.locked) return;

      const nudgeAmount = e.shiftKey ? 10 : 1;

      switch (e.key) {
        case 'Backspace':
        case 'Delete':
          e.preventDefault();
          removeElement(selectedElementId);
          break;
        case 'ArrowUp':
          e.preventDefault();
          updateElement(selectedElementId, { y: element.y - nudgeAmount });
          break;
        case 'ArrowDown':
          e.preventDefault();
          updateElement(selectedElementId, { y: element.y + nudgeAmount });
          break;
        case 'ArrowLeft':
          e.preventDefault();
          updateElement(selectedElementId, { x: element.x - nudgeAmount });
          break;
        case 'ArrowRight':
          e.preventDefault();
          updateElement(selectedElementId, { x: element.x + nudgeAmount });
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedElementId, elements, removeElement, updateElement, selectElement, cropModeElementId, enterCropMode, exitCropMode]);

  useEffect(() => {
    if (!cropModeElementId) {
      setCropAspectRatio(null);
    }
  }, [cropModeElementId]);

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
  }, [zoomLevel, numSlides, canvasSize.width, canvasSize.height]);

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

  // Handle drop of media onto canvas via window mouseup (always attached, reads from refs)
  useEffect(() => {
    const handleMouseUp = (e: MouseEvent) => {
      const state = dropStateRef.current;

      // Only handle if we're dragging
      if (!state.draggingMediaId) return;

      if (!state.project || !stageContainerRef.current) {
        setDraggingMedia(null);
        setDragMousePosition(null);
        return;
      }

      // Check if mouse is over a panel or other drop-cancel zone
      // If so, cancel the drop instead of placing the image
      const elementUnderMouse = document.elementFromPoint(e.clientX, e.clientY);
      if (elementUnderMouse) {
        const isOverPanel = elementUnderMouse.closest('[data-panel]') !== null;
        if (isOverPanel) {
          // Dropped over a panel - cancel the drop
          setDraggingMedia(null);
          setDragMousePosition(null);
          return;
        }
      }

      const media = state.project.mediaPool.find((m) => m.id === state.draggingMediaId);
      if (!media) {
        setDraggingMedia(null);
        setDragMousePosition(null);
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
        // Dropped outside canvas - just cancel
        setDraggingMedia(null);
        setDragMousePosition(null);
        return;
      }

      // Convert to design coordinates (global across all slides)
      // Account for zoom level in coordinate conversion
      const dropX = dropScreenX / (state.scale * state.zoomLevel);
      const dropY = dropScreenY / (state.scale * state.zoomLevel);

      // Check if dropping on a placeholder frame
      const placeholderFrame = state.elements.find((el) => {
        if (el.type !== 'placeholder') return false;
        // Check if drop point is inside the element's bounds
        // Account for rotation by using simple bounding box for now
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
          // Image is wider than frame - crop horizontally
          cropWidth = frameRatio / mediaRatio;
          cropX = (1 - cropWidth) / 2; // Center horizontally
        } else if (mediaRatio < frameRatio) {
          // Image is taller than frame - crop vertically
          cropHeight = mediaRatio / frameRatio;
          cropY = (1 - cropHeight) / 2; // Center vertically
        }

        // Clear drag state
        setDraggingMedia(null);
        setDragMousePosition(null);
        clearMediaSelection();

        // Update the placeholder to become a photo element
        updateElement(placeholderFrame.id, {
          type: 'photo',
          mediaId: media.id,
          cropX,
          cropY,
          cropWidth,
          cropHeight,
        });

        // Update current slide based on frame position
        const slideIndex = Math.floor((placeholderFrame.x + placeholderFrame.width / 2) / state.designSize.width);
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

      // Clear drag state
      setDraggingMedia(null);
      setDragMousePosition(null);
      clearMediaSelection();

      // Add element
      addElement(newElement);

      // Update current slide based on drop position
      const slideIndex = Math.floor(dropX / state.designSize.width);
      if (slideIndex >= 0 && slideIndex < state.numSlides) {
        setCurrentSlide(slideIndex);
      }
    };

    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, [setDraggingMedia, setDragMousePosition, clearMediaSelection, addElement, updateElement, setCurrentSlide]);

  // Handle stage click - deselect if clicking empty space
  const handleStageClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.target === e.target.getStage()) {
      selectElement(null);
      // Update current slide based on click position
      const stage = stageRef.current;
      if (stage) {
        const pointerPos = stage.getPointerPosition();
        if (pointerPos) {
          const designX = pointerPos.x / (scale * zoomLevel);
          const slideIndex = Math.floor(designX / designSize.width);
          if (slideIndex >= 0 && slideIndex < numSlides) {
            setCurrentSlide(slideIndex);
          }
        }
      }
    }
  };

  const handleElementClick = (elementId: string, e: Konva.KonvaEventObject<MouseEvent>) => {
    e.cancelBubble = true;
    selectElement(elementId);

    // Update current slide based on element position
    const element = elements.find((el) => el.id === elementId);
    if (element) {
      const elementCenterX = element.x + element.width / 2;
      const slideIndex = Math.floor(elementCenterX / designSize.width);
      if (slideIndex >= 0 && slideIndex < numSlides) {
        setCurrentSlide(slideIndex);
      }
    }
  };

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

  // Global mouse move handler for auto-scroll when cursor leaves window
  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current || !scrollContainerRef.current) return;

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
  }, [zoomLevel, canvasSize.width, startAutoScroll, stopAutoScroll]);

  // Handle drag with snapping
  const handleDragMove = useCallback(
    (elementId: string, e: Konva.KonvaEventObject<DragEvent>) => {
      const node = e.target;
      const element = elements.find((el) => el.id === elementId);
      if (!element) return;

      let newX = node.x();
      let newY = node.y();

      // Apply snapping (snap to slide boundaries and other elements)
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
        setActiveGuides(snapResult.guides);
      }

      // Clamp to bounds
      const clamped = clampToVisibleBounds(newX, newY, element.width, element.height);
      node.x(clamped.x);
      node.y(clamped.y);

      // Update last mouse position for auto-scroll
      lastMouseXRef.current = e.evt.clientX;
      
      // Trigger auto-scroll update (the global mousemove handler will handle it)
      // But we also check here in case the event hasn't fired yet
      if (scrollContainerRef.current) {
        const scrollContainer = scrollContainerRef.current;
        const scrollRect = scrollContainer.getBoundingClientRect();
        const mouseX = e.evt.clientX;

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
      }
    },
    [elements, snapEnabled, snapSettings, totalDesignWidth, designSize.width, designSize.height, numSlides, setActiveGuides, clampToVisibleBounds, scale, zoomLevel, canvasSize.width, startAutoScroll, stopAutoScroll]
  );

  // Handle drag start
  const handleDragStart = useCallback(() => {
    isDraggingRef.current = true;
    lastMouseXRef.current = null;
  }, []);

  // Handle drag end
  const handleDragEnd = useCallback(
    (elementId: string, e: Konva.KonvaEventObject<DragEvent>) => {
      const node = e.target;
      const element = elements.find((el) => el.id === elementId);
      if (!element) return;

      // Stop auto-scroll and reset drag state
      stopAutoScroll();
      isDraggingRef.current = false;
      lastMouseXRef.current = null;

      const newX = node.x();
      const newY = node.y();

      setActiveGuides([]);
      const clamped = clampToVisibleBounds(newX, newY, element.width, element.height);
      updateElement(elementId, { x: clamped.x, y: clamped.y });

      // Update current slide based on where element was dropped
      const elementCenterX = clamped.x + element.width / 2;
      const slideIndex = Math.floor(elementCenterX / designSize.width);
      if (slideIndex >= 0 && slideIndex < numSlides) {
        setCurrentSlide(slideIndex);
      }
    },
    [elements, updateElement, setActiveGuides, clampToVisibleBounds, designSize.width, numSlides, setCurrentSlide, stopAutoScroll]
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
    if (selectedElementId) {
      setContextMenu({
        isOpen: true,
        position: { x: e.clientX, y: e.clientY },
        elementId: selectedElementId,
      });
    }
  }, [selectedElementId]);

  // Canvas context menu for empty space right-clicks
  const handleStageContextMenu = useCallback((e: Konva.KonvaEventObject<PointerEvent>) => {
    // Only show menu if clicking on empty stage area
    if (e.target === e.target.getStage()) {
      e.evt.preventDefault();
      e.evt.stopPropagation(); // Prevent bubbling to wrapper div's handleContextMenu

      // Deselect any selected element first
      selectElement(null);

      const stage = e.target.getStage();
      const pointerPos = stage?.getPointerPosition();
      const designPos = pointerPos ? {
        x: pointerPos.x / (scale * zoomLevel),
        y: pointerPos.y / (scale * zoomLevel),
      } : { x: 0, y: 0 };

      // Calculate which slide was clicked
      const clickedSlideIndex = Math.floor(designPos.x / designSize.width);

      setContextMenu({
        isOpen: true,
        position: { x: e.evt.clientX, y: e.evt.clientY },
        elementId: null, // null means canvas context menu
        designPosition: designPos,
        slideIndex: clickedSlideIndex >= 0 && clickedSlideIndex < numSlides ? clickedSlideIndex : currentSlideIndex,
      });
    }
  }, [scale, selectElement, designSize.width, numSlides, currentSlideIndex]);

  const handleFlipHorizontal = () => {
    if (!contextMenu.elementId) return;
    const element = elements.find((el) => el.id === contextMenu.elementId);
    if (!element) return;
    updateElement(contextMenu.elementId, { flipX: !element.flipX });
    setContextMenu({ ...contextMenu, isOpen: false });
  };

  const handleFlipVertical = () => {
    if (!contextMenu.elementId) return;
    const element = elements.find((el) => el.id === contextMenu.elementId);
    if (!element) return;
    updateElement(contextMenu.elementId, { flipY: !element.flipY });
    setContextMenu({ ...contextMenu, isOpen: false });
  };

  const handleCenterOnCanvas = () => {
    if (!contextMenu.elementId) return;
    const element = elements.find((el) => el.id === contextMenu.elementId);
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
    const element = elements.find((el) => el.id === contextMenu.elementId);
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
    const element = elements.find((el) => el.id === contextMenu.elementId);
    if (!element) return;

    const loadedImage = loadedImages.get(element.id);
    if (!loadedImage) return;

    const originalRatio = loadedImage.naturalWidth / loadedImage.naturalHeight;
    const currentArea = element.width * element.height;
    const newHeight = Math.sqrt(currentArea / originalRatio);
    const newWidth = newHeight * originalRatio;

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
    const element = elements.find((el) => el.id === contextMenu.elementId);
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
      zIndex: Math.max(...elements.map((el) => el.zIndex), 0) + 1,
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
      zIndex: Math.max(...elements.map((el) => el.zIndex), 0) + 1,
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

  const handleAddSlide = () => {
    if (slides.length < MAX_SLIDES) {
      addSlide();
    }
  };

  // Crop handlers
  const handleCropConfirm = async (crop: {
    cropX: number;
    cropY: number;
    cropWidth: number;
    cropHeight: number;
    newWidth: number;
    newHeight: number;
  }) => {
    if (cropModeElementId) {
      const element = elements.find((el) => el.id === cropModeElementId);
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

      await updateElement(cropModeElementId, {
        cropX: crop.cropX,
        cropY: crop.cropY,
        cropWidth: crop.cropWidth,
        cropHeight: crop.cropHeight,
        x: newX,
        y: newY,
        width: crop.newWidth,
        height: crop.newHeight,
      });
    }
    // Clear original position ref since crop was confirmed (not cancelled)
    cropOriginalPositionRef.current = null;
    setCropShiftPressed(false);
    exitCropMode();
  };

  const croppingElement = cropModeElementId
    ? elements.find((el) => el.id === cropModeElementId)
    : null;

  // Capture original element position when entering crop mode
  useEffect(() => {
    if (cropModeElementId && croppingElement && !cropOriginalPositionRef.current) {
      cropOriginalPositionRef.current = {
        x: croppingElement.x,
        y: croppingElement.y,
      };
    } else if (!cropModeElementId) {
      // Only clear ref when actually exiting crop mode (not during transient state updates)
      cropOriginalPositionRef.current = null;
    }
  }, [cropModeElementId, croppingElement]);

  const handleCropCancel = () => {
    // Restore original element position if it was moved during Shift+pan
    if (cropModeElementId && cropOriginalPositionRef.current) {
      const originalPos = cropOriginalPositionRef.current;
      updateElement(cropModeElementId, {
        x: originalPos.x,
        y: originalPos.y,
      });
    }
    cropOriginalPositionRef.current = null;
    setCropShiftPressed(false);
    exitCropMode();
  };

  const handleCropElementDrag = useCallback((x: number, y: number) => {
    if (cropModeElementId) {
      updateElement(cropModeElementId, { x, y });
    }
  }, [cropModeElementId, updateElement]);

  const croppingFullBounds = croppingElement
    ? {
        width: croppingElement.width / (croppingElement.cropWidth ?? 1),
        height: croppingElement.height / (croppingElement.cropHeight ?? 1),
      }
    : null;

  const showDropZone = draggingMediaId !== null;
  const totalCanvasWidth = numSlides * canvasSize.width;

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
          {slides.map((_, index) => (
            <div
              key={index}
              className="absolute -top-5 group"
              style={{
                left: 24 + (index * canvasSize.width + canvasSize.width / 2) * zoomLevel,
                transform: 'translateX(-50%)',
              }}
            >
              <div
                className={`flex items-center gap-0.5 text-xs px-2 py-0.5 rounded transition-colors cursor-pointer ${
                  index === currentSlideIndex
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-600 text-gray-300 hover:bg-gray-500'
                }`}
                onClick={() => setCurrentSlide(index)}
              >
                <span>{index + 1}</span>
                {/* Delete button - appears on hover when there's more than 1 slide */}
                {slides.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeSlide(index);
                    }}
                    className="hidden group-hover:flex items-center justify-center w-3.5 h-3.5 -mr-1 ml-0.5 rounded-full hover:bg-black/20 transition-colors"
                    title="Delete slide"
                  >
                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          ))}

          {/* Canvas background (white slides) */}
          <div
            className={`absolute bg-white shadow-lg transition-all ${showDropZone ? 'ring-2 ring-blue-400 ring-opacity-50' : ''}`}
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
              width={totalCanvasWidth * zoomLevel}
              height={canvasSize.height * zoomLevel}
              style={{ position: 'absolute', left: 24, top: 0 }}
              onClick={handleStageClick}
              onContextMenu={handleStageContextMenu}
            >
              <Layer scaleX={scale * zoomLevel} scaleY={scale * zoomLevel}>
                {/* Render all elements sorted by zIndex */}
                {[...elements]
                  .sort((a, b) => a.zIndex - b.zIndex)
                  .map((element) => {
                    const isSelected = selectedElementId === element.id;

                    // Render placeholder/frame elements
                    if (element.type === 'placeholder') {
                      const plusSize = Math.min(element.width, element.height) * 0.3;
                      const centerX = element.width / 2;
                      const centerY = element.height / 2;

                      return (
                        <Group
                          key={element.id}
                          id={element.id}
                          x={element.x}
                          y={element.y}
                          width={element.width}
                          height={element.height}
                          rotation={element.rotation}
                          draggable={!element.locked && !cropModeElementId}
                          onClick={(e) => handleElementClick(element.id, e)}
                          onTap={(e) => handleElementClick(element.id, e as unknown as Konva.KonvaEventObject<MouseEvent>)}
                          onDragStart={handleDragStart}
                          onDragMove={(e) => handleDragMove(element.id, e)}
                          onDragEnd={(e) => handleDragEnd(element.id, e)}
                          onTransformEnd={(e) => handleTransformEnd(element.id, e)}
                        >
                          {/* Gray background */}
                          <Rect
                            width={element.width}
                            height={element.height}
                            fill="#e5e7eb"
                            stroke={isSelected ? '#3b82f6' : '#d1d5db'}
                            strokeWidth={isSelected ? 2 / zoomLevel : 1 / zoomLevel}
                            strokeScaleEnabled={false}
                            dash={isSelected ? undefined : [8, 4]}
                          />
                          {/* Plus icon - horizontal line */}
                          <Rect
                            x={centerX - plusSize / 2}
                            y={centerY - plusSize / 12}
                            width={plusSize}
                            height={plusSize / 6}
                            fill="#9ca3af"
                          />
                          {/* Plus icon - vertical line */}
                          <Rect
                            x={centerX - plusSize / 12}
                            y={centerY - plusSize / 2}
                            width={plusSize / 6}
                            height={plusSize}
                            fill="#9ca3af"
                          />
                        </Group>
                      );
                    }

                    // Render photo elements
                    if (element.type !== 'photo') return null;

                    const loadedImage = loadedImages.get(element.id);
                    if (!loadedImage) return null;

                    const isBeingCropped = cropModeElementId === element.id;

                    const flipScaleX = element.flipX ? -1 : 1;
                    const flipScaleY = element.flipY ? -1 : 1;

                    const existingCropX = element.cropX ?? 0;
                    const existingCropY = element.cropY ?? 0;
                    const existingCropW = element.cropWidth ?? 1;
                    const existingCropH = element.cropHeight ?? 1;
                    const hasCrop = existingCropX > 0 || existingCropY > 0 || existingCropW < 1 || existingCropH < 1;

                    if (isBeingCropped) {
                      const fullWidth = element.width / existingCropW;
                      const fullHeight = element.height / existingCropH;
                      const fullX = element.x - existingCropX * fullWidth;
                      const fullY = element.y - existingCropY * fullHeight;
                      const fullOffsetX = element.flipX ? fullWidth : 0;
                      const fullOffsetY = element.flipY ? fullHeight : 0;

                      return (
                        <KonvaImage
                          key={element.id}
                          id={element.id}
                          image={loadedImage}
                          x={fullX}
                          y={fullY}
                          width={fullWidth}
                          height={fullHeight}
                          rotation={element.rotation}
                          scaleX={flipScaleX}
                          scaleY={flipScaleY}
                          offsetX={fullOffsetX}
                          offsetY={fullOffsetY}
                          draggable={false}
                          listening={false}
                        />
                      );
                    }

                    const offsetX = element.flipX ? element.width : 0;
                    const offsetY = element.flipY ? element.height : 0;
                    const cropConfig = hasCrop ? {
                      x: existingCropX * loadedImage.naturalWidth,
                      y: existingCropY * loadedImage.naturalHeight,
                      width: existingCropW * loadedImage.naturalWidth,
                      height: existingCropH * loadedImage.naturalHeight,
                    } : undefined;

                    return (
                      <KonvaImage
                        key={element.id}
                        id={element.id}
                        image={loadedImage}
                        x={element.x}
                        y={element.y}
                        width={element.width}
                        height={element.height}
                        rotation={element.rotation}
                        scaleX={flipScaleX}
                        scaleY={flipScaleY}
                        offsetX={offsetX}
                        offsetY={offsetY}
                        crop={cropConfig}
                        draggable={!element.locked && !cropModeElementId}
                        onClick={(e) => handleElementClick(element.id, e)}
                        onTap={(e) => handleElementClick(element.id, e as unknown as Konva.KonvaEventObject<MouseEvent>)}
                        onDragStart={handleDragStart}
                        onDragMove={(e) => handleDragMove(element.id, e)}
                        onDragEnd={(e) => handleDragEnd(element.id, e)}
                        onTransformEnd={(e) => handleTransformEnd(element.id, e)}
                        stroke={isSelected ? '#3b82f6' : undefined}
                        strokeWidth={isSelected ? 2 / zoomLevel : 0}
                        strokeScaleEnabled={false}
                      />
                    );
                  })}

                {/* Slide separator lines (thin dark lines) */}
                {slides.slice(1).map((_, index) => {
                  const slideX = (index + 1) * designSize.width;
                  return (
                    <Line
                      key={`separator-${index}`}
                      points={[slideX, 0, slideX, designSize.height]}
                      stroke="#374151"
                      strokeWidth={2 / (scale * zoomLevel)}
                    />
                  );
                })}

                {/* Static guide visualization (always visible when enabled) */}
                {generateStaticGuides(snapSettings, designSize.height, designSize.width, numSlides).map(
                  (guide, index) => {
                    // Different colors for different guide types
                    const colors = {
                      canvas: 'rgba(147, 197, 253, 0.4)', // blue-300 with opacity
                      margin: 'rgba(252, 211, 77, 0.4)',  // amber-300 with opacity
                      grid: 'rgba(167, 139, 250, 0.35)',  // violet-400 with opacity
                    };
                    return (
                      <Line
                        key={`static-guide-${index}`}
                        points={
                          guide.orientation === 'vertical'
                            ? [guide.position, 0, guide.position, designSize.height]
                            : [0, guide.position, totalDesignWidth, guide.position]
                        }
                        stroke={colors[guide.type]}
                        strokeWidth={1 / (scale * zoomLevel)}
                      />
                    );
                  }
                )}

                {/* Active snap guides (shown during drag/resize) */}
                {activeGuides.map((guide, index) => (
                  <Line
                    key={`guide-${index}`}
                    points={
                      guide.orientation === 'vertical'
                        ? [guide.position, 0, guide.position, designSize.height]
                        : [0, guide.position, totalDesignWidth, guide.position]
                    }
                    stroke="#3b82f6"
                    strokeWidth={1 / (scale * zoomLevel)}
                    dash={[4 / (scale * zoomLevel), 4 / (scale * zoomLevel)]}
                  />
                ))}

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
      <div className="absolute bottom-4 right-4 flex items-center gap-1 bg-gray-800 rounded px-2 py-1 shadow-lg z-10">
        <button
          onClick={() => setZoomLevel((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP))}
          className="px-2 py-1 text-white hover:bg-gray-700 rounded transition-colors"
          title="Zoom out"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
          </svg>
        </button>
        <span className="text-xs text-gray-300 min-w-[3rem] text-center">
          {Math.round(zoomLevel * 100)}%
        </span>
        <button
          onClick={() => setZoomLevel((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP))}
          className="px-2 py-1 text-white hover:bg-gray-700 rounded transition-colors"
          title="Zoom in"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
        <div className="w-px h-4 bg-gray-600 mx-1" />
        <button
          onClick={() => setZoomLevel(1)}
          className="px-2 py-1 text-xs text-gray-300 hover:bg-gray-700 rounded transition-colors"
          title="Reset zoom"
        >
          Reset
        </button>
      </div>

      {/* Crop toolbar */}
      {cropModeElementId && croppingFullBounds && (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2 py-1 bg-gray-900/90 backdrop-blur-sm rounded-lg shadow-lg z-10">
          <span className="text-xs text-gray-400 mr-1">Ratio:</span>
          {[
            { label: 'Free', ratio: null },
            { label: 'Original', ratio: croppingFullBounds.width / croppingFullBounds.height },
            { label: '1:1', ratio: 1 },
            { label: '4:5', ratio: 4 / 5 },
            { label: '16:9', ratio: 16 / 9 },
          ].map((preset) => {
            const isSelected = cropAspectRatio === preset.ratio;
            return (
              <button
                key={preset.label}
                onClick={() => setCropAspectRatio(preset.ratio)}
                className={`px-1.5 py-0.5 text-xs rounded transition-colors ${
                  isSelected ? 'bg-blue-500 text-white' : 'text-gray-300 hover:bg-gray-700'
                }`}
              >
                {preset.label}
              </button>
            );
          })}
          <div className="w-px h-3 bg-gray-600 mx-1" />
          <button
            onClick={handleCropCancel}
            className="px-1.5 py-0.5 text-xs text-gray-300 hover:bg-gray-700 rounded"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              const event = new KeyboardEvent('keydown', { key: 'Enter' });
              window.dispatchEvent(event);
            }}
            className="px-1.5 py-0.5 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Apply
          </button>
        </div>
      )}

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
