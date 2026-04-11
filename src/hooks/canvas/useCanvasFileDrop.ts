import { useEffect, useState, useRef } from 'react';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { v4 as uuidv4 } from 'uuid';
import type { Element, MediaItem } from '../../types';
import { getSlideIndex } from '../../utils/slideUtils';
import { useProjectStore } from '../../stores/projectStore';
import { useSlideStore } from '../../stores/slideStore';
import { useElementStore } from '../../stores/elementStore';
import { useMediaStore } from '../../stores/mediaStore';

interface UseCanvasFileDropOptions {
  stageContainerRef: React.RefObject<HTMLDivElement>;
  numSlides: number;
  canvasSize: { width: number; height: number };
  scale: number;
  zoomLevel: number;
  designSize: { width: number; height: number };
  totalDesignWidth: number;
}

/**
 * Hook for handling file drag-drop from filesystem onto canvas
 */
export function useCanvasFileDrop({
  stageContainerRef,
  numSlides,
  canvasSize,
  scale,
  zoomLevel,
  designSize,
}: UseCanvasFileDropOptions) {
  const [isFileDragOver, setIsFileDragOver] = useState(false);
  const fileDragPositionRef = useRef<{ x: number; y: number } | null>(null);

  const project = useProjectStore((s) => s.project);
  const setCurrentSlide = useSlideStore((s) => s.setCurrentSlide);
  const addElement = useElementStore((s) => s.addElement);
  const importMedia = useMediaStore((s) => s.importMedia);

  // Refs for file drag-drop handling (to avoid Tauri event re-subscriptions)
  const fileDragDropStateRef = useRef({
    project: null as typeof project,
    numSlides: 0,
    canvasSize: { width: 0, height: 0 },
    scale: 1,
    zoomLevel: 1,
    designSize: { width: 0, height: 0 },
    importMedia: importMedia,
    addElement: addElement,
    setCurrentSlide: setCurrentSlide,
  });

  // Keep refs updated
  useEffect(() => {
    fileDragDropStateRef.current = {
      project,
      numSlides,
      canvasSize,
      scale,
      zoomLevel,
      designSize,
      importMedia,
      addElement,
      setCurrentSlide,
    };
  }, [project, numSlides, canvasSize, scale, zoomLevel, designSize, importMedia, addElement, setCurrentSlide]);

  // Handle file drop from filesystem directly onto canvas
  useEffect(() => {
    const webview = getCurrentWebviewWindow();

    const unlistenPromise = webview.onDragDropEvent(async (event) => {
      const dragEvent = event.payload;
      const state = fileDragDropStateRef.current;

      if (dragEvent.type === 'over' || dragEvent.type === 'enter') {
        setIsFileDragOver(true);
        if (dragEvent.position) {
          fileDragPositionRef.current = { x: dragEvent.position.x, y: dragEvent.position.y };
        }
      } else if (dragEvent.type === 'drop') {
        setIsFileDragOver(false);
        const paths = dragEvent.paths;

        if (paths && paths.length > 0 && state.project && stageContainerRef.current) {
          // Filter for image files
          const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif'];
          const imagePaths = paths.filter((path: string) =>
            imageExtensions.some(ext => path.toLowerCase().endsWith(ext))
          );

          if (imagePaths.length > 0) {
            // Get drop position relative to stage
            const stageRect = stageContainerRef.current.getBoundingClientRect();
            const dropX = (dragEvent.position?.x ?? 0) - stageRect.left - 24; // 24 is paddingLeft
            const dropY = (dragEvent.position?.y ?? 0) - stageRect.top;

            // Check if drop is within canvas bounds
            const totalScreenWidth = state.numSlides * state.canvasSize.width * state.zoomLevel;
            const screenHeight = state.canvasSize.height * state.zoomLevel;

            if (dropX >= 0 && dropX <= totalScreenWidth && dropY >= 0 && dropY <= screenHeight) {
              // Convert to design coordinates
              const designDropX = dropX / (state.scale * state.zoomLevel);
              const designDropY = dropY / (state.scale * state.zoomLevel);

              // Determine which slide was dropped on
              const slideIndex = getSlideIndex(designDropX, state.designSize.width);

              // Get current media pool IDs before import
              const existingMediaIds = new Set(state.project.mediaPool.map(m => m.id));

              // Import files to media pool
              await state.importMedia(imagePaths);

              // Get the updated project to find newly added media
              const updatedProject = useProjectStore.getState().project;
              if (!updatedProject) return;

              // Find the newly added media items
              const newMediaItems = updatedProject.mediaPool.filter((m: MediaItem) => !existingMediaIds.has(m.id));

              // Create elements for each new media item
              const maxZIndex = updatedProject.elements.length > 0
                ? Math.max(...updatedProject.elements.map((e: Element) => e.zIndex)) + 1
                : 0;

              for (let i = 0; i < newMediaItems.length; i++) {
                const media = newMediaItems[i];

                // Calculate element size (50% of slide width, maintaining aspect ratio)
                const targetWidth = state.designSize.width * 0.5;
                const mediaAspect = media.width / media.height;
                let elementWidth = targetWidth;
                let elementHeight = targetWidth / mediaAspect;

                // Clamp height to 50% of slide height
                if (elementHeight > state.designSize.height * 0.5) {
                  elementHeight = state.designSize.height * 0.5;
                  elementWidth = elementHeight * mediaAspect;
                }

                // Position element centered at drop point (offset each subsequent element)
                const slideLeft = slideIndex * state.designSize.width;
                const x = Math.max(slideLeft, Math.min(
                  designDropX - elementWidth / 2 + i * 20, // Offset each element slightly
                  slideLeft + state.designSize.width - elementWidth
                ));
                const y = Math.max(0, Math.min(
                  designDropY - elementHeight / 2 + i * 20,
                  state.designSize.height - elementHeight
                ));

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
                  zIndex: maxZIndex + i,
                };

                await state.addElement(newElement);
              }

              // Update current slide to where elements were dropped
              if (slideIndex >= 0 && slideIndex < state.numSlides) {
                state.setCurrentSlide(slideIndex);
              }
            }
          }
        }

        fileDragPositionRef.current = null;
      } else if (dragEvent.type === 'leave') {
        setIsFileDragOver(false);
        fileDragPositionRef.current = null;
      }
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []); // Empty deps - uses ref for all state

  return {
    isFileDragOver,
  };
}

