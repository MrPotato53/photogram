import { useEffect, useRef } from 'react';
import { useEditorStore } from '../../stores/editorStore';
import { EditorToolbar } from './EditorToolbar';
import { CanvasArea } from './CanvasArea';
import { FloatingPanel } from './FloatingPanel';
import { MediaPoolPanel } from './panels/MediaPoolPanel';
import { LayersPanel } from './panels/LayersPanel';
import { TemplatesPanel } from './panels/TemplatesPanel';
import { DragPreview } from './DragPreview';
import type { Element } from '../../types';
import { v4 as uuidv4 } from 'uuid';

interface EditorLayoutProps {
  projectId: string;
}

export function EditorLayout({ projectId }: EditorLayoutProps) {
  const {
    project,
    isLoading,
    error,
    panels,
    loadProject,
    draggingMediaId,
    setDraggingMedia,
    dragPosition,
    setDragPosition,
    addElement,
    currentSlideIndex,
  } = useEditorStore();

  const containerRef = useRef<HTMLDivElement>(null);
  const lastDragPositionRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    loadProject(projectId);
  }, [projectId, loadProject]);

  // Change cursor during drag
  useEffect(() => {
    if (draggingMediaId) {
      document.body.style.cursor = 'grabbing';
    } else {
      document.body.style.cursor = '';
    }

    return () => {
      document.body.style.cursor = '';
    };
  }, [draggingMediaId]);

  // Handle drop when mouse is released (dragPosition is set on mouseup)
  useEffect(() => {
    // Only process if we have a media being dragged and a new position
    if (!draggingMediaId || !dragPosition || !project || !containerRef.current) {
      return;
    }

    // Avoid processing the same position twice
    if (
      lastDragPositionRef.current &&
      lastDragPositionRef.current.x === dragPosition.x &&
      lastDragPositionRef.current.y === dragPosition.y
    ) {
      return;
    }

    lastDragPositionRef.current = dragPosition;

    const media = project.mediaPool.find((m) => m.id === draggingMediaId);
    if (!media) {
      setDraggingMedia(null);
      setDragPosition(null);
      return;
    }

    // Get canvas dimensions
    const aspectRatio = project.aspectRatio;
    const containerRect = containerRef.current.getBoundingClientRect();

    const padding = 60;
    const availableWidth = containerRect.width - padding * 2;
    const availableHeight = containerRect.height - padding * 2;
    const targetRatio = aspectRatio.width / aspectRatio.height;

    let canvasWidth: number;
    let canvasHeight: number;

    if (targetRatio > availableWidth / availableHeight) {
      canvasWidth = availableWidth;
      canvasHeight = canvasWidth / targetRatio;
    } else {
      canvasHeight = availableHeight;
      canvasWidth = canvasHeight * targetRatio;
    }

    // Calculate canvas position (centered in container)
    const canvasLeft = containerRect.left + (containerRect.width - canvasWidth) / 2;
    const canvasTop = containerRect.top + (containerRect.height - canvasHeight) / 2;

    // Get drop position relative to canvas
    const dropX = dragPosition.x - canvasLeft;
    const dropY = dragPosition.y - canvasTop;

    // Check if drop is within canvas bounds
    if (dropX < 0 || dropX > canvasWidth || dropY < 0 || dropY > canvasHeight) {
      // Dropped outside canvas - cancel
      setDraggingMedia(null);
      setDragPosition(null);
      lastDragPositionRef.current = null;
      return;
    }

    // Calculate element size
    const mediaRatio = media.width / media.height;
    let elementWidth = Math.min(canvasWidth * 0.5, media.width);
    let elementHeight = elementWidth / mediaRatio;

    if (elementHeight > canvasHeight * 0.5) {
      elementHeight = canvasHeight * 0.5;
      elementWidth = elementHeight * mediaRatio;
    }

    // Center on drop position, clamp to canvas bounds
    const x = Math.max(0, Math.min(dropX - elementWidth / 2, canvasWidth - elementWidth));
    const y = Math.max(0, Math.min(dropY - elementHeight / 2, canvasHeight - elementHeight));

    const currentSlide = project.slides[currentSlideIndex];
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
      zIndex: currentSlide?.elements.length || 0,
    };

    // Clear drag state
    setDraggingMedia(null);
    setDragPosition(null);
    lastDragPositionRef.current = null;

    // Add the element
    addElement(newElement);
  }, [dragPosition, draggingMediaId, project, currentSlideIndex, addElement, setDraggingMedia, setDragPosition]);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center bg-theme-bg">
        <div className="text-theme-text-muted">Loading project...</div>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="h-full flex items-center justify-center bg-theme-bg">
        <div className="text-red-500">Failed to load project: {error}</div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-theme-bg-tertiary select-none">
      <EditorToolbar projectName={project.name} />

      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden"
      >
        <CanvasArea aspectRatio={project.aspectRatio} />

        {/* Floating Panels */}
        {panels.mediaPool.isOpen && (
          <FloatingPanel
            title="Media Pool"
            panelId="mediaPool"
            defaultPosition={{ x: 20, y: 20 }}
            minWidth={200}
            minHeight={150}
          >
            <MediaPoolPanel />
          </FloatingPanel>
        )}

        {panels.layers.isOpen && (
          <FloatingPanel
            title="Layers"
            panelId="layers"
            defaultPosition={{ x: window.innerWidth - 290, y: 20 }}
            minWidth={180}
            minHeight={200}
          >
            <LayersPanel />
          </FloatingPanel>
        )}

        {panels.templates.isOpen && (
          <FloatingPanel
            title="Templates"
            panelId="templates"
            defaultPosition={{ x: 20, y: 250 }}
            minWidth={200}
            minHeight={200}
          >
            <TemplatesPanel />
          </FloatingPanel>
        )}
      </div>

      {/* Drag preview that follows cursor */}
      <DragPreview />
    </div>
  );
}
