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

  useEffect(() => {
    // Adjust position after render based on actual menu dimensions
    if (isOpen && menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let adjustedX = position.x;
      let adjustedY = position.y;

      // Keep menu within horizontal bounds
      if (adjustedX + rect.width > viewportWidth) {
        adjustedX = viewportWidth - rect.width - 8;
      }

      // Keep menu within vertical bounds
      if (adjustedY + rect.height > viewportHeight) {
        adjustedY = viewportHeight - rect.height - 8;
      }

      // Update position if needed
      if (adjustedX !== position.x || adjustedY !== position.y) {
        menuRef.current.style.left = `${adjustedX}px`;
        menuRef.current.style.top = `${adjustedY}px`;
      }
    }
  }, [isOpen, position.x, position.y]);

  if (!isOpen) return null;

  return (
    <div
      ref={menuRef}
      className={clsx(
        'fixed z-50 py-1 min-w-[140px] max-w-[220px] w-fit',
        'bg-theme-bg-secondary border border-theme-border rounded-md shadow-lg',
        'animate-in fade-in zoom-in-95 duration-100'
      )}
      style={{ left: position.x, top: position.y }}
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
        'w-full px-2.5 py-1.5 text-left text-sm transition-colors whitespace-nowrap',
        danger
          ? 'text-red-500 hover:bg-red-500/10'
          : 'text-theme-text hover:bg-theme-bg-tertiary'
      )}
    >
      {children}
    </button>
  );
}
