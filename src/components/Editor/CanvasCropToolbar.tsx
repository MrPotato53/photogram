interface CanvasCropToolbarProps {
  cropAspectRatio: number | null;
  showCustomRatio: boolean;
  customRatioWidth: string;
  customRatioHeight: string;
  croppingFullBounds: { width: number; height: number } | null;
  onRatioChange: (ratio: number | null) => void;
  onCustomRatioToggle: () => void;
  onCustomWidthChange: (value: string) => void;
  onCustomHeightChange: (value: string) => void;
  onReset: () => void;
  onCancel: () => void;
  onApply: () => void;
}

export function CanvasCropToolbar({
  cropAspectRatio,
  showCustomRatio,
  customRatioWidth,
  customRatioHeight,
  croppingFullBounds,
  onRatioChange,
  onCustomRatioToggle,
  onCustomWidthChange,
  onCustomHeightChange,
  onReset,
  onCancel,
  onApply,
}: CanvasCropToolbarProps) {
  if (!croppingFullBounds) return null;

  return (
    <div className="absolute top-12 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2 py-1 bg-gray-900/90 backdrop-blur-sm rounded-lg shadow-lg z-10">
      <span className="text-xs text-gray-400 mr-1">Ratio:</span>
      {[
        { label: 'Free', ratio: null },
        { label: 'Original', ratio: croppingFullBounds.width / croppingFullBounds.height },
        { label: '1:1', ratio: 1 },
        { label: '4:5', ratio: 4 / 5 },
        { label: '16:9', ratio: 16 / 9 },
        { label: '1.91:1', ratio: 1.91 },
      ].map((preset) => {
        const isSelected = cropAspectRatio === preset.ratio && !showCustomRatio;
        return (
          <button
            key={preset.label}
            onClick={() => onRatioChange(preset.ratio)}
            className={`px-1.5 py-0.5 text-xs rounded transition-colors ${
              isSelected ? 'bg-blue-500 text-white' : 'text-gray-300 hover:bg-gray-700'
            }`}
          >
            {preset.label}
          </button>
        );
      })}
      {/* Custom ratio toggle and inputs */}
      <button
        onClick={onCustomRatioToggle}
        className={`px-1.5 py-0.5 text-xs rounded transition-colors ${
          showCustomRatio ? 'bg-blue-500 text-white' : 'text-gray-300 hover:bg-gray-700'
        }`}
      >
        Custom
      </button>
      {showCustomRatio && (
        <div className="flex items-center gap-1">
          <input
            type="number"
            min="0.1"
            step="0.1"
            value={customRatioWidth}
            onChange={(e) => onCustomWidthChange(e.target.value)}
            className="w-10 px-1 py-0.5 text-xs bg-gray-700 text-white rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
          />
          <span className="text-xs text-gray-400">:</span>
          <input
            type="number"
            min="0.1"
            step="0.1"
            value={customRatioHeight}
            onChange={(e) => onCustomHeightChange(e.target.value)}
            className="w-10 px-1 py-0.5 text-xs bg-gray-700 text-white rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
          />
        </div>
      )}
      <div className="w-px h-3 bg-gray-600 mx-1" />
      <button
        onClick={onReset}
        className="px-1.5 py-0.5 text-xs text-gray-300 hover:bg-gray-700 rounded"
      >
        Reset
      </button>
      <div className="w-px h-3 bg-gray-600 mx-1" />
      <button
        onClick={onCancel}
        className="px-1.5 py-0.5 text-xs text-gray-300 hover:bg-gray-700 rounded"
      >
        Cancel
      </button>
      <button
        onClick={onApply}
        className="px-1.5 py-0.5 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
      >
        Apply
      </button>
    </div>
  );
}

