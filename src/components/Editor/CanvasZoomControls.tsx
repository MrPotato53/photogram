interface CanvasZoomControlsProps {
  zoomLevel: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
}

export function CanvasZoomControls({
  zoomLevel,
  onZoomIn,
  onZoomOut,
  onResetZoom,
}: CanvasZoomControlsProps) {
  return (
    <div className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 bg-gray-900/90 backdrop-blur-sm rounded-lg shadow-lg z-10">
      <button
        onClick={onZoomOut}
        className="px-2 py-1 text-xs text-gray-300 hover:bg-gray-700 rounded transition-colors"
        title="Zoom out"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
        </svg>
      </button>
      <span className="text-xs text-gray-300 min-w-[3rem] text-center">
        {Math.round(zoomLevel * 100)}%
      </span>
      <button
        onClick={onZoomIn}
        className="px-2 py-1 text-xs text-gray-300 hover:bg-gray-700 rounded transition-colors"
        title="Zoom in"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
      </button>
      <div className="w-px h-4 bg-gray-600 mx-1" />
      <button
        onClick={onResetZoom}
        className="px-2 py-1 text-xs text-gray-300 hover:bg-gray-700 rounded transition-colors"
        title="Reset zoom"
      >
        Reset
      </button>
    </div>
  );
}

