import { useState, useCallback, useRef, useEffect } from 'react';
import { useEditorStore } from '../../../stores/editorStore';
import { useTemplatesStore } from '../../../stores/templatesStore';
import type { Template } from '../../../types';
import { ContextMenu, ContextMenuItem } from '../../common/ContextMenu';

import { DESIGN_HEIGHT, getSlideWidth } from '../../../utils/designConstants';
const MAX_SLIDES = 20;
const DRAG_THRESHOLD = 5;

interface TemplatePreviewProps {
  template: Template;
  designWidth: number;
  onDoubleClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  isDragging: boolean;
  dropIndicator: 'left' | 'right' | null;
  onMouseDown: (e: React.MouseEvent) => void;
}

function TemplatePreview({
  template,
  designWidth,
  onDoubleClick,
  onContextMenu,
  isDragging,
  dropIndicator,
  onMouseDown,
}: TemplatePreviewProps) {
  // Scale to fit within a small preview box
  const previewHeight = 60;
  const previewWidth = (previewHeight * designWidth) / DESIGN_HEIGHT;
  const scale = previewHeight / DESIGN_HEIGHT;

  return (
    <div
      className={`relative rounded overflow-hidden bg-white cursor-grab transition-all hover:ring-2 hover:ring-blue-500 ${
        isDragging ? 'opacity-30 scale-95' : ''
      }`}
      style={{ width: previewWidth, height: previewHeight }}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onMouseDown={onMouseDown}
      data-template-id={template.id}
      title={`Double-click to add slide with: ${template.name}`}
    >
      {/* Drop indicator - left */}
      {dropIndicator === 'left' && (
        <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-blue-500 -translate-x-1.5 z-20 rounded-full shadow-[0_0_4px_rgba(59,130,246,0.5)]" />
      )}
      {/* Drop indicator - right */}
      {dropIndicator === 'right' && (
        <div className="absolute right-0 top-0 bottom-0 w-0.5 bg-blue-500 translate-x-1.5 z-20 rounded-full shadow-[0_0_4px_rgba(59,130,246,0.5)]" />
      )}

      {/* Render placeholder rectangles for each element */}
      {template.elements.map((el) => (
        <div
          key={el.id}
          className="absolute bg-gray-300 border border-gray-400"
          style={{
            left: el.x * scale,
            top: el.y * scale,
            width: el.width * scale,
            height: el.height * scale,
            transform: `rotate(${el.rotation}deg)`,
          }}
        />
      ))}

      {/* Template name */}
      <div className="absolute bottom-0 left-0 right-0 px-1 py-0.5 bg-black/60 text-white text-[9px] truncate">
        {template.name}
      </div>
    </div>
  );
}

