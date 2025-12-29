import { useState, useCallback, useRef, useEffect } from 'react';
import { Stage, Layer, Rect } from 'react-konva';
import type { Template, AspectRatio } from '../../types';
import { useTemplatesStore } from '../../stores/templatesStore';

const PREVIEW_HEIGHT = 80;
const DRAG_THRESHOLD = 5;

interface TemplateCardProps {
  template: Template;
  isSelected: boolean;
  isDragging: boolean;
  dropIndicator: 'left' | 'right' | null;
  onSelect: () => void;
  onDoubleClick: () => void;
  onMouseDown: (e: React.MouseEvent) => void;
}

function TemplateCard({
  template,
  isSelected,
  isDragging,
  dropIndicator,
  onSelect,
  onDoubleClick,
  onMouseDown,
}: TemplateCardProps) {
  const previewWidth = (PREVIEW_HEIGHT * template.aspectRatio.width) / template.aspectRatio.height;
  const scale = PREVIEW_HEIGHT / 1080;

  return (
    <div
      className={`relative rounded-lg overflow-hidden cursor-pointer transition-all ${
        isSelected ? 'ring-2 ring-blue-500' : 'ring-1 ring-gray-600 hover:ring-gray-500'
      } ${isDragging ? 'opacity-50' : ''}`}
      style={{ width: previewWidth + 16, padding: 8 }}
      onClick={onSelect}
      onDoubleClick={onDoubleClick}
      onMouseDown={onMouseDown}
      data-template-id={template.id}
    >
      {/* Drop indicator - left */}
      {dropIndicator === 'left' && (
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-500 -translate-x-1 z-20 rounded" />
      )}
      {/* Drop indicator - right */}
      {dropIndicator === 'right' && (
        <div className="absolute right-0 top-0 bottom-0 w-1 bg-blue-500 translate-x-1 z-20 rounded" />
      )}

      {/* Preview */}
      <div
        className="rounded overflow-hidden bg-white mx-auto"
        style={{ width: previewWidth, height: PREVIEW_HEIGHT }}
      >
        <Stage width={previewWidth} height={PREVIEW_HEIGHT}>
          <Layer>
            <Rect x={0} y={0} width={previewWidth} height={PREVIEW_HEIGHT} fill="white" />
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

      {/* Template name */}
      <div className="mt-2 text-xs text-gray-300 text-center truncate">
        {template.name}
      </div>
    </div>
  );
}

interface TemplatesManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  aspectRatio: AspectRatio;
}

