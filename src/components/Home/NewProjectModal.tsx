import { useMemo, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { Modal, Button, Input, Select } from '../common';
import { ASPECT_RATIOS, getResolution } from '../../constants/aspectRatios';
import { usePreferencesStore } from '../../stores/preferencesStore';
import type { AspectRatio } from '../../types';

interface NewProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string, aspectRatio: AspectRatio, mediaPaths: string[]) => void;
  existingNames: string[];
}

const CUSTOM_KEY = 'custom';

// Default selection — Portrait (4:5) is the most common IG feed format, so
// keep it as the initial pick even though Square sorts first in the list.
const DEFAULT_RATIO = ASPECT_RATIOS.find((r) => r.width === 4 && r.height === 5) ?? ASPECT_RATIOS[0];

// Preview box bounds (px). The white rectangle is scaled to fit inside while
// preserving the chosen ratio.
const PREVIEW_MAX_W = 180;
const PREVIEW_MAX_H = 120;

// Stable identity key for a preset (built-in OR user). Used to find the
// selected option in the <select> regardless of object identity.
function presetKey(ar: AspectRatio, scope: 'builtin' | 'user', i: number): string {
  return `${scope}-${i}-${ar.width}x${ar.height}`;
}

function ratioMatches(a: AspectRatio, w: number, h: number): boolean {
  return a.width === w && a.height === h;
}

