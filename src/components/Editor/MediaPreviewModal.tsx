import { useEffect, useCallback } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';

interface MediaPreviewModalProps {
  filePath: string;
  fileName: string;
  onClose: () => void;
}

export function MediaPreviewModal({ filePath, fileName, onClose }: MediaPreviewModalProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90"
      onClick={handleBackdropClick}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>

      {/* File name */}
      <div className="absolute top-4 left-4 text-white/70 text-sm">{fileName}</div>

      {/* Image */}
      <img
        src={convertFileSrc(filePath)}
        alt={fileName}
        className="max-w-[90vw] max-h-[90vh] object-contain"
        draggable={false}
      />

      {/* Instructions */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/50 text-xs">
        Press Escape or click outside to close
      </div>
    </div>
  );
}
