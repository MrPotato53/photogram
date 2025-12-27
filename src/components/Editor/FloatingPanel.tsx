import { useState, useRef, useCallback, useEffect, type ReactNode } from 'react';
import clsx from 'clsx';
import { useEditorStore, type PanelId } from '../../stores/editorStore';

interface FloatingPanelProps {
  title: string;
  panelId: PanelId;
  children: ReactNode;
  defaultPosition: { x: number; y: number };
  minWidth?: number;
  minHeight?: number;
}

export function FloatingPanel({
  title,
  panelId,
  children,
  defaultPosition,
  minWidth = 200,
  minHeight = 150,
}: FloatingPanelProps) {
  const { panels, setPanelSize, closePanel, draggingMediaId } = useEditorStore();
  const panelState = panels[panelId];

  // Allow drop events to bubble up to EditorLayout when media is being dragged
  const handleDragOver = (e: React.DragEvent) => {
    if (draggingMediaId || e.dataTransfer.types.includes('application/photogram-media')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  const [position, setPosition] = useState(defaultPosition);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeDirection, setResizeDirection] = useState<string | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef({ x: 0, y: 0, posX: 0, posY: 0 });
  const resizeStartRef = useRef({ x: 0, y: 0, width: 0, height: 0 });

  // Dragging handlers
  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest('.panel-controls')) return;
      e.preventDefault();
      setIsDragging(true);
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        posX: position.x,
        posY: position.y,
      };
    },
    [position]
  );

  const handleDrag = useCallback(
    (e: MouseEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      setPosition({
        x: Math.max(0, dragStartRef.current.posX + dx),
        y: Math.max(0, dragStartRef.current.posY + dy),
      });
    },
    [isDragging]
  );

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Resize handlers
  const handleResizeStart = useCallback(
    (e: React.MouseEvent, direction: string) => {
      e.preventDefault();
      e.stopPropagation();
      setIsResizing(true);
      setResizeDirection(direction);
      resizeStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        width: panelState.width,
        height: panelState.height,
      };
    },
    [panelState.width, panelState.height]
  );

  const handleResize = useCallback(
    (e: MouseEvent) => {
      if (!isResizing || !resizeDirection) return;

      const dx = e.clientX - resizeStartRef.current.x;
      const dy = e.clientY - resizeStartRef.current.y;

      let newWidth = resizeStartRef.current.width;
      let newHeight = resizeStartRef.current.height;

      if (resizeDirection.includes('e')) {
        newWidth = Math.max(minWidth, resizeStartRef.current.width + dx);
      }
      if (resizeDirection.includes('s')) {
        newHeight = Math.max(minHeight, resizeStartRef.current.height + dy);
      }
      if (resizeDirection.includes('w')) {
        newWidth = Math.max(minWidth, resizeStartRef.current.width - dx);
      }
      if (resizeDirection.includes('n')) {
        newHeight = Math.max(minHeight, resizeStartRef.current.height - dy);
      }

      setPanelSize(panelId, { width: newWidth, height: newHeight });
    },
    [isResizing, resizeDirection, minWidth, minHeight, panelId, setPanelSize]
  );

  const handleResizeEnd = useCallback(() => {
    setIsResizing(false);
    setResizeDirection(null);
  }, []);

  // Attach global listeners for drag and resize
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      handleDrag(e);
      handleResize(e);
    };

    const handleMouseUp = () => {
      handleDragEnd();
      handleResizeEnd();
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleDrag, handleResize, handleDragEnd, handleResizeEnd]);

  return (
    <div
      ref={panelRef}
      className={clsx(
        'absolute bg-theme-bg-secondary border border-theme-border rounded-lg shadow-xl overflow-hidden',
        'flex flex-col',
        (isDragging || isResizing) && 'select-none'
      )}
      style={{
        left: position.x,
        top: position.y,
        width: panelState.width,
        height: panelState.height,
        zIndex: 100,
      }}
      onDragOver={handleDragOver}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 bg-theme-bg-tertiary cursor-move border-b border-theme-border"
        onMouseDown={handleDragStart}
      >
        <span className="text-sm font-medium text-theme-text">{title}</span>
        <button
          className="panel-controls p-0.5 text-theme-text-muted hover:text-theme-text hover:bg-theme-bg rounded transition-colors"
          onClick={() => closePanel(panelId)}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">{children}</div>

      {/* Resize handles */}
      <div
        className="absolute right-0 top-0 w-2 h-full cursor-e-resize"
        onMouseDown={(e) => handleResizeStart(e, 'e')}
      />
      <div
        className="absolute left-0 bottom-0 w-full h-2 cursor-s-resize"
        onMouseDown={(e) => handleResizeStart(e, 's')}
      />
      <div
        className="absolute right-0 bottom-0 w-3 h-3 cursor-se-resize"
        onMouseDown={(e) => handleResizeStart(e, 'se')}
      />
    </div>
  );
}
