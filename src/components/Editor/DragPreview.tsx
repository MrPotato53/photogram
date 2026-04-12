import { useRef, useEffect } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useProjectStore } from '../../stores/projectStore';
import { useMediaStore } from '../../stores/mediaStore';

// Module-level ref for direct DOM updates (bypasses React re-renders)
let dragPreviewElement: HTMLDivElement | null = null;
let dragLabelElement: HTMLDivElement | null = null;

/**
 * Update the drag preview position directly on the DOM element.
 * Called from mousemove handlers — never goes through React state.
 */
export function updateDragPreviewPosition(x: number, y: number) {
  if (dragPreviewElement) {
    dragPreviewElement.style.transform = `translate(${x - 40}px, ${y - 40}px)`;
  }
}

/**
 * Update the drag label text directly on the DOM (for fill mode hint).
 */
export function updateDragLabel(text: string) {
  if (dragLabelElement) {
    dragLabelElement.textContent = text;
  }
}

export function DragPreview() {
  const draggingMediaId = useMediaStore((s) => s.draggingMediaId);
  const project = useProjectStore((s) => s.project);
  const elRef = useRef<HTMLDivElement>(null);

  // Register/unregister the DOM element
  useEffect(() => {
    dragPreviewElement = elRef.current;
    return () => { dragPreviewElement = null; };
  });

  if (!draggingMediaId || !project) {
    return null;
  }

  const media = project.mediaPool.find((m) => m.id === draggingMediaId);
  if (!media) {
    return null;
  }

  const imageSrc = convertFileSrc(media.thumbnailPath || media.filePath);
  const previewSize = 80;

  return (
    <div
      ref={elRef}
      className="fixed pointer-events-none z-[10000]"
      style={{ top: 0, left: 0, willChange: 'transform' }}
    >
      <div
        className="rounded-lg overflow-hidden shadow-2xl border-2 border-blue-500 bg-theme-bg-secondary"
        style={{ width: previewSize, height: previewSize }}
      >
        <img
          src={imageSrc}
          alt={media.fileName}
          className="w-full h-full object-cover"
          draggable={false}
        />
      </div>
      <div
        ref={(el) => { dragLabelElement = el; }}
        className="absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-xs text-white bg-black/70 px-2 py-1 rounded"
      >
        Drop on canvas
      </div>
    </div>
  );
}
