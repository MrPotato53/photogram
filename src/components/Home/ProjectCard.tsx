import { useState } from 'react';
import clsx from 'clsx';
import type { ProjectSummary } from '../../types';
import { formatAspectRatio } from '../../constants/aspectRatios';
import { ContextMenu, ContextMenuItem } from '../common/ContextMenu';

interface ProjectCardProps {
  project: ProjectSummary;
  onOpen: (id: string) => void;
  onRename: (id: string, currentName: string) => void;
  onDelete: (id: string, name: string) => void;
}

export function ProjectCard({ project, onOpen, onRename, onDelete }: ProjectCardProps) {
  const [contextMenu, setContextMenu] = useState<{
    isOpen: boolean;
    x: number;
    y: number;
  }>({ isOpen: false, x: 0, y: 0 });

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ isOpen: true, x: e.clientX, y: e.clientY });
  };

  const handleDoubleClick = () => {
    onOpen(project.id);
  };

  const handleMenuClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setContextMenu({ isOpen: true, x: rect.left, y: rect.bottom + 4 });
  };

  const closeContextMenu = () => {
    setContextMenu({ ...contextMenu, isOpen: false });
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <>
      <div
        className={clsx(
          'group relative flex flex-col rounded-lg overflow-hidden',
          'bg-theme-bg-secondary border border-theme-border',
          'hover:border-theme-border-hover',
          'transition-all duration-150 cursor-pointer'
        )}
        onContextMenu={handleContextMenu}
        onDoubleClick={handleDoubleClick}
      >
        {/* Thumbnail */}
        <div className="relative aspect-square bg-theme-bg-tertiary flex items-center justify-center">
          {project.thumbnail ? (
            <img
              src={project.thumbnail}
              alt={project.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="text-theme-text-muted">
              <svg
                className="w-12 h-12"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1}
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
            </div>
          )}

          {/* Menu button - visible on hover */}
          <button
            onClick={handleMenuClick}
            className={clsx(
              'absolute top-2 right-2 p-1 rounded',
              'bg-black/40 text-white/80',
              'opacity-0 group-hover:opacity-100',
              'hover:bg-black/60 hover:text-white',
              'transition-all duration-150'
            )}
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="6" r="1.5" />
              <circle cx="12" cy="12" r="1.5" />
              <circle cx="12" cy="18" r="1.5" />
            </svg>
          </button>
        </div>

        {/* Info */}
        <div className="p-2.5 space-y-0.5">
          <h3 className="text-sm font-medium text-theme-text truncate">{project.name}</h3>
          <div className="flex items-center justify-between text-xs">
            <span className="text-theme-text-secondary">{formatAspectRatio(project.aspectRatio)}</span>
            <span className="text-theme-text-muted">{formatDate(project.createdAt)}</span>
          </div>
        </div>
      </div>

      <ContextMenu
        isOpen={contextMenu.isOpen}
        onClose={closeContextMenu}
        position={{ x: contextMenu.x, y: contextMenu.y }}
      >
        <ContextMenuItem
          onClick={() => {
            closeContextMenu();
            onRename(project.id, project.name);
          }}
        >
          Rename
        </ContextMenuItem>
        <ContextMenuItem
          danger
          onClick={() => {
            closeContextMenu();
            onDelete(project.id, project.name);
          }}
        >
          Delete
        </ContextMenuItem>
      </ContextMenu>
    </>
  );
}
