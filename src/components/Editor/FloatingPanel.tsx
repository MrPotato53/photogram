import { useState, useRef, useCallback, useEffect, type ReactNode } from 'react';
import clsx from 'clsx';
import { usePanelStore, type PanelId } from '../../stores/panelStore';
import { useMediaStore } from '../../stores/mediaStore';

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
  const panels = usePanelStore((s) => s.panels);
  const setPanelSize = usePanelStore((s) => s.setPanelSize);
  const closePanel = usePanelStore((s) => s.closePanel);
  const draggingMediaId = useMediaStore((s) => s.draggingMediaId);
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

  // Local size state for smooth resize (avoids store updates on every frame)
  const [localSize, setLocalSize] = useState<{ width: number; height: number } | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef({ x: 0, y: 0, posX: 0, posY: 0 });
  const resizeStartRef = useRef({ x: 0, y: 0, width: 0, height: 0 });

  // Ref to track pending store commit (for cancellation)
  const commitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref to track the pending size to commit
  const pendingSizeRef = useRef<{ width: number; height: number } | null>(null);

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

      // Cancel any pending store commit from previous resize
      if (commitTimeoutRef.current) {
        clearTimeout(commitTimeoutRef.current);
        commitTimeoutRef.current = null;
      }

      // Set global cursor so it persists even when mouse leaves the handle
      const cursorMap: Record<string, string> = {
        e: 'ew-resize', w: 'ew-resize', s: 'ns-resize', n: 'ns-resize',
        se: 'nwse-resize', nw: 'nwse-resize', sw: 'nesw-resize', ne: 'nesw-resize',
      };
      document.body.style.cursor = cursorMap[direction] || 'default';

      setIsResizing(true);
      setResizeDirection(direction);

      // Use pending size, local size, or panel state as starting point
      const currentWidth = pendingSizeRef.current?.width ?? localSize?.width ?? panelState.width;
      const currentHeight = pendingSizeRef.current?.height ?? localSize?.height ?? panelState.height;

      // If there was a pending size, apply it to local state immediately
      if (pendingSizeRef.current) {
        setLocalSize(pendingSizeRef.current);
        pendingSizeRef.current = null;
      }

      resizeStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        width: currentWidth,
        height: currentHeight,
      };
    },
    [panelState.width, panelState.height, localSize]
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

      // Update local state during resize (fast, no store update)
      setLocalSize({ width: newWidth, height: newHeight });
    },
    [isResizing, resizeDirection, minWidth, minHeight]
  );

  const handleResizeEnd = useCallback(() => {
    document.body.style.cursor = '';
    if (localSize) {
      // Store the size to commit and schedule a debounced commit
      pendingSizeRef.current = localSize;

      // Cancel any existing pending commit
      if (commitTimeoutRef.current) {
        clearTimeout(commitTimeoutRef.current);
      }

      // Debounce the store commit - if another resize starts within 150ms, this will be cancelled
      commitTimeoutRef.current = setTimeout(() => {
        if (pendingSizeRef.current) {
          setPanelSize(panelId, pendingSizeRef.current);
          pendingSizeRef.current = null;
          // Clear local size so display uses store value
          setLocalSize(null);
        }
        commitTimeoutRef.current = null;
      }, 150);
    }
    setIsResizing(false);
    setResizeDirection(null);
    // Keep localSize so it's used for display until store commits
  }, [localSize, panelId, setPanelSize]);

  // Attach global listeners ONLY when actively dragging or resizing
  useEffect(() => {
    // Only attach listeners when needed
    if (!isDragging && !isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) handleDrag(e);
      if (isResizing) handleResize(e);
    };

    const handleMouseUp = () => {
      if (isDragging) handleDragEnd();
      if (isResizing) handleResizeEnd();
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, isResizing, handleDrag, handleResize, handleDragEnd, handleResizeEnd]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (commitTimeoutRef.current) {
        clearTimeout(commitTimeoutRef.current);
      }
    };
  }, []);

  // Calculate display size: prefer local (during resize), then pending (after resize, before commit), then store
  const displayWidth = localSize?.width ?? pendingSizeRef.current?.width ?? panelState.width;
  const displayHeight = localSize?.height ?? pendingSizeRef.current?.height ?? panelState.height;

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
        width: displayWidth,
        height: displayHeight,
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
