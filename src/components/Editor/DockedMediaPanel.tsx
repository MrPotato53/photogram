import { useState, useRef, useCallback, useEffect, type ReactNode } from 'react';
import clsx from 'clsx';
import { usePanelStore } from '../../stores/panelStore';

const MIN_WIDTH = 200;
const MAX_WIDTH = 500;

interface DockedMediaPanelProps {
  children: ReactNode;
}

export function DockedMediaPanel({ children }: DockedMediaPanelProps) {
  const panelWidth = usePanelStore((s) => s.panels.mediaPool.width);
  const setPanelSize = usePanelStore((s) => s.setPanelSize);
  const closePanel = usePanelStore((s) => s.closePanel);
  const setMediaPoolDocked = usePanelStore((s) => s.setMediaPoolDocked);

  // Local width for smooth resize
  const [localWidth, setLocalWidth] = useState<number | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartRef = useRef({ x: 0, width: 0 });

  const displayWidth = localWidth ?? panelWidth;

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    document.body.style.cursor = 'ew-resize';
    setIsResizing(true);
    resizeStartRef.current = {
      x: e.clientX,
      width: displayWidth,
    };
  }, [displayWidth]);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - resizeStartRef.current.x;
      const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, resizeStartRef.current.width + dx));
      setLocalWidth(newWidth);
    };

    const handleMouseUp = () => {
      document.body.style.cursor = '';
      setIsResizing(false);
      if (localWidth !== null) {
        setPanelSize('mediaPool', { width: localWidth });
        setLocalWidth(null);
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, localWidth, setPanelSize]);

  return (
    <div
      className={clsx(
        'relative flex-shrink-0 flex flex-col bg-theme-bg-secondary border-r border-theme-border',
        isResizing && 'select-none'
      )}
      style={{ width: displayWidth }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-theme-bg-tertiary border-b border-theme-border">
        <span className="text-sm font-medium text-theme-text">Media Pool</span>
        <div className="flex items-center gap-1 panel-controls">
          {/* Pop out to floating */}
          <button
            className="p-0.5 text-theme-text-muted hover:text-theme-text hover:bg-theme-bg rounded transition-colors"
            onClick={() => setMediaPoolDocked(false)}
            title="Pop out to floating panel"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </button>
          {/* Close */}
          <button
            className="p-0.5 text-theme-text-muted hover:text-theme-text hover:bg-theme-bg rounded transition-colors"
            onClick={() => closePanel('mediaPool')}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto min-h-0">{children}</div>

      {/* Right edge resize handle */}
      <div
        className="absolute right-0 top-0 w-1.5 h-full cursor-ew-resize hover:bg-blue-500/30 transition-colors z-10"
        onMouseDown={handleResizeStart}
      />
    </div>
  );
}
