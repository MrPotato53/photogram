import React, { useState, useCallback, useMemo } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { Modal, Button } from '../common';
import type { ExportOptions } from '../../services/tauri';
import type { AspectRatio } from '../../types';
import { getDesignSize } from '../../utils/designConstants';

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
  // Calculate design size and Instagram optimal multiplier
  const designSize = useMemo(() => getDesignSize(aspectRatio), [aspectRatio]);
  const instagramMultiplier = useMemo(() => 1080 / designSize.width, [designSize.width]);

  const [selectedSlides, setSelectedSlides] = useState<Set<number>>(
    new Set(Array.from({ length: numSlides }, (_, i) => i))
  );
  const [format, setFormat] = useState<'png' | 'jpeg'>('png');
  const [quality, setQuality] = useState(90); // 0-100
  const [resolution, setResolution] = useState(instagramMultiplier); // Default to Instagram optimal
  const [outputFolder, setOutputFolder] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  // Calculate output dimensions for a given multiplier
  const getOutputDimensions = useCallback((multiplier: number) => {
    const width = Math.round(designSize.width * multiplier);
    const height = Math.round(designSize.height * multiplier);
    return { width, height };
  }, [designSize]);

  // Resolution options with labels
  const resolutionOptions = useMemo(() => [
    {
      value: instagramMultiplier,
      label: 'Instagram',
      description: (() => {
        const dims = getOutputDimensions(instagramMultiplier);
        return `${dims.width} × ${dims.height}`;
      })(),
    },
    {
      value: 1,
      label: '1x',
      description: (() => {
        const dims = getOutputDimensions(1);
        return `${dims.width} × ${dims.height}`;
      })(),
    },
    {
      value: 2,
      label: '2x',
      description: (() => {
        const dims = getOutputDimensions(2);
        return `${dims.width} × ${dims.height}`;
      })(),
    },
    {
      value: 3,
      label: '3x',
      description: (() => {
        const dims = getOutputDimensions(3);
        return `${dims.width} × ${dims.height}`;
      })(),
    },
    {
      value: 4,
      label: '4x',
      description: (() => {
        const dims = getOutputDimensions(4);
        return `${dims.width} × ${dims.height}`;
      })(),
    },
  ], [instagramMultiplier, getOutputDimensions]);

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

  const handleExport = useCallback(async () => {
    if (!outputFolder || selectedSlides.size === 0) return;

    setIsExporting(true);
    try {
      const slideIndices = Array.from(selectedSlides).sort((a, b) => a - b);
      const options: ExportOptions = {
        projectName,
        slideIndices,
        outputFolder,
        format,
        quality: quality / 100, // Convert to 0-1 range
        pixelRatio: resolution,
      };

      await onExport(slideIndices, options);
      onClose();
    } catch (error) {
      console.error('Export failed:', error);
      // TODO: Show error toast/notification
    } finally {
      setIsExporting(false);
    }
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
                const thumbnail = renderSlideThumbnail?.(i);

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

                    {/* Checkbox overlay */}
                    <div className="absolute top-1 left-1">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSlide(i)}
                        onClick={(e) => e.stopPropagation()}
                        className="w-5 h-5 rounded bg-white/90 border-2 border-white shadow-lg text-blue-500 focus:ring-blue-500 focus:ring-offset-0 cursor-pointer"
                      />
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
          <label className="text-sm font-medium text-theme-text mb-2 block">
            Resolution:
          </label>
          <div className="flex flex-col gap-2">
            {resolutionOptions.map((option) => (
              <label
                key={option.value}
                className="flex items-center gap-2 cursor-pointer"
              >
                <input
                  type="radio"
                  name="resolution"
                  value={option.value}
                  checked={Math.abs(resolution - option.value) < 0.001}
                  onChange={() => setResolution(option.value)}
                  className="w-4 h-4 text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
                />
                <span className="text-sm text-theme-text">
                  {option.label} <span className="text-theme-text-muted">({option.description})</span>
                </span>
              </label>
            ))}
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
          <Button variant="secondary" onClick={onClose} disabled={isExporting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleExport}
            disabled={!isValid || isExporting}
          >
            {isExporting
              ? 'Exporting...'
              : `Export (${selectedSlides.size} slide${selectedSlides.size !== 1 ? 's' : ''})`}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
