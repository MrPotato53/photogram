import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { Modal, Button } from '../common';
import type { ExportOptions } from '../../services/tauri';
import type { AspectRatio } from '../../types';
import { getDesignSize } from '../../utils/designConstants';
import { usePreferencesStore } from '../../stores/preferencesStore';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectName: string;
  aspectRatio: AspectRatio;
  numSlides: number;
  onExport: (slideIndices: number[], options: ExportOptions) => Promise<void>;
  renderSlideThumbnail?: (slideIndex: number) => string | null;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  projectName,
  aspectRatio,
  numSlides,
  onExport,
  renderSlideThumbnail,
}) => {
  // Calculate design size; Instagram targets are always 1080-wide finals so
  // multipliers scale relative to that base, not the design's native width.
  const designSize = useMemo(() => getDesignSize(aspectRatio), [aspectRatio]);
  const instagramBaseMultiplier = useMemo(() => 1080 / designSize.width, [designSize.width]);

  const preferences = usePreferencesStore((s) => s.preferences);
  const setDefaultExportResolution = usePreferencesStore((s) => s.setDefaultExportResolution);
  const userDefaultKey = preferences.defaultExportResolution || 'instagram2x';

  const [selectedSlides, setSelectedSlides] = useState<Set<number>>(
    new Set(Array.from({ length: numSlides }, (_, i) => i))
  );
  const [format, setFormat] = useState<'png' | 'jpeg'>('png');
  const [quality, setQuality] = useState(90); // 0-100
  const [resolutionKey, setResolutionKey] = useState<string>(userDefaultKey);
  const [outputFolder, setOutputFolder] = useState<string | null>(null);

  // Generate ALL thumbnails synchronously once when the modal opens, then
  // cache in state so re-renders (e.g. checkbox toggles) don't re-invoke
  // stage.toDataURL. The original perf bug was inline renderSlideThumbnail(i)
  // in JSX firing on every render — caching alone fixes that. Doing it sync
  // produces one brief pause when the modal opens, after which all slides
  // (including offscreen ones the user scrolls to later) are instantly ready.
  const [thumbnails, setThumbnails] = useState<(string | null)[]>([]);
  useEffect(() => {
    if (!isOpen || !renderSlideThumbnail) return;
    const all: (string | null)[] = [];
    for (let i = 0; i < numSlides; i++) {
      all.push(renderSlideThumbnail(i));
    }
    setThumbnails(all);
  }, [isOpen, numSlides, renderSlideThumbnail]);

  // Resolution presets. Each carries a stable `key` (persistable as user
  // default) and a `multiplier` evaluated against the design's pixel width.
  // Instagram presets target a *fixed* final width (1080/2160/3240) so the
  // multiplier varies per aspect ratio. "Native" matches design dimensions.
  // 4x dropped per quality analysis (negligible gain past 3x, 16x file size).
  const resolutionOptions = useMemo(() => {
    const fmtDims = (mult: number) =>
      `${Math.round(designSize.width * mult)} × ${Math.round(designSize.height * mult)}`;
    return [
      {
        key: 'instagram1x',
        label: 'Instagram (1080)',
        description: fmtDims(instagramBaseMultiplier),
        multiplier: instagramBaseMultiplier,
        note: 'Single compression pass — softer detail',
      },
      {
        key: 'instagram2x',
        label: 'Instagram (2160)',
        description: fmtDims(instagramBaseMultiplier * 2),
        multiplier: instagramBaseMultiplier * 2,
        note: 'Recommended — sharpest after Instagram resize',
      },
      {
        key: 'instagram3x',
        label: 'Instagram (3240) — high detail',
        description: fmtDims(instagramBaseMultiplier * 3),
        multiplier: instagramBaseMultiplier * 3,
        note: 'For fine textures (hair, small text). 9× the file size of 1x.',
      },
      {
        key: 'native1x',
        label: 'Native size',
        description: fmtDims(1),
        multiplier: 1,
        note: 'Exact design dimensions — for non-Instagram use',
      },
    ];
  }, [designSize, instagramBaseMultiplier]);

  // Resolve current selection (always exists because state defaults to a
  // valid key; if a stored preference key was removed, fall back to default).
  const selectedOption =
    resolutionOptions.find((o) => o.key === resolutionKey) ?? resolutionOptions[1];
  const resolution = selectedOption.multiplier;

  // If a preset key from a prior version has been retired (e.g. legacy "4x"),
  // snap the selection back to a real option so the radio reflects state.
  useEffect(() => {
    if (!resolutionOptions.some((o) => o.key === resolutionKey)) {
      setResolutionKey(resolutionOptions[1].key);
    }
  }, [resolutionOptions, resolutionKey]);

  const toggleSlide = useCallback((index: number) => {
    setSelectedSlides((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedSlides(new Set(Array.from({ length: numSlides }, (_, i) => i)));
  }, [numSlides]);

  const deselectAll = useCallback(() => {
    setSelectedSlides(new Set());
  }, []);

  const handleChooseFolder = useCallback(async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
      });

      if (selected && typeof selected === 'string') {
        setOutputFolder(selected);
      }
    } catch (error) {
      console.error('Failed to choose folder:', error);
    }
  }, []);

  const handleExport = useCallback(() => {
    if (!outputFolder || selectedSlides.size === 0) return;

    const slideIndices = Array.from(selectedSlides).sort((a, b) => a - b);
    const options: ExportOptions = {
      projectName,
      slideIndices,
      outputFolder,
      format,
      quality: quality / 100, // Convert to 0-1 range
      pixelRatio: resolution,
    };

    // Close modal immediately — export runs in the background and reports
    // progress via the parent's persistent toast. Don't await; the user can
    // keep editing while it runs.
    onClose();
    void onExport(slideIndices, options).catch((error) => {
      console.error('Export failed:', error);
    });
  }, [outputFolder, selectedSlides, projectName, format, quality, resolution, onExport, onClose]);

  const isValid = selectedSlides.size > 0 && outputFolder !== null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Export Slides" size="md">
      <div className="space-y-4">
        {/* Slide Selection */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-theme-text">
              Select slides to export:
            </label>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={selectAll}>
                Select All
              </Button>
              <Button variant="ghost" size="sm" onClick={deselectAll}>
                Deselect All
              </Button>
            </div>
          </div>

          {/* Horizontal scrollable thumbnail grid */}
          <div className="overflow-x-auto border border-theme-border rounded bg-theme-bg p-3">
            <div className="flex gap-3 pb-1">
              {Array.from({ length: numSlides }, (_, i) => {
                const isSelected = selectedSlides.has(i);
                const thumbnail = thumbnails[i] ?? null;

                return (
                  <div
                    key={i}
                    onClick={() => toggleSlide(i)}
                    className={`
                      relative flex-shrink-0 cursor-pointer rounded overflow-hidden
                      transition-all duration-150
                      ${isSelected ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-theme-bg' : 'ring-1 ring-theme-border hover:ring-theme-border-hover'}
                    `}
                    style={{ width: '120px' }}
                  >
                    {/* Thumbnail or placeholder */}
                    {thumbnail ? (
                      <img
                        src={thumbnail}
                        alt={`Slide ${i + 1}`}
                        className="w-full h-auto block"
                      />
                    ) : (
                      <div
                        className="w-full bg-theme-bg-tertiary flex items-center justify-center text-theme-text-muted text-xs"
                        style={{ aspectRatio: `${aspectRatio.width}/${aspectRatio.height}` }}
                      >
                        Slide {i + 1}
                      </div>
                    )}

                    {/* Checkbox overlay — custom-styled so checked color
                        is driven by React state, not the WebView's native
                        accent rendering (which can drop after focus shifts
                        from the system file dialog). */}
                    <div
                      role="checkbox"
                      aria-checked={isSelected}
                      aria-label={`Select slide ${i + 1}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSlide(i);
                      }}
                      className={`absolute top-1 left-1 w-5 h-5 rounded shadow-lg flex items-center justify-center cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-blue-500 border-2 border-blue-500'
                          : 'bg-white/90 border-2 border-white'
                      }`}
                    >
                      {isSelected && (
                        <svg
                          viewBox="0 0 16 16"
                          className="w-3.5 h-3.5 text-white"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="3,8 7,12 13,4" />
                        </svg>
                      )}
                    </div>

                    {/* Slide number badge */}
                    <div className="absolute bottom-1 right-1 px-1.5 py-0.5 bg-black/70 text-white text-xs rounded">
                      {i + 1}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Format Selection */}
        <div>
          <label className="text-sm font-medium text-theme-text mb-2 block">
            Format:
          </label>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="format"
                value="png"
                checked={format === 'png'}
                onChange={() => setFormat('png')}
                className="w-4 h-4 text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
              />
              <span className="text-sm text-theme-text">PNG (lossless)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="format"
                value="jpeg"
                checked={format === 'jpeg'}
                onChange={() => setFormat('jpeg')}
                className="w-4 h-4 text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
              />
              <span className="text-sm text-theme-text">JPEG</span>
            </label>
          </div>
        </div>

        {/* JPEG Quality (conditional) */}
        {format === 'jpeg' && (
          <div>
            <label className="text-sm font-medium text-theme-text mb-2 block">
              Quality: {quality}%
            </label>
            <input
              type="range"
              min="10"
              max="100"
              step="5"
              value={quality}
              onChange={(e) => setQuality(parseInt(e.target.value))}
              className="w-full h-2 bg-theme-bg-tertiary rounded-lg appearance-none cursor-pointer accent-blue-500"
            />
          </div>
        )}

        {/* Resolution Multiplier */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-theme-text">
              Resolution:
            </label>
            {/* Save-as-default chip: appears only when the current selection
                doesn't match the persisted preference. One click promotes it. */}
            {resolutionKey !== userDefaultKey && (
              <button
                type="button"
                onClick={() => void setDefaultExportResolution(resolutionKey)}
                className="text-xs px-2 py-0.5 rounded border border-blue-500/50 text-blue-400 hover:bg-blue-500/10 transition-colors"
                title="Remember this choice for future exports"
              >
                Use as default
              </button>
            )}
          </div>
          <div className="flex flex-col gap-2">
            {resolutionOptions.map((option) => {
              const isSelected = resolutionKey === option.key;
              const isUserDefault = option.key === userDefaultKey;
              return (
                <label key={option.key} className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="resolution"
                    value={option.key}
                    checked={isSelected}
                    onChange={() => setResolutionKey(option.key)}
                    className="w-4 h-4 mt-0.5 text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
                  />
                  <div className="flex-1">
                    <div className="text-sm text-theme-text">
                      {option.label}{' '}
                      <span className="text-theme-text-muted">({option.description})</span>
                      {isUserDefault && (
                        <span className="ml-1 text-[10px] uppercase tracking-wide text-blue-400">
                          default
                        </span>
                      )}
                    </div>
                    {option.note && (
                      <div className="text-xs text-theme-text-muted mt-0.5">{option.note}</div>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        {/* Folder Picker */}
        <div>
          <label className="text-sm font-medium text-theme-text mb-2 block">
            Destination Folder:
          </label>
          <div className="flex gap-2">
            <div className="flex-1 px-3 py-2 text-sm bg-theme-bg border border-theme-border rounded text-theme-text truncate">
              {outputFolder || 'No folder selected'}
            </div>
            <Button variant="secondary" onClick={handleChooseFolder}>
              Choose...
            </Button>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex justify-end gap-2 pt-4 border-t border-theme-border">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleExport}
            disabled={!isValid}
          >
            {`Export (${selectedSlides.size} slide${selectedSlides.size !== 1 ? 's' : ''})`}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
