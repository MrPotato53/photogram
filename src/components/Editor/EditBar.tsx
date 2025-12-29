import { useState, useRef, useEffect } from 'react';
import clsx from 'clsx';
import { useEditorStore, type SnapSettings, type SnapSettingsUpdate } from '../../stores/editorStore';

// Reusable number input with visible spinner arrows
interface NumberInputProps {
  value: number;
  onChange: (value: number) => void;
  onDoubleClick?: () => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  suffix?: string;
  className?: string;
  title?: string;
}

function NumberInput({
  value,
  onChange,
  onDoubleClick,
  min,
  max,
  step = 1,
  disabled = false,
  suffix,
  className = '',
  title,
}: NumberInputProps) {
  const [localValue, setLocalValue] = useState(value.toString());

  useEffect(() => {
    setLocalValue(value.toString());
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalValue(e.target.value);
  };

  const handleBlur = () => {
    const parsed = parseFloat(localValue);
    if (!isNaN(parsed)) {
      let clamped = parsed;
      if (min !== undefined) clamped = Math.max(min, clamped);
      if (max !== undefined) clamped = Math.min(max, clamped);
      onChange(clamped);
      setLocalValue(clamped.toString());
    } else {
      setLocalValue(value.toString());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    }
  };

  const increment = () => {
    const newVal = value + step;
    if (max === undefined || newVal <= max) {
      onChange(newVal);
    }
  };

  const decrement = () => {
    const newVal = value - step;
    if (min === undefined || newVal >= min) {
      onChange(newVal);
    }
  };

  return (
    <div
      className={clsx(
        'flex items-center bg-theme-bg border border-theme-border rounded overflow-hidden',
        disabled && 'opacity-50',
        className
      )}
      title={title}
    >
      <input
        type="text"
        value={localValue}
        onChange={handleChange}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        onDoubleClick={onDoubleClick}
        disabled={disabled}
        className="w-full px-1.5 py-0.5 text-xs bg-transparent text-theme-text focus:outline-none text-center"
      />
      {suffix && (
        <span className="text-xs text-theme-text-muted pr-1">{suffix}</span>
      )}
      <div className="flex flex-col border-l border-theme-border">
        <button
          onClick={increment}
          disabled={disabled}
          className="px-1 py-0 hover:bg-theme-bg-tertiary text-theme-text-muted hover:text-theme-text disabled:hover:bg-transparent disabled:hover:text-theme-text-muted"
          tabIndex={-1}
        >
          <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
          </svg>
        </button>
        <button
          onClick={decrement}
          disabled={disabled}
          className="px-1 py-0 hover:bg-theme-bg-tertiary text-theme-text-muted hover:text-theme-text disabled:hover:bg-transparent disabled:hover:text-theme-text-muted border-t border-theme-border"
          tabIndex={-1}
        >
          <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// Toolbar icon button
interface IconButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}

function IconButton({ icon, label, onClick, disabled = false, active = false }: IconButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={clsx(
        'p-1.5 rounded transition-colors',
        disabled
          ? 'text-gray-600 cursor-not-allowed'
          : active
          ? 'text-blue-400 bg-blue-500/20 hover:bg-blue-500/30'
          : 'text-theme-text-secondary hover:text-theme-text hover:bg-theme-bg-tertiary'
      )}
    >
      {icon}
    </button>
  );
}

// Snapping settings popover
interface SnapSettingsPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  snapEnabled: boolean;
  setSnapEnabled: (enabled: boolean) => void;
  snapSettings: SnapSettings;
  updateSnapSettings: (updates: SnapSettingsUpdate) => void;
}

