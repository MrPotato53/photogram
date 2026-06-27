import { useEffect, useRef, useState } from 'react';
import { CONTENT_ROTATION_MAX, clampContentRotation } from '../../utils/contentRotation';

interface CanvasCropToolbarProps {
  cropAspectRatio: number | null;
  showCustomRatio: boolean;
  customRatioWidth: string;
  customRatioHeight: string;
  croppingFullBounds: { width: number; height: number } | null;
  // Content rotation (Straighten), degrees ±CONTENT_ROTATION_MAX
  contentRotation: number;
  onContentRotationChange: (deg: number) => void;
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
  contentRotation,
  onContentRotationChange,
  onRatioChange,
  onCustomRatioToggle,
  onCustomWidthChange,
  onCustomHeightChange,
  onReset,
  onCancel,
  onApply,
}: CanvasCropToolbarProps) {
  // Shift = fine-tune mode for the Straighten slider: thumb movement is
  // damped and the step shrinks so precise sub-degree adjustments are easy.
  // State (not ref) because the slider's `step` attr must re-render.
  const [shiftHeld, setShiftHeld] = useState(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShiftHeld(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShiftHeld(false);
    };
    // Shift can be released outside the window (e.g. while over a native
    // dialog); blur resets so the mode never sticks.
    const blur = () => setShiftHeld(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  // Manual pointer-drag for the Straighten slider. preventDefault on
  // pointerdown/mousedown suppresses the native range drag (and the compat
  // click/dblclick events), so double-click-to-reset is detected manually
  // via pointerdown timestamps.
  const lastPointerDownAtRef = useRef(0);
  const handleSliderPointerDown = (e: React.PointerEvent<HTMLInputElement>) => {
    e.preventDefault();
    const now = performance.now();
    if (now - lastPointerDownAtRef.current < 300) {
      // Double-click → reset to 0
      lastPointerDownAtRef.current = 0;
      onContentRotationChange(0);
      return;
    }
    lastPointerDownAtRef.current = now;

    const rect = e.currentTarget.getBoundingClientRect();
    const range = 2 * CONTENT_ROTATION_MAX;
    // Plain click jumps to the pointer position (native slider behavior);
    // Shift-click starts fine-tuning from the CURRENT value with no jump.
    let value = e.shiftKey
      ? contentRotation
      : clampContentRotation(((e.clientX - rect.left) / rect.width) * range - CONTENT_ROTATION_MAX);
    onContentRotationChange(Math.round(value * 100) / 100);

    let lastX = e.clientX;
    const move = (ev: PointerEvent) => {
      // Shift state read PER EVENT so fine mode can engage mid-drag.
      const sensitivity = ev.shiftKey ? 0.1 : 1;
      value = clampContentRotation(
        value + ((ev.clientX - lastX) / rect.width) * range * sensitivity
      );
      lastX = ev.clientX;
      onContentRotationChange(Math.round(value * 100) / 100);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

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
      {/* Straighten — rotates the image content inside the (stationary)
          crop frame, Lightroom-style. Double-click the slider to reset. */}
      <span className="text-xs text-gray-400">Straighten:</span>
      <input
        type="range"
        min={-CONTENT_ROTATION_MAX}
        max={CONTENT_ROTATION_MAX}
        step={shiftHeld ? 0.1 : 0.5}
        value={contentRotation}
        // Keyboard arrows still drive the native input (finer step while
        // Shift is held via the step attr above).
        onChange={(e) => {
          const raw = parseFloat(e.target.value);
          if (Number.isNaN(raw)) return;
          onContentRotationChange(clampContentRotation(raw));
        }}
        // Pointer drags are handled manually with INCREMENTAL deltas.
        // A value-remapping approach can't slow the drag: range inputs
        // emit absolute pointer positions across ~100 events per drag,
        // so any per-event damping just converges to the pointer anyway.
        // Incremental deltas also let Shift be pressed/released mid-drag.
        onPointerDown={handleSliderPointerDown}
        onMouseDown={(e) => e.preventDefault()}
        className="w-24 accent-blue-500 cursor-pointer"
        title="Rotate image inside the frame (Shift = fine-tune, double-click to reset)"
      />
      <input
        type="number"
        min={-CONTENT_ROTATION_MAX}
        max={CONTENT_ROTATION_MAX}
        step={0.5}
        value={contentRotation}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          onContentRotationChange(Number.isNaN(v) ? 0 : clampContentRotation(v));
        }}
        className="w-12 px-1 py-0.5 text-xs bg-gray-700 text-white rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
      />
      <span className="text-xs text-gray-400">°</span>
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

