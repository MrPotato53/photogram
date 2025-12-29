import { useEffect, useRef, useState } from 'react';
import { Stage, Layer, Rect } from 'react-konva';
import type { Template, AspectRatio } from '../../types';
import { useTemplatesStore } from '../../stores/templatesStore';
import { TemplatesManagementModal } from './TemplatesManagementModal';

const PREVIEW_HEIGHT = 100;

interface TemplatePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (template: Template) => void;
  aspectRatio: AspectRatio;
}

function TemplatePreview({
  template,
  onClick,
}: {
  template: Template;
  onClick: () => void;
}) {
  const previewWidth = (PREVIEW_HEIGHT * template.aspectRatio.width) / template.aspectRatio.height;
  const scale = PREVIEW_HEIGHT / 1080; // DESIGN_HEIGHT

  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-2 p-2 rounded-lg hover:bg-gray-700 transition-colors"
    >
      <div
        className="rounded overflow-hidden ring-1 ring-gray-600"
        style={{ width: previewWidth, height: PREVIEW_HEIGHT }}
      >
        <Stage width={previewWidth} height={PREVIEW_HEIGHT}>
          <Layer>
            {/* White background */}
            <Rect x={0} y={0} width={previewWidth} height={PREVIEW_HEIGHT} fill="white" />

            {/* Render placeholder frames */}
            {template.elements.map((element) => (
              <Rect
                key={element.id}
                x={element.x * scale}
                y={element.y * scale}
                width={element.width * scale}
                height={element.height * scale}
                rotation={element.rotation}
                fill="#e5e7eb"
                stroke="#d1d5db"
                strokeWidth={1}
              />
            ))}
          </Layer>
        </Stage>
      </div>
      <span className="text-xs text-gray-300 truncate max-w-[120px]">{template.name}</span>
    </button>
  );
}

export function TemplatePickerModal({
  isOpen,
  onClose,
  onSelect,
  aspectRatio,
}: TemplatePickerModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const { getTemplatesForAspectRatio } = useTemplatesStore();
  const [isManagementOpen, setIsManagementOpen] = useState(false);

  const matchingTemplates = getTemplatesForAspectRatio(aspectRatio);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen || isManagementOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isManagementOpen, onClose]);

  // Close on click outside
  useEffect(() => {
    if (!isOpen || isManagementOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    // Delay to prevent immediate close
    const timer = setTimeout(() => {
      window.addEventListener('mousedown', handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, isManagementOpen, onClose]);

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div
          ref={modalRef}
          className="bg-gray-800 rounded-xl shadow-2xl border border-gray-700 max-w-lg w-full max-h-[80vh] flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
            <h2 className="text-lg font-medium text-white">Select a Template</h2>
            <button
              onClick={onClose}
              className="p-1 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4">
            {matchingTemplates.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-400 mb-2">No templates for this aspect ratio.</p>
                <p className="text-gray-500 text-sm">
                  Right-click on a slide and select "Save Slide as Template" to create one.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                {matchingTemplates.map((template) => (
                  <TemplatePreview
                    key={template.id}
                    template={template}
                    onClick={() => onSelect(template)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-3 border-t border-gray-700 flex justify-between">
            <button
              onClick={() => setIsManagementOpen(true)}
              className="px-4 py-2 text-sm text-gray-300 hover:text-white hover:bg-gray-700 rounded-lg transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Manage Templates
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-300 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>

      {/* Management Modal */}
      <TemplatesManagementModal
        isOpen={isManagementOpen}
        onClose={() => setIsManagementOpen(false)}
        aspectRatio={aspectRatio}
      />
    </>
  );
}
