import { useState, useCallback, useRef } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import clsx from 'clsx';
import { useProjectStore } from '../../../stores/projectStore';
import { useElementStore } from '../../../stores/elementStore';
import type { Element } from '../../../types';

export function LayersPanel() {
  const { project } = useProjectStore();
  const { selectedElementId, selectElement, reorderElements } = useElementStore();

  // Global elements across all slides
  const elements = project?.elements || [];

  // Sort by zIndex descending (top layers first)
  const sortedElements = [...elements].sort((a, b) => b.zIndex - a.zIndex);

  // Drag state
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dropPosition, setDropPosition] = useState<'above' | 'below' | null>(null);
  const dragStartY = useRef<number>(0);

  // Refs to track current values for use in event handlers (avoids stale closure)
  const dragOverIdRef = useRef<string | null>(null);
  const dropPositionRef = useRef<'above' | 'below' | null>(null);

  const handleDragStart = useCallback(
    (e: React.MouseEvent, elementId: string) => {
      e.preventDefault();
      e.stopPropagation();
      setDraggedId(elementId);
      dragStartY.current = e.clientY;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        // Find which element we're hovering over
        const layerElements = document.querySelectorAll('[data-layer-id]');
        let foundTarget = false;
        let newDragOverId: string | null = null;
        let newDropPosition: 'above' | 'below' | null = null;

        // Check if we're above the first layer (for dropping to top position)
        const firstLayer = layerElements[0];
        if (firstLayer) {
          const firstRect = firstLayer.getBoundingClientRect();
          if (moveEvent.clientY < firstRect.top + firstRect.height / 2) {
            const firstLayerId = firstLayer.getAttribute('data-layer-id');
            if (firstLayerId && firstLayerId !== elementId) {
              foundTarget = true;
              newDragOverId = firstLayerId;
              newDropPosition = 'above';
            }
          }
        }

        if (!foundTarget) {
          layerElements.forEach((el) => {
            const rect = el.getBoundingClientRect();
            const layerId = el.getAttribute('data-layer-id');

            if (
              layerId &&
              layerId !== elementId &&
              moveEvent.clientY >= rect.top &&
              moveEvent.clientY <= rect.bottom
            ) {
              foundTarget = true;
              newDragOverId = layerId;
              // Determine if we're in the top or bottom half
              const midpoint = rect.top + rect.height / 2;
              newDropPosition = moveEvent.clientY < midpoint ? 'above' : 'below';
            }
          });
        }

        // Update both state and refs
        setDragOverId(newDragOverId);
        setDropPosition(newDropPosition);
        dragOverIdRef.current = newDragOverId;
        dropPositionRef.current = newDropPosition;
      };

      const handleMouseUp = () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);

        // Get current values from refs (not stale closure state)
        const currentDragOverId = dragOverIdRef.current;
        const currentDropPosition = dropPositionRef.current;

        // Perform the reorder if we have a valid drop target
        if (currentDragOverId && currentDropPosition) {
          const currentOrder = sortedElements.map((el) => el.id);
          const draggedIndex = currentOrder.indexOf(elementId);
          let targetIndex = currentOrder.indexOf(currentDragOverId);

          if (draggedIndex !== -1 && targetIndex !== -1 && draggedIndex !== targetIndex) {
            // Remove dragged item
            currentOrder.splice(draggedIndex, 1);

            // Recalculate target index after removal
            targetIndex = currentOrder.indexOf(currentDragOverId);

            // Insert at new position
            if (currentDropPosition === 'below') {
              currentOrder.splice(targetIndex + 1, 0, elementId);
            } else {
              currentOrder.splice(targetIndex, 0, elementId);
            }

            reorderElements(currentOrder);
          }
        }

        setDraggedId(null);
        setDragOverId(null);
        setDropPosition(null);
        dragOverIdRef.current = null;
        dropPositionRef.current = null;
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [sortedElements, reorderElements]
  );

  const getLayerName = (element: Element, index: number) => {
    if (element.type === 'photo') {
      // Try to get the media filename
      const media = project?.mediaPool.find((m) => m.id === element.mediaId);
      if (media) {
        // Remove extension and truncate
        const name = media.fileName.replace(/\.[^/.]+$/, '');
        return name.length > 20 ? name.substring(0, 17) + '...' : name;
      }
      return `Photo ${elements.length - index}`;
    }
    return `Placeholder ${elements.length - index}`;
  };

  return (
    <div data-panel="layers" className="p-2 h-full flex flex-col">
      {sortedElements.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-theme-text-muted">
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
              d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
            />
          </svg>
          <p className="text-sm text-center">No elements</p>
          <p className="text-xs text-center mt-1 opacity-70">Add photos to the canvas</p>
        </div>
      ) : (
        <div className="flex-1 space-y-0.5 overflow-y-auto pt-1">
          {sortedElements.map((element, index) => {
            const isDragging = draggedId === element.id;
            const isDropTarget = dragOverId === element.id;

            return (
              <div
                key={element.id}
                data-layer-id={element.id}
                onClick={() => selectElement(element.id)}
                className={clsx(
                  'relative flex items-center gap-2 px-2 py-1.5 rounded transition-colors',
                  isDragging && 'opacity-50',
                  selectedElementId === element.id
                    ? 'bg-blue-500/20 text-blue-500'
                    : 'hover:bg-theme-bg-tertiary text-theme-text-secondary'
                )}
              >
                {/* Drop indicator line */}
                {isDropTarget && dropPosition === 'above' && (
                  <div className="absolute -top-0.5 left-2 right-2 h-0.5 bg-blue-500 rounded-full" />
                )}
                {isDropTarget && dropPosition === 'below' && (
                  <div className="absolute -bottom-0.5 left-2 right-2 h-0.5 bg-blue-500 rounded-full" />
                )}

                {/* Drag handle */}
                <div
                  onMouseDown={(e) => handleDragStart(e, element.id)}
                  className="cursor-grab active:cursor-grabbing p-0.5 -ml-1 hover:bg-theme-bg-tertiary rounded"
                  title="Drag to reorder"
                >
                  <svg
                    className="w-4 h-4 text-theme-text-muted"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 8h16M4 16h16"
                    />
                  </svg>
                </div>

                {/* Layer thumbnail */}
                <div className="w-7 h-7 bg-theme-bg-tertiary rounded overflow-hidden flex items-center justify-center flex-shrink-0">
                  {element.type === 'photo' ? (
                    (() => {
                      const media = project?.mediaPool.find((m) => m.id === element.mediaId);
                      const thumbnailSrc = media?.thumbnailPath
                        ? convertFileSrc(media.thumbnailPath)
                        : media?.filePath
                          ? convertFileSrc(media.filePath)
                          : null;
                      return thumbnailSrc ? (
                        <img
                          src={thumbnailSrc}
                          alt=""
                          className="w-full h-full object-cover"
                          draggable={false}
                        />
                      ) : (
                        <svg className="w-4 h-4 text-theme-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={1.5}
                            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                          />
                        </svg>
                      );
                    })()
                  ) : (
                    <svg className="w-4 h-4 text-theme-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M12 4v16m8-8H4"
                      />
                    </svg>
                  )}
                </div>

                {/* Layer name */}
                <span className="text-sm flex-1 truncate">{getLayerName(element, index)}</span>

                {/* Lock indicator */}
                {element.locked && (
                  <svg
                    className="w-3.5 h-3.5 text-theme-text-muted flex-shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                    />
                  </svg>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
