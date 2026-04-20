import { useState, useCallback, useRef, useMemo } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import clsx from 'clsx';
import { useProjectStore } from '../../../stores/projectStore';
import { useElementStore } from '../../../stores/elementStore';
import type { Element } from '../../../types';

export function LayersPanel() {
  const project = useProjectStore((s) => s.project);
  const selectedElementId = useElementStore((s) => s.selectedElementId);
  const focusElement = useElementStore((s) => s.focusElement);
  const reorderElements = useElementStore((s) => s.reorderElements);
  const reorderElementsLocal = useElementStore((s) => s.reorderElementsLocal);

  // Global elements across all slides
  const elements = project?.elements || [];

  // Sort ascending by zIndex so the bottom of the list is the frontmost
  // layer. Drag/commit handlers reverse the visual order before calling
  // reorderElements[Local], whose contract is "first id gets highest zIndex".
  const sortedElements = useMemo(
    () => [...elements].sort((a, b) => a.zIndex - b.zIndex),
    [elements]
  );

  // Media pool lookup map for O(1) access
  const mediaPoolMap = useMemo(() => {
    const map = new Map<string, { fileName: string; thumbnailPath: string | null; filePath: string }>();
    for (const m of project?.mediaPool || []) {
      map.set(m.id, m);
    }
    return map;
  }, [project?.mediaPool]);

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

      // Focus the element in the canvas on drag start.
      focusElement(elementId);

      // Snapshot the starting order and track the last order we applied
      // via reorderElementsLocal so mousemove only fires a reorder when the
      // drop slot actually changes (not on every mouse pixel).
      const initialOrder = sortedElements.map((el) => el.id);
      let lastAppliedOrder = initialOrder;

      const computeNewOrder = (
        targetId: string,
        position: 'above' | 'below'
      ): string[] | null => {
        const order = [...lastAppliedOrder];
        const draggedIndex = order.indexOf(elementId);
        if (draggedIndex === -1 || order.indexOf(targetId) === -1) return null;
        order.splice(draggedIndex, 1);
        const targetIndex = order.indexOf(targetId);
        if (targetIndex === -1) return null;
        if (position === 'below') {
          order.splice(targetIndex + 1, 0, elementId);
        } else {
          order.splice(targetIndex, 0, elementId);
        }
        return order;
      };

      const ordersEqual = (a: string[], b: string[]) => {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
        return true;
      };

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

        // Live preview: apply the reorder to the in-memory project so the
        // canvas re-renders with the new z-order. Only apply when the
        // computed order actually differs from what we last applied — this
        // debounces work down to "user crossed a layer boundary".
        if (newDragOverId && newDropPosition) {
          const candidate = computeNewOrder(newDragOverId, newDropPosition);
          if (candidate && !ordersEqual(candidate, lastAppliedOrder)) {
            lastAppliedOrder = candidate;
            // Visual order is now ascending (top of list = lowest zIndex),
            // but reorderElementsLocal expects first id = highest zIndex.
            reorderElementsLocal([...candidate].reverse());
          }
        }
      };

      const handleMouseUp = () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);

        // Commit the final order via the persisting path (writes to backend,
        // pushes a single history entry) — only if anything actually changed.
        // Same reversal as the local path: reorderElements' contract is
        // "first id = highest zIndex" but our visual order is ascending.
        if (!ordersEqual(lastAppliedOrder, initialOrder)) {
          reorderElements([...lastAppliedOrder].reverse());
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
    [sortedElements, reorderElements, reorderElementsLocal, focusElement]
  );

  const getLayerName = (element: Element, index: number) => {
    if (element.type === 'photo') {
      const media = element.mediaId ? mediaPoolMap.get(element.mediaId) : undefined;
      if (media) {
        const name = media.fileName.replace(/\.[^/.]+$/, '');
        return name.length > 20 ? name.substring(0, 17) + '...' : name;
      }
      return `Photo ${index + 1}`;
    }
    return `Placeholder ${index + 1}`;
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
                onClick={() => focusElement(element.id)}
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
                      const media = element.mediaId ? mediaPoolMap.get(element.mediaId) : undefined;
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
