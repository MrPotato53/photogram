import clsx from 'clsx';
import { useEditorStore } from '../../../stores/editorStore';

export function LayersPanel() {
  const { project, currentSlideIndex, selectedElementId, selectElement } = useEditorStore();

  const currentSlide = project?.slides[currentSlideIndex];
  const elements = currentSlide?.elements || [];

  // Sort by zIndex descending (top layers first)
  const sortedElements = [...elements].sort((a, b) => b.zIndex - a.zIndex);

  return (
    <div className="p-2 h-full flex flex-col">
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
          <p className="text-xs text-center mt-1 opacity-70">
            Add photos to the canvas
          </p>
        </div>
      ) : (
        <div className="flex-1 space-y-1 overflow-y-auto">
          {sortedElements.map((element, index) => (
            <div
              key={element.id}
              onClick={() => selectElement(element.id)}
              className={clsx(
                'flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors',
                selectedElementId === element.id
                  ? 'bg-blue-500/20 text-blue-500'
                  : 'hover:bg-theme-bg-tertiary text-theme-text-secondary'
              )}
            >
              {/* Layer icon */}
              <div className="w-6 h-6 bg-theme-bg-tertiary rounded flex items-center justify-center text-xs">
                {element.type === 'photo' ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                    />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5z"
                    />
                  </svg>
                )}
              </div>

              {/* Layer name */}
              <span className="text-sm flex-1 truncate">
                {element.type === 'photo' ? 'Photo' : 'Placeholder'} {elements.length - index}
              </span>

              {/* Lock indicator */}
              {element.locked && (
                <svg
                  className="w-3.5 h-3.5 text-theme-text-muted"
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
          ))}
        </div>
      )}
    </div>
  );
}