export function TemplatesManagementModal({
  isOpen,
  onClose,
  aspectRatio,
}: TemplatesManagementModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const {
    deleteTemplate,
    renameTemplate,
    reorderTemplates,
    getTemplatesForAspectRatio,
  } = useTemplatesStore();

  const matchingTemplates = getTemplatesForAspectRatio(aspectRatio);

  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Drag state
  const [draggedTemplateId, setDraggedTemplateId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [dropSide, setDropSide] = useState<'left' | 'right' | null>(null);
  const isDraggingRef = useRef(false);
  const dragStartPos = useRef<{ x: number; y: number } | null>(null);
  const pendingDragId = useRef<string | null>(null);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isRenaming) {
          setIsRenaming(false);
          setRenameValue('');
        } else {
          onClose();
        }
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedTemplateId && !isRenaming) {
          e.preventDefault();
          deleteTemplate(selectedTemplateId);
          setSelectedTemplateId(null);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, selectedTemplateId, isRenaming, deleteTemplate]);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const timer = setTimeout(() => {
      window.addEventListener('mousedown', handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  // Focus rename input
  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [isRenaming]);

  // Handle mouse move/up for dragging
  useEffect(() => {
    if (!isOpen) return;

    const handleMouseMove = (e: MouseEvent) => {
      // Check if we have a pending drag that hasn't started yet
      if (pendingDragId.current && dragStartPos.current && !isDraggingRef.current) {
        const dx = e.clientX - dragStartPos.current.x;
        const dy = e.clientY - dragStartPos.current.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance >= DRAG_THRESHOLD) {
          isDraggingRef.current = true;
          setDraggedTemplateId(pendingDragId.current);
          document.body.style.cursor = 'grabbing';
        }
        return;
      }

      if (!isDraggingRef.current || !draggedTemplateId || !gridRef.current) return;

      // Find which template we're over
      const templateElements = gridRef.current.querySelectorAll('[data-template-id]');
      for (const el of templateElements) {
        const rect = el.getBoundingClientRect();
        if (e.clientX >= rect.left && e.clientX <= rect.right &&
            e.clientY >= rect.top && e.clientY <= rect.bottom) {
          const templateId = el.getAttribute('data-template-id');
          if (templateId && templateId !== draggedTemplateId) {
            const midpoint = rect.left + rect.width / 2;
            const side = e.clientX < midpoint ? 'left' : 'right';
            setDropTargetId(templateId);
            setDropSide(side);
            return;
          }
        }
      }
      setDropTargetId(null);
      setDropSide(null);
    };

    const handleMouseUp = () => {
      if (pendingDragId.current && !isDraggingRef.current) {
        // Was just a click, not a drag
        pendingDragId.current = null;
        dragStartPos.current = null;
        return;
      }

      if (!isDraggingRef.current) return;

      // Execute reorder
      if (dropTargetId && dropSide && draggedTemplateId && draggedTemplateId !== dropTargetId) {
        const currentOrder = matchingTemplates.map((t) => t.id);
        const draggedIndex = currentOrder.indexOf(draggedTemplateId);
        let targetIndex = currentOrder.indexOf(dropTargetId);

        if (dropSide === 'right') {
          targetIndex += 1;
        }
        if (draggedIndex < targetIndex) {
          targetIndex -= 1;
        }

        const newOrder = [...currentOrder];
        newOrder.splice(draggedIndex, 1);
        newOrder.splice(targetIndex, 0, draggedTemplateId);
        reorderTemplates(newOrder);
      }

      // Reset state
      isDraggingRef.current = false;
      pendingDragId.current = null;
      dragStartPos.current = null;
      setDraggedTemplateId(null);
      setDropTargetId(null);
      setDropSide(null);
      document.body.style.cursor = '';
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isOpen, draggedTemplateId, dropTargetId, dropSide, matchingTemplates, reorderTemplates]);

  const handleMouseDown = useCallback((e: React.MouseEvent, templateId: string) => {
    if (e.button !== 0) return;
    pendingDragId.current = templateId;
    dragStartPos.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleStartRename = useCallback(() => {
    if (selectedTemplateId) {
      const template = matchingTemplates.find((t) => t.id === selectedTemplateId);
      if (template) {
        setRenameValue(template.name);
        setIsRenaming(true);
      }
    }
  }, [selectedTemplateId, matchingTemplates]);

  const handleConfirmRename = useCallback(() => {
    if (selectedTemplateId && renameValue.trim()) {
      renameTemplate(selectedTemplateId, renameValue.trim());
    }
    setIsRenaming(false);
    setRenameValue('');
  }, [selectedTemplateId, renameValue, renameTemplate]);

  const handleDelete = useCallback(() => {
    if (selectedTemplateId) {
      deleteTemplate(selectedTemplateId);
      setSelectedTemplateId(null);
    }
  }, [selectedTemplateId, deleteTemplate]);

  const getDropIndicator = (templateId: string): 'left' | 'right' | null => {
    if (dropTargetId !== templateId || !draggedTemplateId) return null;
    if (draggedTemplateId === templateId) return null;
    return dropSide;
  };

  const selectedTemplate = selectedTemplateId
    ? matchingTemplates.find((t) => t.id === selectedTemplateId)
    : null;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        ref={modalRef}
        className="bg-gray-800 rounded-xl shadow-2xl border border-gray-700 w-[600px] max-h-[80vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <h2 className="text-lg font-medium text-white">Manage Templates</h2>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Toolbar */}
        {selectedTemplate && (
          <div className="px-4 py-2 border-b border-gray-700 flex items-center gap-2">
            {isRenaming ? (
              <div className="flex items-center gap-2 flex-1">
                <input
                  ref={renameInputRef}
                  type="text"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleConfirmRename();
                    if (e.key === 'Escape') {
                      setIsRenaming(false);
                      setRenameValue('');
                    }
                  }}
                  className="flex-1 px-2 py-1 text-sm bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:border-blue-500"
                  placeholder="Template name"
                />
                <button
                  onClick={handleConfirmRename}
                  className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
                >
                  Save
                </button>
                <button
                  onClick={() => { setIsRenaming(false); setRenameValue(''); }}
                  className="px-3 py-1 text-sm bg-gray-600 text-white rounded hover:bg-gray-500"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <>
                <span className="text-sm text-gray-300 flex-1 truncate">
                  {selectedTemplate.name}
                </span>
                <button
                  onClick={handleStartRename}
                  className="px-3 py-1 text-sm text-gray-300 hover:text-white hover:bg-gray-700 rounded transition-colors"
                >
                  Rename
                </button>
                <button
                  onClick={handleDelete}
                  className="px-3 py-1 text-sm text-red-400 hover:text-red-300 hover:bg-gray-700 rounded transition-colors"
                >
                  Delete
                </button>
              </>
            )}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {matchingTemplates.length === 0 ? (
            <div className="text-center py-12">
              <svg
                className="w-16 h-16 mx-auto mb-4 text-gray-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1}
                  d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z"
                />
              </svg>
              <p className="text-gray-400 mb-2">No templates for this aspect ratio</p>
              <p className="text-gray-500 text-sm">
                Right-click on a slide and select "Save Slide as Template" to create one.
              </p>
            </div>
          ) : (
            <>
              <p className="text-xs text-gray-500 mb-3">
                Click to select. Double-click to rename. Drag to reorder. Press Delete to remove.
              </p>
              <div ref={gridRef} className="flex flex-wrap gap-3">
                {matchingTemplates.map((template) => (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    isSelected={selectedTemplateId === template.id}
                    isDragging={draggedTemplateId === template.id}
                    dropIndicator={getDropIndicator(template.id)}
                    onSelect={() => setSelectedTemplateId(template.id)}
                    onDoubleClick={handleStartRename}
                    onMouseDown={(e) => handleMouseDown(e, template.id)}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-700 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
