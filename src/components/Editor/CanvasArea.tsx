import { useRef, useEffect, useState, useCallback } from 'react';
import { Stage, Layer, Image as KonvaImage, Transformer, Line } from 'react-konva';
import { convertFileSrc } from '@tauri-apps/api/core';
import type Konva from 'konva';
import type { AspectRatio, Element } from '../../types';
import { useEditorStore } from '../../stores/editorStore';
import { calculateSnapLines, findSnap } from '../../utils/snapping';
import { CropOverlay } from './CropOverlay';
import { ContextMenu, ContextMenuItem } from '../common/ContextMenu';
import { v4 as uuidv4 } from 'uuid';

interface CanvasAreaProps {
  aspectRatio: AspectRatio;
}

// Fixed design height for consistent element sizing
const DESIGN_HEIGHT = 1080;
const MAX_SLIDES = 20;

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
    addElement,
    clearMediaSelection,
    snapEnabled,
    activeGuides,
    setActiveGuides,
  } = useEditorStore();

  const slides = project?.slides || [];
  const elements = project?.elements || [];
  const numSlides = slides.length;

  // Total canvas width in design coordinates
  const totalDesignWidth = numSlides * designSize.width;

  // Track shift key for centered scaling
  const isShiftPressed = useRef(false);

  // Refs for drop handling (to avoid stale closures in always-attached listener)
  const dropStateRef = useRef({
    draggingMediaId: null as string | null,
    project: null as typeof project,
    numSlides: 0,
    canvasSize: { width: 0, height: 0 },
    scale: 1,
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
      designSize,
      totalDesignWidth,
      elements,
    };
  }, [draggingMediaId, project, numSlides, canvasSize, scale, designSize, totalDesignWidth, elements]);

  // Crop aspect ratio state
  const [cropAspectRatio, setCropAspectRatio] = useState<number | null>(null);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    isOpen: boolean;
    position: { x: number; y: number };
    elementId: string | null;
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
      if (e.key === 'Shift') isShiftPressed.current = true;
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') isShiftPressed.current = false;
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Handle keyboard events
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (e.key === 'Escape') {
        if (cropModeElementId) {
          exitCropMode();
          return;
        }
        selectElement(null);
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

  // Scroll to current slide when it changes (only if not fully visible)
  useEffect(() => {
    if (scrollContainerRef.current && canvasSize.width > 0) {
      const container = scrollContainerRef.current;
      const padding = 24; // Left/right padding on stage container

      // Calculate the slide's position in screen coordinates
      const slideLeft = padding + currentSlideIndex * canvasSize.width;
      const slideRight = slideLeft + canvasSize.width;

      // Get the visible area
      const visibleLeft = container.scrollLeft;
      const visibleRight = container.scrollLeft + container.clientWidth;

      // Check if slide is off-screen in either direction
      const isOffLeft = slideLeft < visibleLeft;
      const isOffRight = slideRight > visibleRight;

      if (isOffLeft) {
        // Slide is off to the left - align to left edge
        container.scrollTo({
          left: slideLeft - padding,
          behavior: 'smooth',
        });
      } else if (isOffRight) {
        // Slide is off to the right - align to right edge
        container.scrollTo({
          left: Math.max(0, slideRight - container.clientWidth + padding),
          behavior: 'smooth',
        });
      }
    }
  }, [currentSlideIndex, canvasSize.width]);

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
      const dropX = dropScreenX / state.scale;
      const dropY = dropScreenY / state.scale;

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
  }, [setDraggingMedia, setDragMousePosition, clearMediaSelection, addElement, setCurrentSlide]);

  // Handle stage click - deselect if clicking empty space
  const handleStageClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.target === e.target.getStage()) {
      selectElement(null);
      // Update current slide based on click position
      const stage = stageRef.current;
      if (stage) {
        const pointerPos = stage.getPointerPosition();
        if (pointerPos) {
          const designX = pointerPos.x / scale;
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
        const snapLines = calculateSnapLines(elements, elementId, totalDesignWidth, designSize.height);

        // Add per-slide snap lines (boundaries and centers)
        for (let i = 0; i < numSlides; i++) {
          const slideLeft = i * designSize.width;
          const slideCenter = slideLeft + designSize.width / 2;
          const slideRight = (i + 1) * designSize.width;

          // Slide boundaries
          snapLines.vertical.push({ position: slideLeft, type: 'edge' });
          if (i === numSlides - 1) {
            snapLines.vertical.push({ position: slideRight, type: 'edge' });
          }

          // Slide center (horizontal middle as vertical guide line)
          snapLines.vertical.push({ position: slideCenter, type: 'center' });
        }

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
    },
    [elements, snapEnabled, totalDesignWidth, designSize.width, designSize.height, numSlides, setActiveGuides, clampToVisibleBounds]
  );

  // Handle drag end
  const handleDragEnd = useCallback(
    (elementId: string, e: Konva.KonvaEventObject<DragEvent>) => {
      const node = e.target;
      const element = elements.find((el) => el.id === elementId);
      if (!element) return;

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
    [elements, updateElement, setActiveGuides, clampToVisibleBounds, designSize.width, numSlides, setCurrentSlide]
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

      updateElement(elementId, {
        x: node.x(),
        y: node.y(),
        width: newWidth,
        height: newHeight,
        rotation: node.rotation(),
      });
    },
    [updateElement]
  );

  const handleTransformStart = () => {
    const transformer = transformerRef.current;
    if (transformer) {
      transformer.centeredScaling(isShiftPressed.current);
    }
  };

  const handleTransform = () => {
    const transformer = transformerRef.current;
    if (transformer) {
      transformer.centeredScaling(isShiftPressed.current);
    }
  };

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
    exitCropMode();
  };

  const handleCropCancel = () => {
    exitCropMode();
  };

  const croppingElement = cropModeElementId
    ? elements.find((el) => el.id === cropModeElementId)
    : null;

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
  const contentFits = totalCanvasWidth + 48 < containerWidth;

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 flex flex-col overflow-hidden"
      onContextMenu={handleContextMenu}
    >
      {/* Horizontal scrolling canvas container */}
      <div
        ref={scrollContainerRef}
        className={`flex-1 overflow-x-auto overflow-y-hidden flex items-center ${contentFits ? 'justify-center' : ''}`}
        style={{ paddingTop: 30, paddingBottom: 10 }}
      >
        <div
          ref={stageContainerRef}
          className="relative"
          style={{
            width: totalCanvasWidth + 48,
            height: canvasSize.height,
            paddingLeft: 24,
            paddingRight: 24,
            flexShrink: 0,
          }}
        >
          {/* Slide number indicators */}
          {slides.map((_, index) => (
            <div
              key={index}
              className={`absolute -top-5 text-xs px-2 py-0.5 rounded transition-colors cursor-pointer ${
                index === currentSlideIndex
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-600 text-gray-300 hover:bg-gray-500'
              }`}
              style={{
                left: 24 + index * canvasSize.width + canvasSize.width / 2,
                transform: 'translateX(-50%)',
              }}
              onClick={() => setCurrentSlide(index)}
            >
              {index + 1}
            </div>
          ))}

          {/* Canvas background (white slides) */}
          <div
            className={`absolute bg-white shadow-lg transition-all ${showDropZone ? 'ring-2 ring-blue-400 ring-opacity-50' : ''}`}
            style={{
              left: 24,
              top: 0,
              width: totalCanvasWidth,
              height: canvasSize.height,
            }}
          />

          {/* Konva Stage */}
          {canvasSize.width > 0 && canvasSize.height > 0 && (
            <Stage
              ref={stageRef}
              width={totalCanvasWidth}
              height={canvasSize.height}
              style={{ position: 'absolute', left: 24, top: 0 }}
              onClick={handleStageClick}
            >
              <Layer scaleX={scale} scaleY={scale}>
                {/* Render all elements sorted by zIndex */}
                {[...elements]
                  .sort((a, b) => a.zIndex - b.zIndex)
                  .map((element) => {
                    if (element.type !== 'photo') return null;

                    const loadedImage = loadedImages.get(element.id);
                    if (!loadedImage) return null;

                    const isSelected = selectedElementId === element.id;
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
                        onDragMove={(e) => handleDragMove(element.id, e)}
                        onDragEnd={(e) => handleDragEnd(element.id, e)}
                        onTransformEnd={(e) => handleTransformEnd(element.id, e)}
                        stroke={isSelected ? '#3b82f6' : undefined}
                        strokeWidth={isSelected ? 2 : 0}
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
                      strokeWidth={2 / scale}
                    />
                  );
                })}

                {/* Alignment guides */}
                {activeGuides.map((guide, index) => (
                  <Line
                    key={`guide-${index}`}
                    points={
                      guide.orientation === 'vertical'
                        ? [guide.position, 0, guide.position, designSize.height]
                        : [0, guide.position, totalDesignWidth, guide.position]
                    }
                    stroke="#3b82f6"
                    strokeWidth={1 / scale}
                    dash={[4 / scale, 4 / scale]}
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
                  <CropOverlay
                    element={croppingElement}
                    fullBounds={croppingFullBounds}
                    aspectRatio={cropAspectRatio}
                    onCropConfirm={handleCropConfirm}
                    onCancel={handleCropCancel}
                  />
                )}
              </Layer>
            </Stage>
          )}

          {/* Add slide button - small circle */}
          {slides.length < MAX_SLIDES && (
            <button
              onClick={handleAddSlide}
              className="absolute flex items-center justify-center w-8 h-8 bg-gray-700 hover:bg-gray-600 text-white rounded-full shadow-md transition-colors"
              style={{
                left: 24 + totalCanvasWidth + 8,
                top: canvasSize.height / 2 - 16,
              }}
              title="Add slide"
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
          )}
        </div>
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

      {/* Element context menu */}
      <ContextMenu
        isOpen={contextMenu.isOpen}
        onClose={() => setContextMenu({ ...contextMenu, isOpen: false })}
        position={contextMenu.position}
      >
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
        <ContextMenuItem onClick={handleDeleteFromMenu} danger>
          Delete
        </ContextMenuItem>
      </ContextMenu>
    </div>
  );
}
