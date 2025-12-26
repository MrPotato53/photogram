import { useEffect, useRef, type ReactNode } from 'react';
import clsx from 'clsx';

interface ContextMenuProps {
  isOpen: boolean;
  onClose: () => void;
  position: { x: number; y: number };
  children: ReactNode;
}

export function ContextMenu({ isOpen, onClose, position, children }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEsc);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Adjust position to keep menu in viewport
  const adjustedX = Math.min(position.x, window.innerWidth - 200);
  const adjustedY = Math.min(position.y, window.innerHeight - 150);

  return (
    <div
      ref={menuRef}
      className={clsx(
        'fixed z-50 min-w-[140px] py-1',
        'bg-theme-bg-secondary border border-theme-border rounded-md shadow-lg',
        'animate-in fade-in zoom-in-95 duration-100'
      )}
      style={{ left: adjustedX, top: adjustedY }}
    >
      {children}
    </div>
  );
}

interface ContextMenuItemProps {
  onClick: () => void;
  danger?: boolean;
  children: ReactNode;
}

export function ContextMenuItem({ onClick, danger, children }: ContextMenuItemProps) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'w-full px-3 py-1.5 text-left text-sm transition-colors',
        danger
          ? 'text-red-500 hover:bg-red-500/10'
          : 'text-theme-text hover:bg-theme-bg-tertiary'
      )}
    >
      {children}
    </button>
  );
}
