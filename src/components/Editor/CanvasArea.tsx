import { useRef, useEffect, useState } from 'react';
import { Stage, Layer, Image as KonvaImage, Transformer } from 'react-konva';
import { convertFileSrc } from '@tauri-apps/api/core';
import type Konva from 'konva';
import type { AspectRatio } from '../../types';
import { useEditorStore } from '../../stores/editorStore';

interface CanvasAreaProps {
  aspectRatio: AspectRatio;
}

interface LoadedImage {
  id: string;
  image: HTMLImageElement;
}

export function CanvasArea({ aspectRatio }: CanvasAreaProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [loadedImages, setLoadedImages] = useState<LoadedImage[]>([]);

  const {
    project,
    currentSlideIndex,
    selectedElementId,
    selectElement,
    updateElement,
    removeElement,
    draggingMediaId,
  } = useEditorStore();

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

  // Handle keyboard events
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
        case 'Escape':
          selectElement(null);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedElementId, elements, removeElement, updateElement, selectElement]);


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

  // Handle element drag end
  const handleDragEnd = (elementId: string, e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target;
    updateElement(elementId, {
      x: node.x(),
      y: node.y(),
    });
  };

  // Handle transform end
  const handleTransformEnd = (elementId: string, e: Konva.KonvaEventObject<Event>) => {
    const node = e.target as Konva.Image;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();

    // Reset scale and apply to width/height
    node.scaleX(1);
    node.scaleY(1);

    updateElement(elementId, {
      x: node.x(),
      y: node.y(),
      width: Math.max(20, node.width() * scaleX),
      height: Math.max(20, node.height() * scaleY),
      rotation: node.rotation(),
    });
  };

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
            <Layer>
              {/* Render elements sorted by zIndex */}
              {[...elements]
                .sort((a, b) => a.zIndex - b.zIndex)
                .map((element) => {
                  if (element.type !== 'photo') return null;

                  const loadedImage = loadedImages.find((li) => li.id === element.id);
                  if (!loadedImage) return null;

                  const isSelected = selectedElementId === element.id;

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
                      draggable={!element.locked}
                      onClick={() => handleElementClick(element.id)}
                      onTap={() => handleElementClick(element.id)}
                      onDragEnd={(e) => handleDragEnd(element.id, e)}
                      onTransformEnd={(e) => handleTransformEnd(element.id, e)}
                      stroke={isSelected ? '#3b82f6' : undefined}
                      strokeWidth={isSelected ? 2 : 0}
                      strokeScaleEnabled={false}
                    />
                  );
                })}

              {/* Transformer for selected element */}
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
    </div>
  );
}
