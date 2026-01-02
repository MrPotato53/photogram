import { useRef, useState, useEffect, useCallback } from 'react';
import { Stage, Layer, Image as KonvaImage, Rect } from 'react-konva';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { Element, Template } from '../../../types';
import { useEditorStore } from '../../../stores/editorStore';
import { useTemplatesStore } from '../../../stores/templatesStore';
import { ContextMenu, ContextMenuItem } from '../../common/ContextMenu';
import { TemplatePickerModal } from '../TemplatePickerModal';

const DESIGN_HEIGHT = 1080;
const THUMBNAIL_HEIGHT = 80;
const MAX_SLIDES = 20;

interface SlidePreviewProps {
  slideIndex: number;
  elements: Element[];
  designSize: { width: number; height: number };
  isSelected: boolean;
  isDragging: boolean;
  dropIndicator: 'left' | 'right' | null;
  showDeleteButton: boolean;
  onClick: () => void;
  onMouseDown: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDelete: () => void;
  canDelete: boolean;
  renderVersion: number;
}

function SlidePreview({
  slideIndex,
  elements,
  designSize,
  isSelected,
  isDragging,
  dropIndicator,
  showDeleteButton,
  onClick,
  onMouseDown,
  onContextMenu,
  onDelete,
  canDelete,
  renderVersion,
}: SlidePreviewProps) {
  const [loadedImages, setLoadedImages] = useState<Map<string, HTMLImageElement>>(new Map());
  const { project } = useEditorStore();

  const thumbnailWidth = (THUMBNAIL_HEIGHT * designSize.width) / designSize.height;
  const scale = THUMBNAIL_HEIGHT / DESIGN_HEIGHT;

  // Filter elements that are visible on this slide
  const slideElements = elements.filter((element) => {
    const elementLeft = element.x;
    const elementRight = element.x + element.width;
    const slideLeft = slideIndex * designSize.width;
    const slideRight = (slideIndex + 1) * designSize.width;
    return elementRight > slideLeft && elementLeft < slideRight;
  });

  // Load images for elements on this slide
  useEffect(() => {
    const loadImages = async () => {
      const newLoadedImages = new Map<string, HTMLImageElement>();

      for (const element of slideElements) {
        if (element.type === 'photo' && element.mediaId) {
          let imagePath: string | null = null;

          if (element.assetPath) {
            imagePath = element.assetPath;
          } else {
            const media = project?.mediaPool.find((m) => m.id === element.mediaId);
            if (media) {
              imagePath = media.thumbnailPath || media.filePath;
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
  }, [slideElements.map(e => e.id + e.x + e.y + e.width + e.height).join(','), project?.mediaPool, renderVersion]);

  const slideOffsetX = slideIndex * designSize.width;

  return (
    <div
      className="relative flex-shrink-0 cursor-grab active:cursor-grabbing"
      style={{ width: thumbnailWidth, height: THUMBNAIL_HEIGHT }}
      data-slide-index={slideIndex}
      onMouseDown={onMouseDown}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      {/* Drop indicator - left */}
      {dropIndicator === 'left' && (
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-500 -translate-x-2 z-20 rounded" />
      )}
      {/* Drop indicator - right */}
      {dropIndicator === 'right' && (
        <div className="absolute right-0 top-0 bottom-0 w-1 bg-blue-500 translate-x-2 z-20 rounded" />
      )}
      {/* Slide content */}
      <div
        className={`w-full h-full rounded overflow-hidden transition-all pointer-events-none ${
          isSelected ? 'ring-2 ring-blue-500' : 'ring-1 ring-gray-600 hover:ring-gray-500'
        } ${isDragging ? 'opacity-50' : ''}`}
      >
        <Stage width={thumbnailWidth} height={THUMBNAIL_HEIGHT}>
        <Layer>
          {/* White background */}
          <Rect x={0} y={0} width={thumbnailWidth} height={THUMBNAIL_HEIGHT} fill="white" />

          {/* Render elements scaled and offset for this slide */}
          {slideElements
            .sort((a, b) => a.zIndex - b.zIndex)
            .map((element) => {
              const loadedImage = loadedImages.get(element.id);
              if (!loadedImage) return null;

              const flipScaleX = element.flipX ? -1 : 1;
              const flipScaleY = element.flipY ? -1 : 1;

              const existingCropX = element.cropX ?? 0;
              const existingCropY = element.cropY ?? 0;
              const existingCropW = element.cropWidth ?? 1;
              const existingCropH = element.cropHeight ?? 1;
              const hasCrop = existingCropX > 0 || existingCropY > 0 || existingCropW < 1 || existingCropH < 1;

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
                  image={loadedImage}
                  x={(element.x - slideOffsetX) * scale}
                  y={element.y * scale}
                  width={element.width * scale}
                  height={element.height * scale}
                  rotation={element.rotation}
                  scaleX={flipScaleX}
                  scaleY={flipScaleY}
                  offsetX={offsetX * scale}
                  offsetY={offsetY * scale}
                  crop={cropConfig}
                />
              );
            })}
        </Layer>
        </Stage>

        {/* Slide number badge */}
        <div className="absolute bottom-1 left-1 px-1 py-0.5 text-[10px] bg-black/60 text-white rounded">
          {slideIndex + 1}
        </div>
      </div>
      {/* Delete button - only shown on right-click */}
      {canDelete && showDeleteButton && (
        <button
          className="absolute top-1 right-1 w-4 h-4 flex items-center justify-center bg-red-500/80 hover:bg-red-500 text-white rounded-full transition-opacity z-20 pointer-events-auto"
          onMouseDown={(e) => {
            // Prevent drag from starting
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Delete slide"
        >
          <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}

export function SlidesPanel() {
  const {
    project,
    currentSlideIndex,
    setCurrentSlide,
    addSlide,
    addSlideWithTemplate,
    removeSlide,
    reorderSlides,
    togglePanel,
    panels,
  } = useEditorStore();

  const { templates, saveSlideAsTemplate } = useTemplatesStore();

  // Template picker modal state
  const [isTemplatePickerOpen, setIsTemplatePickerOpen] = useState(false);

  const handleSelectTemplate = useCallback((template: Template) => {
    addSlideWithTemplate(template);
    setIsTemplatePickerOpen(false);
  }, [addSlideWithTemplate]);

  const containerRef = useRef<HTMLDivElement>(null);
  const slidesContainerRef = useRef<HTMLDivElement>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
  const [dropSide, setDropSide] = useState<'left' | 'right' | null>(null);
  const [renderVersion, setRenderVersion] = useState(0);
  const [shouldCenter, setShouldCenter] = useState(true);
  const [contextMenuSlideIndex, setContextMenuSlideIndex] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    isOpen: boolean;
    position: { x: number; y: number };
    slideIndex: number;
  }>({ isOpen: false, position: { x: 0, y: 0 }, slideIndex: 0 });
  const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null);
  const [hasFocus, setHasFocus] = useState(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Drag state refs
  const isDraggingRef = useRef(false);
  const dragStartPos = useRef<{ x: number; y: number } | null>(null);
  const pendingDragIndex = useRef<number | null>(null);
  const DRAG_THRESHOLD = 5; // pixels before drag starts

  const slides = project?.slides || [];
  const elements = project?.elements || [];

  const designSize = project ? {
    width: DESIGN_HEIGHT * (project.aspectRatio.width / project.aspectRatio.height),
    height: DESIGN_HEIGHT,
  } : { width: 1920, height: 1080 };

  const thumbnailWidth = (THUMBNAIL_HEIGHT * designSize.width) / designSize.height;

  // Check if content should be centered
  useEffect(() => {
    const checkCentering = () => {
      if (containerRef.current && slidesContainerRef.current) {
        const containerWidth = containerRef.current.clientWidth;
        const slidesWidth = slidesContainerRef.current.scrollWidth;
        setShouldCenter(slidesWidth <= containerWidth);
      }
    };

    checkCentering();
    const resizeObserver = new ResizeObserver(checkCentering);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }
    return () => resizeObserver.disconnect();
  }, [slides.length, thumbnailWidth]);

  // Debounced re-render when elements change
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      setRenderVersion((v) => v + 1);
    }, 3000);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [elements]);

  // Calculate drop target based on mouse position
  const calculateDropTarget = useCallback((clientX: number): { index: number; side: 'left' | 'right' } | null => {
    if (!slidesContainerRef.current) return null;

    const slideElements = slidesContainerRef.current.querySelectorAll('[data-slide-index]');
    for (const el of slideElements) {
      const rect = el.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right) {
        const index = parseInt(el.getAttribute('data-slide-index') || '0', 10);
        const midpoint = rect.left + rect.width / 2;
        const side = clientX < midpoint ? 'left' : 'right';
        return { index, side };
      }
    }
    return null;
  }, []);

  // Handle mouse move during drag (with threshold)
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      // Check if we have a pending drag that hasn't started yet
      if (pendingDragIndex.current !== null && dragStartPos.current && !isDraggingRef.current) {
        const dx = e.clientX - dragStartPos.current.x;
        const dy = e.clientY - dragStartPos.current.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // Only start actual drag after threshold
        if (distance >= DRAG_THRESHOLD) {
          isDraggingRef.current = true;
          setDraggedIndex(pendingDragIndex.current);
          setDragPosition({ x: e.clientX, y: e.clientY });
          document.body.style.cursor = 'grabbing';
        }
        return;
      }

      // Already dragging
      if (!isDraggingRef.current || draggedIndex === null) return;

      // Update drag position for preview
      setDragPosition({ x: e.clientX, y: e.clientY });

      const target = calculateDropTarget(e.clientX);
      if (target && target.index !== draggedIndex) {
        setDropTargetIndex(target.index);
        setDropSide(target.side);
      } else {
        setDropTargetIndex(null);
        setDropSide(null);
      }
    };

    const handleMouseUp = () => {
      // If we had a pending drag that never started, it was just a click
      if (pendingDragIndex.current !== null && !isDraggingRef.current) {
        // Just a click, not a drag - reset pending state
        pendingDragIndex.current = null;
        dragStartPos.current = null;
        return;
      }

      if (!isDraggingRef.current) return;

      // Execute reorder if we have a valid drop target
      if (dropTargetIndex !== null && dropSide !== null && draggedIndex !== null) {
        let targetPosition = dropTargetIndex;
        if (dropSide === 'right') {
          targetPosition = dropTargetIndex + 1;
        }
        if (draggedIndex < targetPosition) {
          targetPosition -= 1;
        }

        if (draggedIndex !== targetPosition) {
          reorderSlides(draggedIndex, targetPosition);
        }
      }

      // Reset state
      isDraggingRef.current = false;
      pendingDragIndex.current = null;
      dragStartPos.current = null;
      setDraggedIndex(null);
      setDropTargetIndex(null);
      setDropSide(null);
      setDragPosition(null);
      document.body.style.cursor = '';
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggedIndex, dropTargetIndex, dropSide, calculateDropTarget, reorderSlides, DRAG_THRESHOLD]);

  // Handle Delete key to remove selected slide (only when panel has focus)
  useEffect(() => {
    if (!hasFocus) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && slides.length > 1) {
        // Don't delete if user is typing in an input
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

        e.preventDefault();
        removeSlide(currentSlideIndex);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hasFocus, currentSlideIndex, slides.length, removeSlide]);

  // Handle focus/blur for the panel
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setHasFocus(false);
      }
    };

    window.addEventListener('mousedown', handleClickOutside);
    return () => window.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Handle click outside to hide delete button
  useEffect(() => {
    if (contextMenuSlideIndex === null) return;

    const handleClickOutside = () => {
      setContextMenuSlideIndex(null);
    };

    // Delay to allow the delete button click to register
    const timer = setTimeout(() => {
      window.addEventListener('click', handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('click', handleClickOutside);
    };
  }, [contextMenuSlideIndex]);

  const handleMouseDown = useCallback((e: React.MouseEvent, index: number) => {
    // Only handle left mouse button
    if (e.button !== 0) return;

    // Set focus to this panel
    setHasFocus(true);

    // Hide context menu
    setContextMenuSlideIndex(null);

    // Store pending drag info - actual drag starts after threshold
    pendingDragIndex.current = index;
    dragStartPos.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent, index: number) => {
    e.preventDefault();
    // Set focus, select the slide and show context menu
    setHasFocus(true);
    setCurrentSlide(index);
    setContextMenuSlideIndex(index);
    setContextMenu({
      isOpen: true,
      position: { x: e.clientX, y: e.clientY },
      slideIndex: index,
    });
  }, [setCurrentSlide]);

  const handleAddSlide = useCallback(() => {
    if (slides.length < MAX_SLIDES) {
      addSlide();
    }
  }, [slides.length, addSlide]);

  const handleDeleteSlide = useCallback((index: number) => {
    if (slides.length > 1) {
      removeSlide(index);
    }
  }, [slides.length, removeSlide]);

  const handleSaveAsTemplate = useCallback(() => {
    if (!project) return;
    const templateName = `Template ${templates.length + 1}`;
    saveSlideAsTemplate(
      contextMenu.slideIndex,
      templateName,
      project.aspectRatio,
      elements,
      designSize.width
    );
    setContextMenu({ ...contextMenu, isOpen: false });
  }, [contextMenu, saveSlideAsTemplate, templates.length, project, elements, designSize.width]);

  const handleDeleteFromContextMenu = useCallback(() => {
    if (slides.length > 1) {
      removeSlide(contextMenu.slideIndex);
    }
    setContextMenu({ ...contextMenu, isOpen: false });
  }, [contextMenu, slides.length, removeSlide]);

  // Get drop indicator for a specific slide
  const getDropIndicator = (index: number): 'left' | 'right' | null => {
    if (dropTargetIndex !== index || draggedIndex === null) return null;
    if (draggedIndex === index) return null;
    return dropSide;
  };

  if (!project) return null;

  // Collapsed state - show a small strip at the bottom
  if (!panels.slides.isOpen) {
    return (
      <div className="flex-shrink-0 bg-theme-bg-secondary border-t border-theme-border">
        <button
          onClick={() => togglePanel('slides')}
          className="w-full py-1 text-xs text-theme-text-muted hover:text-theme-text hover:bg-theme-bg-tertiary transition-colors flex items-center justify-center gap-1"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
          </svg>
          Slides
        </button>
      </div>
    );
  }

  const addButtons = slides.length < MAX_SLIDES && (
    <div className="flex-shrink-0 flex flex-col items-center gap-1">
      {/* Add empty slide button */}
      <button
        onClick={handleAddSlide}
        className="flex items-center justify-center w-8 h-8 bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors"
        title="Add empty slide"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
      </button>
      {/* Add slide with template button */}
      <button
        onClick={() => setIsTemplatePickerOpen(true)}
        className="flex items-center justify-center w-8 h-8 bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors"
        title="Add slide with template"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z"
          />
        </svg>
      </button>
    </div>
  );

  return (
    <div
      ref={containerRef}
      data-panel="slides"
      className="h-full bg-theme-bg-secondary border-t border-theme-border flex items-center px-3 gap-2 relative"
    >
      {/* Collapse button - top right */}
      <button
        onClick={() => togglePanel('slides')}
        className="absolute top-1 right-1 flex items-center justify-center w-5 h-5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors z-10"
        title="Collapse slides panel"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {/* Slides list */}
      <div
        ref={slidesContainerRef}
        className={`flex-1 flex items-center gap-2 overflow-x-auto py-2 ${shouldCenter ? 'justify-center' : ''}`}
      >
        {slides.map((_, index) => (
          <SlidePreview
            key={index}
            slideIndex={index}
            elements={elements}
            designSize={designSize}
            isSelected={index === currentSlideIndex}
            isDragging={draggedIndex === index}
            dropIndicator={getDropIndicator(index)}
            showDeleteButton={contextMenuSlideIndex === index}
            onClick={() => setCurrentSlide(index)}
            onMouseDown={(e) => handleMouseDown(e, index)}
            onContextMenu={(e) => handleContextMenu(e, index)}
            onDelete={() => handleDeleteSlide(index)}
            canDelete={slides.length > 1}
            renderVersion={renderVersion}
          />
        ))}
        {/* Add buttons inline when centered (not overflowing) */}
        {shouldCenter && addButtons}
      </div>

      {/* Add buttons fixed on right when overflowing */}
      {!shouldCenter && addButtons}

      {/* Drag preview - follows cursor */}
      {draggedIndex !== null && dragPosition && (
        <div
          className="fixed pointer-events-none z-50"
          style={{
            left: dragPosition.x - thumbnailWidth / 2,
            top: dragPosition.y - THUMBNAIL_HEIGHT / 2,
          }}
        >
          <div
            className="rounded overflow-hidden ring-2 ring-blue-500 shadow-lg opacity-80"
            style={{ width: thumbnailWidth, height: THUMBNAIL_HEIGHT }}
          >
            <div className="w-full h-full bg-gray-800 flex items-center justify-center">
              <span className="text-white text-sm font-medium">{draggedIndex + 1}</span>
            </div>
          </div>
        </div>
      )}

      {/* Slide context menu */}
      <ContextMenu
        isOpen={contextMenu.isOpen}
        onClose={() => setContextMenu({ ...contextMenu, isOpen: false })}
        position={contextMenu.position}
      >
        <ContextMenuItem onClick={handleSaveAsTemplate}>
          Save as Template
        </ContextMenuItem>
        {slides.length > 1 && (
          <ContextMenuItem onClick={handleDeleteFromContextMenu} danger>
            Delete Slide
          </ContextMenuItem>
        )}
      </ContextMenu>

      {/* Template picker modal */}
      {project && (
        <TemplatePickerModal
          isOpen={isTemplatePickerOpen}
          onClose={() => setIsTemplatePickerOpen(false)}
          onSelect={handleSelectTemplate}
          aspectRatio={project.aspectRatio}
        />
      )}
    </div>
  );
}
