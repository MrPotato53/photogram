import { useRef, useEffect, useState, useCallback } from 'react';
import { Stage, Layer, Image as KonvaImage, Transformer, Line } from 'react-konva';
import { convertFileSrc } from '@tauri-apps/api/core';
import type Konva from 'konva';
import type { AspectRatio } from '../../types';
import { useEditorStore } from '../../stores/editorStore';
import { calculateSnapLines, findSnap } from '../../utils/snapping';
import { ContextMenu, ContextMenuItem } from '../common/ContextMenu';
import { CropOverlay } from './CropOverlay';

interface CanvasAreaProps {
  aspectRatio: AspectRatio;
}

interface LoadedImage {
  id: string;
  image: HTMLImageElement;
}

// Fixed design height for consistent element sizing
const DESIGN_HEIGHT = 1080;

export function CanvasArea({ aspectRatio }: CanvasAreaProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [loadedImages, setLoadedImages] = useState<LoadedImage[]>([]);

  // Design size is fixed based on aspect ratio - elements are stored in these coordinates
  const designSize = {
    width: DESIGN_HEIGHT * (aspectRatio.width / aspectRatio.height),
    height: DESIGN_HEIGHT,
  };

  // Scale factor to fit design size into actual canvas size
  const scale = canvasSize.height > 0 ? canvasSize.height / DESIGN_HEIGHT : 1;

  const {
    project,
    currentSlideIndex,
    selectedElementId,
    selectElement,
    updateElement,
    removeElement,
    draggingMediaId,
    snapEnabled,
    activeGuides,
    setActiveGuides,
    cropModeElementId,
    enterCropMode,
    exitCropMode,
  } = useEditorStore();

  // Track shift key for centered scaling
  const isShiftPressed = useRef(false);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    isOpen: boolean;
    position: { x: number; y: number };
    elementId: string | null;
  }>({ isOpen: false, position: { x: 0, y: 0 }, elementId: null });

  const currentSlide = project?.slides[currentSlideIndex];
  const elements = currentSlide?.elements || [];

  // Calculate canvas size
  useEffect(() => {
    const updateCanvasSize = () => {
      if (!containerRef.current) return;

      const container = containerRef.current;
      const containerWidth = container.clientWidth;
      const containerHeight = container.clientHeight;

      const targetRatio = aspectRatio.width / aspectRatio.height;

      const padding = 60;
      const availableWidth = containerWidth - padding * 2;
      const availableHeight = containerHeight - padding * 2;

      let width: number;
      let height: number;

      if (targetRatio > availableWidth / availableHeight) {
        width = availableWidth;
        height = width / targetRatio;
      } else {
        height = availableHeight;
        width = height * targetRatio;
      }

      setCanvasSize({ width, height });
    };

    updateCanvasSize();

    const resizeObserver = new ResizeObserver(updateCanvasSize);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => resizeObserver.disconnect();
  }, [aspectRatio]);

  // Load images for elements
  useEffect(() => {
    const loadImages = async () => {
      const newLoadedImages: LoadedImage[] = [];

      for (const element of elements) {
        if (element.type === 'photo' && element.mediaId) {
          const media = project?.mediaPool.find((m) => m.id === element.mediaId);
          if (media) {
            const existingLoaded = loadedImages.find((li) => li.id === element.id);
            if (existingLoaded) {
              newLoadedImages.push(existingLoaded);
            } else {
              const img = new window.Image();
              img.crossOrigin = 'anonymous';
              img.src = convertFileSrc(media.filePath);
              await new Promise<void>((resolve) => {
                img.onload = () => resolve();
                img.onerror = () => resolve();
              });
              newLoadedImages.push({ id: element.id, image: img });
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

    if (selectedElementId) {
      const selectedNode = stage.findOne(`#${selectedElementId}`);
      if (selectedNode) {
        transformer.nodes([selectedNode]);
        transformer.getLayer()?.batchDraw();
      }
    } else {
      transformer.nodes([]);
      transformer.getLayer()?.batchDraw();
    }
  }, [selectedElementId, loadedImages]);

  // Track shift key for centered scaling
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
      // Exit crop mode with Escape
      if (e.key === 'Escape') {
        if (cropModeElementId) {
          exitCropMode();
          return;
        }
        selectElement(null);
        return;
      }

      // Enter crop mode with 'C'
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


  // Handle stage click to deselect
  const handleStageClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.target === e.target.getStage()) {
      selectElement(null);
    }
  };

  // Handle element click to select
  const handleElementClick = (elementId: string) => {
    selectElement(elementId);
  };

  // Handle element drag move (for snapping)
  const handleDragMove = useCallback(
    (elementId: string, e: Konva.KonvaEventObject<DragEvent>) => {
      if (!snapEnabled) return;

      const node = e.target;
      const element = elements.find((el) => el.id === elementId);
      if (!element) return;

      const rect = {
        x: node.x(),
        y: node.y(),
        width: element.width,
        height: element.height,
      };

      const snapLines = calculateSnapLines(elements, elementId, designSize.width, designSize.height);
      const snapResult = findSnap(rect, snapLines);

      // Apply snapped position
      node.x(snapResult.x);
      node.y(snapResult.y);

      // Update visible guides
      setActiveGuides(snapResult.guides);
    },
    [snapEnabled, elements, designSize.width, designSize.height, setActiveGuides]
  );

  // Handle element drag end
  const handleDragEnd = (elementId: string, e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target;
    updateElement(elementId, {
      x: node.x(),
      y: node.y(),
    });
    // Clear guides on drag end
    setActiveGuides([]);
  };

  // Handle transform end
  const handleTransformEnd = (elementId: string, e: Konva.KonvaEventObject<Event>) => {
    const node = e.target as Konva.Image;
    const element = elements.find((el) => el.id === elementId);
    if (!element) return;

    const scaleX = node.scaleX();
    const scaleY = node.scaleY();

    // Preserve flip state (negative scale) when resetting
    const flipX = element.flipX ?? false;
    const flipY = element.flipY ?? false;
    node.scaleX(flipX ? -1 : 1);
    node.scaleY(flipY ? -1 : 1);

    // Calculate new dimensions using absolute scale values
    updateElement(elementId, {
      x: node.x(),
      y: node.y(),
      width: Math.max(20, node.width() * Math.abs(scaleX)),
      height: Math.max(20, node.height() * Math.abs(scaleY)),
      rotation: node.rotation(),
    });
  };

  // Context menu handlers
  const handleContextMenu = (elementId: string, e: Konva.KonvaEventObject<PointerEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;

    setContextMenu({
      isOpen: true,
      position: { x: e.evt.clientX, y: e.evt.clientY },
      elementId,
    });
  };

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
    const centerX = (designSize.width - element.width) / 2;
    const centerY = (designSize.height - element.height) / 2;
    updateElement(contextMenu.elementId, { x: centerX, y: centerY });
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

  // Handle transform start (for centered scaling with Shift)
  const handleTransformStart = () => {
    const transformer = transformerRef.current;
    if (transformer) {
      transformer.centeredScaling(isShiftPressed.current);
    }
  };

  // Handle transform (update centered scaling dynamically)
  const handleTransform = () => {
    const transformer = transformerRef.current;
    if (transformer) {
      transformer.centeredScaling(isShiftPressed.current);
    }
  };

  // Crop mode handlers
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

      // Calculate the full bounds position to determine new element position
      const existingCropX = element.cropX ?? 0;
      const existingCropY = element.cropY ?? 0;
      const existingCropW = element.cropWidth ?? 1;
      const existingCropH = element.cropHeight ?? 1;
      const fullBoundsWidth = element.width / existingCropW;
      const fullBoundsHeight = element.height / existingCropH;
      const fullBoundsX = element.x - existingCropX * fullBoundsWidth;
      const fullBoundsY = element.y - existingCropY * fullBoundsHeight;

      // New element position is where the crop selection starts within full bounds
      const newX = fullBoundsX + crop.cropX * fullBoundsWidth;
      const newY = fullBoundsY + crop.cropY * fullBoundsHeight;

      // Update crop values and element dimensions/position
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

  // Get element being cropped and calculate full bounds
  const croppingElement = cropModeElementId
    ? elements.find((el) => el.id === cropModeElementId)
    : null;

  // Full bounds = what the element would be if showing the entire source at current scale
  const croppingFullBounds = croppingElement
    ? {
        width: croppingElement.width / (croppingElement.cropWidth ?? 1),
        height: croppingElement.height / (croppingElement.cropHeight ?? 1),
      }
    : null;

  // Show drop zone when media is being dragged from the media pool
  const showDropZone = draggingMediaId !== null;

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 flex items-center justify-center overflow-hidden"
    >
      {/* Drop overlay - visual feedback only (pointer-events-none), z-index above FloatingPanel */}
      {showDropZone && (
        <div
          className="absolute inset-0 bg-blue-500/10 pointer-events-none"
          style={{ zIndex: 150 }}
        >
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-blue-500 text-center bg-white/80 px-8 py-6 rounded-lg shadow-lg">
              <svg
                className="w-12 h-12 mx-auto mb-2"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M12 4v16m8-8H4"
                />
              </svg>
              <p className="text-sm font-medium">Drop to add to canvas</p>
            </div>
          </div>
        </div>
      )}

      {/* Canvas wrapper */}
      <div
        className={`bg-white shadow-lg rounded-sm transition-all relative ${
          showDropZone ? 'ring-4 ring-blue-500 ring-opacity-50' : ''
        }`}
        style={{
          width: canvasSize.width,
          height: canvasSize.height,
        }}
      >
        {canvasSize.width > 0 && canvasSize.height > 0 && (
          <Stage
            ref={stageRef}
            width={canvasSize.width}
            height={canvasSize.height}
            onClick={handleStageClick}
          >
            <Layer scaleX={scale} scaleY={scale}>
              {/* Render elements sorted by zIndex */}
              {[...elements]
                .sort((a, b) => a.zIndex - b.zIndex)
                .map((element) => {
                  if (element.type !== 'photo') return null;

                  const loadedImage = loadedImages.find((li) => li.id === element.id);
                  if (!loadedImage) return null;

                  const isSelected = selectedElementId === element.id;
                  const isBeingCropped = cropModeElementId === element.id;

                  // Calculate flip scales and offset
                  const flipScaleX = element.flipX ? -1 : 1;
                  const flipScaleY = element.flipY ? -1 : 1;

                  // Calculate crop in source image pixels
                  const sourceImage = loadedImage.image;
                  const existingCropX = element.cropX ?? 0;
                  const existingCropY = element.cropY ?? 0;
                  const existingCropW = element.cropWidth ?? 1;
                  const existingCropH = element.cropHeight ?? 1;

                  // Check if any crop is applied (not default values)
                  const hasCrop = existingCropX > 0 || existingCropY > 0 || existingCropW < 1 || existingCropH < 1;

                  // When being cropped, show the FULL uncropped image so user can expand selection
                  if (isBeingCropped) {
                    // Calculate full bounds
                    const fullWidth = element.width / existingCropW;
                    const fullHeight = element.height / existingCropH;
                    const fullX = element.x - existingCropX * fullWidth;
                    const fullY = element.y - existingCropY * fullHeight;

                    // Flip offset for full size
                    const fullOffsetX = element.flipX ? fullWidth : 0;
                    const fullOffsetY = element.flipY ? fullHeight : 0;

                    return (
                      <KonvaImage
                        key={element.id}
                        id={element.id}
                        image={loadedImage.image}
                        x={fullX}
                        y={fullY}
                        width={fullWidth}
                        height={fullHeight}
                        rotation={element.rotation}
                        scaleX={flipScaleX}
                        scaleY={flipScaleY}
                        offsetX={fullOffsetX}
                        offsetY={fullOffsetY}
                        // No crop - show full image
                        draggable={false}
                        listening={false}
                      />
                    );
                  }

                  // Normal rendering with crop
                  const offsetX = element.flipX ? element.width : 0;
                  const offsetY = element.flipY ? element.height : 0;
                  const cropConfig = hasCrop ? {
                    x: existingCropX * sourceImage.naturalWidth,
                    y: existingCropY * sourceImage.naturalHeight,
                    width: existingCropW * sourceImage.naturalWidth,
                    height: existingCropH * sourceImage.naturalHeight,
                  } : undefined;

                  return (
                    <KonvaImage
                      key={element.id}
                      id={element.id}
                      image={loadedImage.image}
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
                      onClick={() => handleElementClick(element.id)}
                      onTap={() => handleElementClick(element.id)}
                      onDragMove={(e) => handleDragMove(element.id, e)}
                      onDragEnd={(e) => handleDragEnd(element.id, e)}
                      onTransformEnd={(e) => handleTransformEnd(element.id, e)}
                      onContextMenu={(e) => handleContextMenu(element.id, e)}
                      stroke={isSelected ? '#3b82f6' : undefined}
                      strokeWidth={isSelected ? 2 : 0}
                      strokeScaleEnabled={false}
                    />
                  );
                })}

              {/* Alignment guides */}
              {activeGuides.map((guide, index) => (
                <Line
                  key={index}
                  points={
                    guide.orientation === 'vertical'
                      ? [guide.position, 0, guide.position, designSize.height]
                      : [0, guide.position, designSize.width, guide.position]
                  }
                  stroke="#3b82f6"
                  strokeWidth={1 / scale}
                  dash={[4 / scale, 4 / scale]}
                />
              ))}

              {/* Transformer for selected element (hidden during crop mode) */}
              {!cropModeElementId && (
                <Transformer
                  ref={transformerRef}
                  boundBoxFunc={(oldBox, newBox) => {
                    // Limit minimum size
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

              {/* Crop overlay when in crop mode */}
              {croppingElement && croppingFullBounds && (
                <CropOverlay
                  element={croppingElement}
                  fullBounds={croppingFullBounds}
                  onCropConfirm={handleCropConfirm}
                  onCancel={handleCropCancel}
                />
              )}
            </Layer>
          </Stage>
        )}


        {/* Empty state */}
        {elements.length === 0 && !showDropZone && (
          <div className="absolute inset-0 flex items-center justify-center text-gray-300 pointer-events-none">
            <div className="text-center">
              <svg
                className="w-16 h-16 mx-auto mb-2 opacity-50"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={0.5}
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
              <p className="text-sm opacity-50">
                Drag media here to add to canvas
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Aspect ratio indicator */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-2 py-1 bg-black/50 text-white text-xs rounded">
        {aspectRatio.name} ({aspectRatio.width}:{aspectRatio.height})
      </div>

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
        <ContextMenuItem onClick={handleCenterOnCanvas}>
          Center on Canvas
        </ContextMenuItem>
        <ContextMenuItem onClick={handleDeleteFromMenu} danger>
          Delete
        </ContextMenuItem>
      </ContextMenu>
    </div>
  );
}
