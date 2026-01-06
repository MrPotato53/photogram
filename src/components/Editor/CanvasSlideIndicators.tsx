import type { Slide } from '../../types';

interface CanvasSlideIndicatorsProps {
  slides: Slide[];
  currentSlideIndex: number;
  canvasSize: { width: number };
  zoomLevel: number;
  onSlideClick: (index: number) => void;
  onSlideDelete: (index: number) => void;
}

export function CanvasSlideIndicators({
  slides,
  currentSlideIndex,
  canvasSize,
  zoomLevel,
  onSlideClick,
  onSlideDelete,
}: CanvasSlideIndicatorsProps) {
  return (
    <>
      {slides.map((_, index) => (
        <div
          key={index}
          className="absolute -top-5 group"
          style={{
            left: 24 + (index * canvasSize.width + canvasSize.width / 2) * zoomLevel,
            transform: 'translateX(-50%)',
          }}
        >
          <div
            className={`flex items-center gap-0.5 text-xs px-2 py-0.5 rounded transition-colors cursor-pointer ${
              index === currentSlideIndex
                ? 'bg-blue-500 text-white'
                : 'bg-gray-600 text-gray-300 hover:bg-gray-500'
            }`}
            onClick={() => onSlideClick(index)}
          >
            <span>{index + 1}</span>
            {/* Delete button - appears on hover when there's more than 1 slide */}
            {slides.length > 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSlideDelete(index);
                }}
                className="hidden group-hover:flex items-center justify-center w-3.5 h-3.5 -mr-1 ml-0.5 rounded-full hover:bg-black/20 transition-colors"
                title="Delete slide"
              >
                <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>
      ))}
    </>
  );
}

