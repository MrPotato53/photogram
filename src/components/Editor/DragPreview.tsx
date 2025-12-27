import { convertFileSrc } from '@tauri-apps/api/core';
import { useEditorStore } from '../../stores/editorStore';

export function DragPreview() {
  const { project, draggingMediaId, dragMousePosition } = useEditorStore();

  // Don't render if not dragging or no position
  if (!draggingMediaId || !dragMousePosition || !project) {
    return null;
  }

  // Find the media being dragged
  const media = project.mediaPool.find((m) => m.id === draggingMediaId);
  if (!media) {
    return null;
  }

  // Get the image source (prefer thumbnail for performance)
  const imageSrc = convertFileSrc(media.thumbnailPath || media.filePath);

  // Preview size
  const previewSize = 80;

  return (
    <div
      className="fixed pointer-events-none z-[10000]"
      style={{
        left: dragMousePosition.x - previewSize / 2,
        top: dragMousePosition.y - previewSize / 2,
      }}
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
      {/* Drop hint */}
      <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-xs text-white bg-black/70 px-2 py-1 rounded">
        Drop on canvas
      </div>
    </div>
  );
}
