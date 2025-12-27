import { useEffect, useRef, useState, useCallback } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { convertFileSrc } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import clsx from 'clsx';
import { useEditorStore } from '../../../stores/editorStore';
import { ConfirmDialog } from '../../common/ConfirmDialog';

export function MediaPoolPanel() {
  const containerRef = useRef<HTMLDivElement>(null);
  const {
    project,
    selectedMediaIds,
    selectMedia,
    importMedia,
    removeSelectedMedia,
    isMediaInUse,
    draggingMediaId,
    setDraggingMedia,
    setDragPosition,
  } = useEditorStore();

  const mediaPool = project?.mediaPool || [];
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  // Listen for Tauri drag-drop events from file explorer
  useEffect(() => {
    const webview = getCurrentWebviewWindow();

    const unlistenPromise = webview.onDragDropEvent(async (event) => {
      const dragEvent = event.payload;
      if (dragEvent.type === 'over' || dragEvent.type === 'enter') {
        setIsDraggingOver(true);
      } else if (dragEvent.type === 'drop') {
        setIsDraggingOver(false);
        const paths = dragEvent.paths;
        if (paths && paths.length > 0) {
          await importMedia(paths);
        }
      } else if (dragEvent.type === 'leave') {
        setIsDraggingOver(false);
      }
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [importMedia]);

  // Handle keyboard events for delete
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (e.key === 'Backspace' || e.key === 'Delete') {
        if (selectedMediaIds.length > 0 && document.activeElement === containerRef.current) {
          e.preventDefault();
          handleDeleteSelected();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedMediaIds]);

  const handleDeleteSelected = () => {
    const anyInUse = selectedMediaIds.some((id) => isMediaInUse(id));
    if (anyInUse) {
      setDeleteConfirmOpen(true);
    } else {
      removeSelectedMedia();
    }
  };

  const confirmDelete = () => {
    removeSelectedMedia();
    setDeleteConfirmOpen(false);
  };

  const handleImport = async () => {
    try {
      const selected = await open({
        multiple: true,
        directory: false,
        filters: [
          {
            name: 'Images',
            extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'],
          },
        ],
      });

      if (selected) {
        const paths = Array.isArray(selected) ? selected : [selected];
        await importMedia(paths);
      }
    } catch (error) {
      console.error('Failed to open file dialog:', error);
    }
  };

  // Use mouse events for dragging (more reliable than HTML5 drag-drop across z-index boundaries)
  const handleMediaMouseDown = (e: React.MouseEvent, mediaId: string) => {
    // Only handle left click
    if (e.button !== 0) return;

    // Don't start drag immediately - wait for mouse move to distinguish from click
    const startX = e.clientX;
    const startY = e.clientY;
    let isDragging = false;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;

      // Start dragging after 5px of movement
      if (!isDragging && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
        isDragging = true;
        // If the dragged item isn't selected, select only it
        if (!selectedMediaIds.includes(mediaId)) {
          selectMedia(mediaId);
        }
        setDraggingMedia(mediaId);
      }
      // Note: We don't update dragPosition during drag - only on mouseup
      // This prevents the drop handler from firing on every mouse move
    };

    const handleMouseUp = (upEvent: MouseEvent) => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);

      if (isDragging) {
        // Set final position for drop handling
        setDragPosition({ x: upEvent.clientX, y: upEvent.clientY });
        // The drop will be handled by EditorLayout listening to dragPosition changes
      } else {
        // It was a click, not a drag
        selectMedia(mediaId, {
          shift: e.shiftKey,
          ctrl: e.metaKey || e.ctrlKey,
        });
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const getMediaSrc = useCallback((media: { filePath: string; thumbnailPath: string | null }) => {
    // Use thumbnail if available for better performance
    const path = media.thumbnailPath || media.filePath;
    return convertFileSrc(path);
  }, []);

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      className={clsx(
        'p-3 h-full flex flex-col outline-none',
        isDraggingOver && 'bg-blue-500/10'
      )}
    >
      {mediaPool.length === 0 ? (
        <div
          className={clsx(
            'flex-1 flex flex-col items-center justify-center text-theme-text-muted border-2 border-dashed rounded-lg transition-colors',
            isDraggingOver ? 'border-blue-500 bg-blue-500/5' : 'border-theme-border'
          )}
        >
          <svg
            className="w-10 h-10 mb-2 opacity-50"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          <p className="text-sm text-center">No media imported</p>
          <p className="text-xs text-center mt-1 opacity-70">
            Drag & drop images or click Import
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          {/* Extra padding to prevent ring clipping */}
          <div className="p-1">
            <div className="grid grid-cols-3 gap-2">
              {mediaPool.map((media) => {
                const isSelected = selectedMediaIds.includes(media.id);
                const isDragging = draggingMediaId === media.id;

                return (
                  <div
                    key={media.id}
                    onMouseDown={(e) => handleMediaMouseDown(e, media.id)}
                    className={clsx(
                      'aspect-square bg-theme-bg-tertiary rounded overflow-hidden cursor-grab transition-all relative select-none',
                      isSelected
                        ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-theme-bg-secondary'
                        : 'hover:ring-2 hover:ring-theme-border',
                      isDragging && 'opacity-50 cursor-grabbing'
                    )}
                    title={media.fileName}
                  >
                    <img
                      src={getMediaSrc(media)}
                      alt={media.fileName}
                      className="w-full h-full object-cover pointer-events-none"
                      draggable={false}
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Import button */}
      <button
        onClick={handleImport}
        className="mt-3 w-full py-2 border border-dashed border-theme-border rounded text-sm text-theme-text-secondary hover:border-blue-500 hover:text-blue-500 transition-colors"
      >
        + Import Media
      </button>

      {/* Selected media info */}
      {selectedMediaIds.length > 0 && (
        <div className="mt-2 pt-2 border-t border-theme-border text-xs text-theme-text-muted flex justify-between items-center">
          <span className="truncate flex-1">
            {selectedMediaIds.length === 1
              ? mediaPool.find((m) => m.id === selectedMediaIds[0])?.fileName
              : `${selectedMediaIds.length} items selected`}
          </span>
          <button
            onClick={handleDeleteSelected}
            className="ml-2 p-1 text-red-500 hover:bg-red-500/10 rounded transition-colors"
            title="Delete (Backspace)"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </button>
        </div>
      )}

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        isOpen={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        onConfirm={confirmDelete}
        title="Delete Media"
        message={
          selectedMediaIds.length === 1
            ? 'This media is currently used on the canvas. Deleting it will also remove it from all slides. Are you sure?'
            : 'Some of the selected media are used on the canvas. Deleting them will also remove them from all slides. Are you sure?'
        }
        confirmLabel="Delete"
        danger
      />
    </div>
  );
}
