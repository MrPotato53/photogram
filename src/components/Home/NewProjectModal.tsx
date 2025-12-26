import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { Modal, Button, Input, Select } from '../common';
import { ASPECT_RATIOS, getResolution } from '../../constants/aspectRatios';
import type { AspectRatio } from '../../types';

interface NewProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string, aspectRatio: AspectRatio, mediaPaths: string[]) => void;
  existingNames: string[];
}

export function NewProjectModal({ isOpen, onClose, onCreate, existingNames }: NewProjectModalProps) {
  const [name, setName] = useState('');
  const [selectedRatioIndex, setSelectedRatioIndex] = useState(0);
  const [isCustom, setIsCustom] = useState(false);
  const [customWidth, setCustomWidth] = useState('4');
  const [customHeight, setCustomHeight] = useState('5');
  const [mediaPaths, setMediaPaths] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const trimmedName = name.trim();
  const isDuplicate = existingNames.some(
    (n) => n.toLowerCase() === trimmedName.toLowerCase()
  );
  const isValid = trimmedName.length > 0 && !isDuplicate;

  const aspectRatioOptions = [
    ...ASPECT_RATIOS.map((ar, index) => ({
      value: String(index),
      label: ar.name,
    })),
    { value: 'custom', label: 'Custom' },
  ];

  const handleRatioChange = (value: string) => {
    if (value === 'custom') {
      setIsCustom(true);
    } else {
      setIsCustom(false);
      setSelectedRatioIndex(Number(value));
    }
  };

  const handleAddPhotos = async () => {
    try {
      const files = await open({
        multiple: true,
        filters: [
          {
            name: 'Images',
            extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'],
          },
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

  const getAspectRatio = (): AspectRatio => {
    if (isCustom) {
      const w = Math.max(1, parseInt(customWidth) || 1);
      const h = Math.max(1, parseInt(customHeight) || 1);
      return { width: w, height: h, name: `Custom (${w}:${h})` };
    }
    return ASPECT_RATIOS[selectedRatioIndex];
  };

  const handleCreate = async () => {
    if (!isValid) return;

    setIsLoading(true);
    try {
      await onCreate(trimmedName, getAspectRatio(), mediaPaths);
      handleClose();
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setName('');
    setSelectedRatioIndex(0);
    setIsCustom(false);
    setCustomWidth('4');
    setCustomHeight('5');
    setMediaPaths([]);
    onClose();
  };

  const currentRatio = getAspectRatio();
  const resolution = getResolution(currentRatio);

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

        <Select
          label="Aspect Ratio"
          options={aspectRatioOptions}
          value={isCustom ? 'custom' : String(selectedRatioIndex)}
          onChange={(e) => handleRatioChange(e.target.value)}
        />

        {isCustom && (
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <Input
                label="Width"
                type="number"
                min="1"
                max="100"
                value={customWidth}
                onChange={(e) => setCustomWidth(e.target.value)}
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
                onChange={(e) => setCustomHeight(e.target.value)}
              />
            </div>
          </div>
        )}

        <div className="text-xs text-theme-text-muted">
          Resolution: {resolution.width} x {resolution.height}
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