function SnapSettingsPopover({
  isOpen,
  onClose,
  snapEnabled,
  setSnapEnabled,
  snapSettings,
  updateSnapSettings,
}: SnapSettingsPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={popoverRef}
      className="absolute top-full mt-1 right-0 w-64 bg-theme-bg-secondary border border-theme-border rounded-lg shadow-xl z-50"
    >
      <div className="p-3 space-y-3">
        {/* Master toggle */}
        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-sm font-medium text-theme-text">Enable Snapping</span>
          <input
            type="checkbox"
            checked={snapEnabled}
            onChange={(e) => setSnapEnabled(e.target.checked)}
            className="w-4 h-4 rounded bg-theme-bg border-theme-border text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
          />
        </label>

        <div className="border-t border-theme-border pt-3 space-y-2.5">
          <span className="text-xs text-theme-text-muted uppercase tracking-wide">Snap To</span>

          {/* Canvas center */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-theme-text-secondary">Canvas center</span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => updateSnapSettings({ canvas: { show: !snapSettings.canvas.show } })}
                className={clsx(
                  'p-1 rounded transition-colors',
                  snapSettings.canvas.show
                    ? 'text-blue-400 bg-blue-500/20'
                    : 'text-gray-500 hover:text-gray-400'
                )}
                title="Show guides"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              </button>
              <input
                type="checkbox"
                checked={snapSettings.canvas.enabled}
                onChange={(e) => updateSnapSettings({ canvas: { enabled: e.target.checked } })}
                disabled={!snapEnabled}
                className="w-4 h-4 rounded bg-theme-bg border-theme-border text-blue-500 focus:ring-blue-500 focus:ring-offset-0 disabled:opacity-50"
              />
            </div>
          </div>

          {/* Other elements */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-theme-text-secondary">Other elements</span>
            <input
              type="checkbox"
              checked={snapSettings.elements}
              onChange={(e) => updateSnapSettings({ elements: e.target.checked })}
              disabled={!snapEnabled}
              className="w-4 h-4 rounded bg-theme-bg border-theme-border text-blue-500 focus:ring-blue-500 focus:ring-offset-0 disabled:opacity-50"
            />
          </div>

          {/* Margin guides */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-sm text-theme-text-secondary">Margin guides</span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => updateSnapSettings({ margin: { show: !snapSettings.margin.show } })}
                  className={clsx(
                    'p-1 rounded transition-colors',
                    snapSettings.margin.show
                      ? 'text-blue-400 bg-blue-500/20'
                      : 'text-gray-500 hover:text-gray-400'
                  )}
                  title="Show guides"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                </button>
                <input
                  type="checkbox"
                  checked={snapSettings.margin.enabled}
                  onChange={(e) => updateSnapSettings({ margin: { enabled: e.target.checked } })}
                  disabled={!snapEnabled}
                  className="w-4 h-4 rounded bg-theme-bg border-theme-border text-blue-500 focus:ring-blue-500 focus:ring-offset-0 disabled:opacity-50"
                />
              </div>
            </div>
            {(snapSettings.margin.enabled || snapSettings.margin.show) && (
              <div className="flex items-center gap-2 pl-2">
                <span className="text-xs text-theme-text-muted">Margin:</span>
                <NumberInput
                  value={snapSettings.margin.value}
                  onChange={(val) => updateSnapSettings({ margin: { value: val } })}
                  min={0}
                  max={500}
                  className="w-20"
                />
                <span className="text-xs text-theme-text-muted">px</span>
              </div>
            )}
          </div>

          {/* Grid guides */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-sm text-theme-text-secondary">Grid guides</span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => updateSnapSettings({ grid: { show: !snapSettings.grid.show } })}
                  className={clsx(
                    'p-1 rounded transition-colors',
                    snapSettings.grid.show
                      ? 'text-blue-400 bg-blue-500/20'
                      : 'text-gray-500 hover:text-gray-400'
                  )}
                  title="Show guides"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                </button>
                <input
                  type="checkbox"
                  checked={snapSettings.grid.enabled}
                  onChange={(e) => updateSnapSettings({ grid: { enabled: e.target.checked } })}
                  disabled={!snapEnabled}
                  className="w-4 h-4 rounded bg-theme-bg border-theme-border text-blue-500 focus:ring-blue-500 focus:ring-offset-0 disabled:opacity-50"
                />
              </div>
            </div>
            {(snapSettings.grid.enabled || snapSettings.grid.show) && (
              <div className="space-y-1.5 pl-2">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-theme-text-muted">Rows:</span>
                    <NumberInput
                      value={snapSettings.grid.horizontal}
                      onChange={(val) => updateSnapSettings({ grid: { horizontal: Math.max(2, Math.min(12, val)) } })}
                      min={2}
                      max={12}
                      className="w-14"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-theme-text-muted">Cols:</span>
                    <NumberInput
                      value={snapSettings.grid.vertical}
                      onChange={(val) => updateSnapSettings({ grid: { vertical: Math.max(2, Math.min(12, val)) } })}
                      min={2}
                      max={12}
                      className="w-14"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-theme-text-muted">Gutter:</span>
                  <NumberInput
                    value={snapSettings.grid.margin}
                    onChange={(val) => updateSnapSettings({ grid: { margin: Math.max(0, Math.min(200, val)) } })}
                    min={0}
                    max={200}
                    className="w-20"
                  />
                  <span className="text-xs text-theme-text-muted">px</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function EditBar() {
  const {
    panels,
    togglePanel,
    selectedElementId,
    project,
    updateElement,
    enterCropMode,
    cropModeElementId,
    snapEnabled,
    setSnapEnabled,
    snapSettings,
    updateSnapSettings,
  } = useEditorStore();

  const [snapPopoverOpen, setSnapPopoverOpen] = useState(false);

  // Get selected element from project's global elements
  const elements = project?.elements || [];
  const mediaPool = project?.mediaPool || [];
  const selectedElement = selectedElementId
    ? elements.find((el) => el.id === selectedElementId)
    : null;

  // Get the original media item for the selected element
  const selectedMedia = selectedElement?.mediaId
    ? mediaPool.find((m) => m.id === selectedElement.mediaId)
    : null;

  const isElementSelected = !!selectedElement;
  const isCropping = !!cropModeElementId;

  // Design dimensions (canvas size)
  const DESIGN_HEIGHT = 1080;
  const designWidth = project
    ? DESIGN_HEIGHT * (project.aspectRatio.width / project.aspectRatio.height)
    : 1920;

  // Calculate the "fit size" - size the image would be if it filled the canvas (contain fit)
  // This becomes our 100% baseline, making scale more intuitive
  const getFitSize = () => {
    if (!selectedMedia) return { width: designWidth, height: DESIGN_HEIGHT };

    const mediaAspect = selectedMedia.width / selectedMedia.height;
    const canvasAspect = designWidth / DESIGN_HEIGHT;

    if (mediaAspect > canvasAspect) {
      // Image is wider than canvas - fit to width
      return { width: designWidth, height: designWidth / mediaAspect };
    } else {
      // Image is taller than canvas - fit to height
      return { width: DESIGN_HEIGHT * mediaAspect, height: DESIGN_HEIGHT };
    }
  };

  // Calculate scale percentage relative to "fit canvas" size
  const getScalePercent = () => {
    if (!selectedElement || !selectedMedia) return 100;
    const fitSize = getFitSize();
    // Current visible width (accounting for crop)
    const currentWidth = selectedElement.width / (selectedElement.cropWidth ?? 1);
    return Math.round((currentWidth / fitSize.width) * 100);
  };

  // Get rotation in degrees
  const getRotation = () => {
    if (!selectedElement) return 0;
    return Math.round(selectedElement.rotation ?? 0);
  };

  // Handlers
  const handleFlipHorizontal = () => {
    if (!selectedElement) return;
    const currentFlipX = selectedElement.flipX ?? false;
    updateElement(selectedElement.id, { flipX: !currentFlipX });
  };

  const handleFlipVertical = () => {
    if (!selectedElement) return;
    const currentFlipY = selectedElement.flipY ?? false;
    updateElement(selectedElement.id, { flipY: !currentFlipY });
  };

  const handleCrop = () => {
    if (!selectedElement) return;
    enterCropMode(selectedElement.id);
  };

  const handleResetCrop = () => {
    if (!selectedElement) return;
    updateElement(selectedElement.id, {
      cropX: 0,
      cropY: 0,
      cropWidth: 1,
      cropHeight: 1,
    });
  };

  const handleScaleChange = (percent: number) => {
    if (!selectedElement || !selectedMedia) return;
    const scale = percent / 100;
    const fitSize = getFitSize();
    // Account for crop - the element shows cropWidth/cropHeight of the original
    const cropW = selectedElement.cropWidth ?? 1;
    const cropH = selectedElement.cropHeight ?? 1;
    // Scale relative to fit size, then apply crop
    const newWidth = fitSize.width * scale * cropW;
    const newHeight = fitSize.height * scale * cropH;
    updateElement(selectedElement.id, { width: newWidth, height: newHeight });
  };

  const handleRotationChange = (degrees: number) => {
    if (!selectedElement) return;
    // Normalize to 0-360
    const normalized = ((degrees % 360) + 360) % 360;
    updateElement(selectedElement.id, { rotation: normalized });
  };

  const handlePositionXChange = (x: number) => {
    if (!selectedElement) return;
    updateElement(selectedElement.id, { x });
  };

  const handlePositionYChange = (y: number) => {
    if (!selectedElement) return;
    updateElement(selectedElement.id, { y });
  };

  const handleResetScale = () => {
    if (!selectedElement || !selectedMedia) return;
    // Reset to 100% = fits canvas (accounting for crop)
    const fitSize = getFitSize();
    const cropW = selectedElement.cropWidth ?? 1;
    const cropH = selectedElement.cropHeight ?? 1;
    const newWidth = fitSize.width * cropW;
    const newHeight = fitSize.height * cropH;
    updateElement(selectedElement.id, { width: newWidth, height: newHeight });
  };

  const handleResetRotation = () => {
    if (!selectedElement) return;
    updateElement(selectedElement.id, { rotation: 0 });
  };

  const hasCrop = selectedElement && (
    (selectedElement.cropX ?? 0) !== 0 ||
    (selectedElement.cropY ?? 0) !== 0 ||
    (selectedElement.cropWidth ?? 1) !== 1 ||
    (selectedElement.cropHeight ?? 1) !== 1
  );

  if (!panels.editBar.isOpen) {
    return (
      <div className="flex-shrink-0 bg-theme-bg-secondary border-b border-theme-border">
        <button
          onClick={() => togglePanel('editBar')}
          className="w-full py-1 text-xs text-theme-text-muted hover:text-theme-text hover:bg-theme-bg-tertiary transition-colors flex items-center justify-center gap-1"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
          Edit Tools
        </button>
      </div>
    );
  }

  return (
    <div className="flex-shrink-0 bg-theme-bg-secondary border-b border-theme-border">
      <div className="flex items-center justify-between px-3 py-1.5">
        {/* Left: Close/collapse button */}
        <button
          onClick={() => togglePanel('editBar')}
          className="p-1 text-theme-text-muted hover:text-theme-text hover:bg-theme-bg-tertiary rounded transition-colors"
          title="Collapse edit bar"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
          </svg>
        </button>

        {/* Center: Main controls */}
        <div className="flex items-center gap-3">

        {/* Flip buttons */}
        <div className="flex items-center gap-0.5">
          <IconButton
            icon={
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 17H4m0 0l4-4m-4 4l4 4m4-12h12m0 0l-4 4m4-4l-4-4" />
              </svg>
            }
            label="Flip Horizontal"
            onClick={handleFlipHorizontal}
            disabled={!isElementSelected || isCropping}
            active={selectedElement?.flipX}
          />
          <IconButton
            icon={
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
              </svg>
            }
            label="Flip Vertical"
            onClick={handleFlipVertical}
            disabled={!isElementSelected || isCropping}
            active={selectedElement?.flipY}
          />
        </div>

        {/* Separator */}
        <div className="w-px h-5 bg-theme-border" />

        {/* Crop buttons */}
        <div className="flex items-center gap-0.5">
          <IconButton
            icon={
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 7V3m0 4H3m4 0h10v10m4-4v4m0 0h4m-4 0H7" />
              </svg>
            }
            label="Crop"
            onClick={handleCrop}
            disabled={!isElementSelected}
            active={isCropping}
          />
          <IconButton
            icon={
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            }
            label="Reset Crop"
            onClick={handleResetCrop}
            disabled={!isElementSelected || !hasCrop || isCropping}
          />
        </div>

        {/* Separator */}
        <div className="w-px h-5 bg-theme-border" />

        {/* Transform controls */}
        <div className="flex items-center gap-2">
          {/* Position X */}
          <div className="flex items-center gap-1">
            <span className="text-xs text-theme-text-muted">X:</span>
            <NumberInput
              value={Math.round(selectedElement?.x ?? 0)}
              onChange={handlePositionXChange}
              disabled={!isElementSelected || isCropping}
              className="w-16"
              title="X Position"
            />
          </div>

          {/* Position Y */}
          <div className="flex items-center gap-1">
            <span className="text-xs text-theme-text-muted">Y:</span>
            <NumberInput
              value={Math.round(selectedElement?.y ?? 0)}
              onChange={handlePositionYChange}
              disabled={!isElementSelected || isCropping}
              className="w-16"
              title="Y Position"
            />
          </div>

          {/* Scale */}
          <div className="flex items-center gap-1">
            <span className="text-xs text-theme-text-muted">Scale:</span>
            <NumberInput
              value={getScalePercent()}
              onChange={handleScaleChange}
              onDoubleClick={handleResetScale}
              min={1}
              max={500}
              step={1}
              disabled={!isElementSelected || isCropping}
              suffix="%"
              className="w-20"
              title="Scale (double-click to reset to 100%)"
            />
          </div>

          {/* Rotation */}
          <div className="flex items-center gap-1">
            <span className="text-xs text-theme-text-muted">Rotation:</span>
            <NumberInput
              value={getRotation()}
              onChange={handleRotationChange}
              onDoubleClick={handleResetRotation}
              min={0}
              max={359}
              step={15}
              disabled={!isElementSelected || isCropping}
              suffix="°"
              className="w-20"
              title="Rotation (double-click to reset)"
            />
          </div>
        </div>

        {/* Separator */}
        <div className="w-px h-5 bg-theme-border" />

        {/* Snapping controls */}
        <div className="relative">
          <div className="flex">
            <button
              onClick={() => setSnapEnabled(!snapEnabled)}
              className={clsx(
                'flex items-center gap-1 pl-2 pr-1 py-1 rounded-l text-xs transition-colors',
                snapEnabled
                  ? 'bg-blue-500/20 text-blue-400'
                  : 'text-theme-text-secondary hover:text-theme-text hover:bg-theme-bg-tertiary'
              )}
              title="Toggle snapping"
            >
              {/* Magnet icon */}
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 3v6a6 6 0 0012 0V3M6 3H3v6a9 9 0 0018 0V3h-3M6 3h12" />
              </svg>
              <span>Snap</span>
            </button>
            <button
              onClick={() => setSnapPopoverOpen(!snapPopoverOpen)}
              className={clsx(
                'flex items-center px-1 py-1 rounded-r text-xs transition-colors border-l',
                snapEnabled
                  ? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                  : 'text-theme-text-secondary hover:text-theme-text hover:bg-theme-bg-tertiary border-theme-border'
              )}
              title="Snap settings"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>

          <SnapSettingsPopover
            isOpen={snapPopoverOpen}
            onClose={() => setSnapPopoverOpen(false)}
            snapEnabled={snapEnabled}
            setSnapEnabled={setSnapEnabled}
            snapSettings={snapSettings}
            updateSnapSettings={updateSnapSettings}
          />
        </div>
        </div>

        {/* Right spacer to balance layout */}
        <div className="w-8" />
      </div>
    </div>
  );
}