export function TemplatesPanel() {
  const { project, addSlideWithTemplate } = useEditorStore();
  const {
    templates,
    saveSlideAsTemplate,
    deleteTemplate,
    renameTemplate,
    reorderTemplates,
    getTemplatesForAspectRatio,
  } = useTemplatesStore();

  const gridRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<{
    isOpen: boolean;
    position: { x: number; y: number };
    templateId: string | null;
  }>({ isOpen: false, position: { x: 0, y: 0 }, templateId: null });
  const [isRenaming, setIsRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Drag state
  const [draggedTemplateId, setDraggedTemplateId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [dropSide, setDropSide] = useState<'left' | 'right' | null>(null);
  const isDraggingRef = useRef(false);
  const dragStartPos = useRef<{ x: number; y: number } | null>(null);
  const pendingDragId = useRef<string | null>(null);

  const designWidth = project ? getSlideWidth(project.aspectRatio) : 1920;

  // Get templates matching the current project's aspect ratio
  const matchingTemplates = project
    ? getTemplatesForAspectRatio(project.aspectRatio)
    : [];

  const slides = project?.slides || [];
  const canAddSlide = slides.length < MAX_SLIDES;

  // Focus rename input when it appears
  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [isRenaming]);

  // Handle mouse move/up for dragging
  useEffect(() => {
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
  }, [draggedTemplateId, dropTargetId, dropSide, matchingTemplates, reorderTemplates]);

  const handleSaveCurrentSlide = useCallback(() => {
    if (!project) return;
    const currentSlideIndex = useEditorStore.getState().currentSlideIndex;
    const templateName = `Template ${templates.length + 1}`;
    saveSlideAsTemplate(
      currentSlideIndex,
      templateName,
      project.aspectRatio,
      project.elements,
      designWidth
    );
  }, [templates.length, saveSlideAsTemplate, project, designWidth]);

  const handleAddSlideWithTemplate = useCallback((template: Template) => {
    if (!canAddSlide) return;
    addSlideWithTemplate(template);
  }, [canAddSlide, addSlideWithTemplate]);

  const handleMouseDown = useCallback((e: React.MouseEvent, templateId: string) => {
    if (e.button !== 0) return;
    pendingDragId.current = templateId;
    dragStartPos.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent, templateId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      isOpen: true,
      position: { x: e.clientX, y: e.clientY },
      templateId,
    });
  }, []);

  const handleDelete = useCallback(() => {
    if (contextMenu.templateId) {
      deleteTemplate(contextMenu.templateId);
    }
    setContextMenu({ ...contextMenu, isOpen: false });
  }, [contextMenu, deleteTemplate]);

  const handleStartRename = useCallback(() => {
    if (contextMenu.templateId) {
      const template = templates.find((t) => t.id === contextMenu.templateId);
      if (template) {
        setRenameValue(template.name);
        setIsRenaming(contextMenu.templateId);
      }
    }
    setContextMenu({ ...contextMenu, isOpen: false });
  }, [contextMenu, templates]);

  const handleConfirmRename = useCallback(() => {
    if (isRenaming && renameValue.trim()) {
      renameTemplate(isRenaming, renameValue.trim());
    }
    setIsRenaming(null);
    setRenameValue('');
  }, [isRenaming, renameValue, renameTemplate]);

  const handleCancelRename = useCallback(() => {
    setIsRenaming(null);
    setRenameValue('');
  }, []);

  const getDropIndicator = (templateId: string): 'left' | 'right' | null => {
    if (dropTargetId !== templateId || !draggedTemplateId) return null;
    if (draggedTemplateId === templateId) return null;
    return dropSide;
  };

  if (matchingTemplates.length === 0) {
    return (
      <div className="p-3 h-full flex flex-col">
        <div className="flex-1 flex flex-col items-center justify-center text-theme-text-muted">
          <svg
            className="w-10 h-10 mb-2 opacity-50"
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
          <p className="text-sm text-center">No templates</p>
          <p className="text-xs text-center mt-1 opacity-70">
            Right-click a slide to save it as a template
          </p>
        </div>

        {/* Save template button */}
        <button
          onClick={handleSaveCurrentSlide}
          className="mt-3 w-full py-2 border border-dashed border-theme-border rounded text-sm text-theme-text-secondary hover:border-blue-500 hover:text-blue-500 transition-colors"
        >
          + Save Current Slide as Template
        </button>
      </div>
    );
  }

  return (
    <div className="p-3 h-full flex flex-col">
      <div className="text-xs text-theme-text-muted mb-2">
        Double-click to add slide. Right-click to manage. Drag to reorder.
      </div>

      {/* Rename input */}
      {isRenaming && (
        <div className="mb-2 flex gap-1">
          <input
            ref={renameInputRef}
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleConfirmRename();
              if (e.key === 'Escape') handleCancelRename();
            }}
            className="flex-1 px-2 py-1 text-sm bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:border-blue-500"
            placeholder="Template name"
          />
          <button
            onClick={handleConfirmRename}
            className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Save
          </button>
          <button
            onClick={handleCancelRename}
            className="px-2 py-1 text-xs bg-gray-600 text-white rounded hover:bg-gray-500"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Templates grid */}
      <div className="flex-1 overflow-y-auto">
        <div ref={gridRef} className="flex flex-wrap gap-2">
          {matchingTemplates.map((template) => (
            <TemplatePreview
              key={template.id}
              template={template}
              designWidth={designWidth}
              onDoubleClick={() => handleAddSlideWithTemplate(template)}
              onContextMenu={(e) => handleContextMenu(e, template.id)}
              isDragging={draggedTemplateId === template.id}
              dropIndicator={getDropIndicator(template.id)}
              onMouseDown={(e) => handleMouseDown(e, template.id)}
            />
          ))}
        </div>
      </div>

      {/* Save template button */}
      <button
        onClick={handleSaveCurrentSlide}
        className="mt-3 w-full py-2 border border-dashed border-theme-border rounded text-sm text-theme-text-secondary hover:border-blue-500 hover:text-blue-500 transition-colors"
      >
        + Save Current Slide as Template
      </button>

      {/* Context menu */}
      <ContextMenu
        isOpen={contextMenu.isOpen}
        onClose={() => setContextMenu({ ...contextMenu, isOpen: false })}
        position={contextMenu.position}
      >
        <ContextMenuItem
          onClick={() => {
            const template = matchingTemplates.find((t) => t.id === contextMenu.templateId);
            if (template && canAddSlide) {
              handleAddSlideWithTemplate(template);
            }
            setContextMenu({ ...contextMenu, isOpen: false });
          }}
        >
          Add Slide with Template
        </ContextMenuItem>
        <ContextMenuItem onClick={handleStartRename}>
          Rename
        </ContextMenuItem>
        <ContextMenuItem onClick={handleDelete} danger>
          Delete
        </ContextMenuItem>
      </ContextMenu>
    </div>
  );
}