export function NewProjectModal({ isOpen, onClose, onCreate, existingNames }: NewProjectModalProps) {
  const customRatios = usePreferencesStore((s) => s.preferences.customAspectRatios);
  const setCustomAspectRatios = usePreferencesStore((s) => s.setCustomAspectRatios);

  const [name, setName] = useState('');
  // Width/height are the live source of truth for the chosen ratio.
  // selectedKey is derived; if neither preset matches the current w/h or the
  // user explicitly clicked "Custom…", we render the Custom inputs.
  const [width, setWidth] = useState<number>(DEFAULT_RATIO.width);
  const [height, setHeight] = useState<number>(DEFAULT_RATIO.height);
  const [customWidth, setCustomWidth] = useState<string>('4');
  const [customHeight, setCustomHeight] = useState<string>('5');
  // True when the user explicitly picked "Custom…" — keeps the custom
  // inputs visible even if the current numbers happen to match a preset
  // (otherwise the dropdown would snap back to that preset visually).
  const [forceCustom, setForceCustom] = useState(false);
  const [mediaPaths, setMediaPaths] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const trimmedName = name.trim();
  const isDuplicate = existingNames.some(
    (n) => n.toLowerCase() === trimmedName.toLowerCase()
  );
  const isValid = trimmedName.length > 0 && !isDuplicate;

  // Find which preset (built-in or user) corresponds to the current w/h, if any.
  const matchedBuiltinIndex = ASPECT_RATIOS.findIndex((r) => ratioMatches(r, width, height));
  const matchedUserIndex = customRatios.findIndex((r) => ratioMatches(r, width, height));
  const isCustomMode = forceCustom || (matchedBuiltinIndex === -1 && matchedUserIndex === -1);

  const selectedKey = forceCustom
    ? CUSTOM_KEY
    : matchedBuiltinIndex !== -1
      ? presetKey(ASPECT_RATIOS[matchedBuiltinIndex], 'builtin', matchedBuiltinIndex)
      : matchedUserIndex !== -1
        ? presetKey(customRatios[matchedUserIndex], 'user', matchedUserIndex)
        : CUSTOM_KEY;

  const aspectRatioOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [];
    for (let i = 0; i < ASPECT_RATIOS.length; i++) {
      opts.push({ value: presetKey(ASPECT_RATIOS[i], 'builtin', i), label: ASPECT_RATIOS[i].name });
    }
    for (let i = 0; i < customRatios.length; i++) {
      opts.push({ value: presetKey(customRatios[i], 'user', i), label: `★ ${customRatios[i].name}` });
    }
    opts.push({ value: CUSTOM_KEY, label: 'Custom…' });
    return opts;
  }, [customRatios]);

  // Selecting a preset from the dropdown copies its dimensions into state.
  // Selecting Custom seeds the inputs with whatever's currently shown so
  // typing starts from the previous values.
  const handleRatioChange = (value: string) => {
    if (value === CUSTOM_KEY) {
      setCustomWidth(String(width));
      setCustomHeight(String(height));
      setForceCustom(true);
      return;
    }
    setForceCustom(false);
    const parts = value.split('-');
    const scope = parts[0];
    const idx = Number(parts[1]);
    const ratio = scope === 'builtin' ? ASPECT_RATIOS[idx] : customRatios[idx];
    if (!ratio) return;
    setWidth(ratio.width);
    setHeight(ratio.height);
  };

  const handleCustomWidthChange = (val: string) => {
    setCustomWidth(val);
    const n = parseInt(val);
    if (!Number.isNaN(n) && n > 0) setWidth(n);
  };
  const handleCustomHeightChange = (val: string) => {
    setCustomHeight(val);
    const n = parseInt(val);
    if (!Number.isNaN(n) && n > 0) setHeight(n);
  };

  // Flip swaps width/height. Works regardless of which mode we're in —
  // resulting ratio might match a different built-in (e.g. 4:5 → 5:4) or
  // become a Custom value (e.g. 1.91:1 → 100:191).
  const handleFlip = () => {
    setWidth(height);
    setHeight(width);
    // Keep custom inputs in sync so toggling back to Custom shows the
    // flipped numbers.
    setCustomWidth(String(height));
    setCustomHeight(String(width));
  };

  const handleSavePreset = () => {
    if (matchedBuiltinIndex !== -1 || matchedUserIndex !== -1) return;
    const next: AspectRatio = {
      width,
      height,
      name: `${width}:${height}`,
    };
    void setCustomAspectRatios([...customRatios, next]);
    // Drop out of custom mode so the dropdown shows the just-saved preset.
    setForceCustom(false);
  };

  const handleDeletePreset = () => {
    if (matchedUserIndex === -1) return;
    const next = customRatios.filter((_, i) => i !== matchedUserIndex);
    void setCustomAspectRatios(next);
  };

  const handleAddPhotos = async () => {
    try {
      const files = await open({
        multiple: true,
        filters: [
          { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
        ],
      });
      if (files) {
        const paths = Array.isArray(files) ? files : [files];
        setMediaPaths((prev) => [...prev, ...paths]);
      }
    } catch (error) {
      console.error('Failed to open file dialog:', error);
    }
  };

  const handleRemovePhoto = (index: number) => {
    setMediaPaths((prev) => prev.filter((_, i) => i !== index));
  };

  const getCurrentRatio = (): AspectRatio => {
    if (matchedBuiltinIndex !== -1) return ASPECT_RATIOS[matchedBuiltinIndex];
    if (matchedUserIndex !== -1) return customRatios[matchedUserIndex];
    return { width, height, name: `Custom (${width}:${height})` };
  };

  const handleCreate = async () => {
    if (!isValid) return;
    setIsLoading(true);
    try {
      await onCreate(trimmedName, getCurrentRatio(), mediaPaths);
      handleClose();
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setName('');
    setWidth(DEFAULT_RATIO.width);
    setHeight(DEFAULT_RATIO.height);
    setCustomWidth('4');
    setCustomHeight('5');
    setForceCustom(false);
    setMediaPaths([]);
    onClose();
  };

  const resolution = getResolution(getCurrentRatio());

  // Scale the preview rectangle to fit the bounds box while preserving ratio.
  const ratioValue = width / height;
  let previewW = PREVIEW_MAX_W;
  let previewH = previewW / ratioValue;
  if (previewH > PREVIEW_MAX_H) {
    previewH = PREVIEW_MAX_H;
    previewW = previewH * ratioValue;
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="New Project" size="md">
      <div className="space-y-5">
        <div>
          <Input
            label="Project Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Instagram Post"
            autoFocus
          />
          {isDuplicate && (
            <p className="mt-1 text-xs text-red-500">A project with this name already exists</p>
          )}
        </div>

        <div className="space-y-1">
          <label className="block text-sm font-medium text-theme-text-secondary">
            Aspect Ratio
          </label>
          <div className="flex items-stretch gap-2">
            <div className="flex-1">
              <Select
                options={aspectRatioOptions}
                value={selectedKey}
                onChange={(e) => handleRatioChange(e.target.value)}
              />
            </div>
            {/* Flip — swaps width/height. Reads the same regardless of which
                preset/custom mode is active. */}
            <button
              type="button"
              onClick={handleFlip}
              className="px-2.5 rounded-md border border-theme-border bg-theme-bg-tertiary text-theme-text-secondary hover:border-theme-border-hover hover:text-theme-text transition-colors"
              title="Swap width and height"
              aria-label="Swap width and height"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7h12m0 0l-3-3m3 3l-3 3M16 17H4m0 0l3 3m-3-3l3-3" />
              </svg>
            </button>
            {/* Delete saved preset — only shown when current matches one. */}
            {matchedUserIndex !== -1 && (
              <button
                type="button"
                onClick={handleDeletePreset}
                className="px-2.5 rounded-md border border-theme-border bg-theme-bg-tertiary text-red-400 hover:bg-red-500/10 hover:border-red-500/40 transition-colors"
                title="Delete this saved preset"
                aria-label="Delete preset"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {isCustomMode && (
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <Input
                label="Width"
                type="number"
                min="1"
                max="100"
                value={customWidth}
                onChange={(e) => handleCustomWidthChange(e.target.value)}
              />
            </div>
            <span className="pb-2 text-theme-text-muted">:</span>
            <div className="flex-1">
              <Input
                label="Height"
                type="number"
                min="1"
                max="100"
                value={customHeight}
                onChange={(e) => handleCustomHeightChange(e.target.value)}
              />
            </div>
            <button
              type="button"
              onClick={handleSavePreset}
              className="mb-[3px] px-3 py-1.5 text-sm rounded-md border border-blue-500/40 text-blue-400 hover:bg-blue-500/10 transition-colors whitespace-nowrap"
              title="Save this ratio as a preset"
            >
              Save preset
            </button>
          </div>
        )}

        {/* Aspect ratio preview — white rectangle scaled to the chosen ratio */}
        <div
          className="flex items-center justify-center rounded-md bg-theme-bg border border-theme-border"
          style={{ height: PREVIEW_MAX_H + 24 }}
        >
          <div
            className="bg-white rounded-sm shadow-md transition-all duration-150"
            style={{ width: previewW, height: previewH }}
          />
        </div>

        <div className="text-xs text-theme-text-muted text-center -mt-2">
          {getCurrentRatio().name.replace(/\s*\(.*\)/, '')} · {resolution.width} × {resolution.height}
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-medium text-theme-text-secondary">
            Photos (optional)
          </label>
          <Button variant="secondary" onClick={handleAddPhotos} className="w-full">
            <svg
              className="w-4 h-4 mr-2"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M12 4v16m8-8H4"
              />
            </svg>
            Add Photos
          </Button>

          {mediaPaths.length > 0 && (
            <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
              {mediaPaths.map((path, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between px-2.5 py-1.5 bg-theme-bg-tertiary rounded text-sm"
                >
                  <span className="text-theme-text-secondary truncate flex-1">
                    {path.split('/').pop()}
                  </span>
                  <button
                    onClick={() => handleRemovePhoto(index)}
                    className="ml-2 text-theme-text-muted hover:text-red-500 transition-colors"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={!isValid || isLoading}>
            {isLoading ? 'Creating...' : 'Create Project'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
