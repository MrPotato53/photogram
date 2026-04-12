import { useEffect, useCallback, useRef } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { MediaItem } from '../../types';

// Max number of full-resolution images kept in the cache at once.
const MAX_CACHE_SIZE = 5;

interface MediaPreviewModalProps {
  mediaPool: MediaItem[];
  currentIndex: number;
  onNavigate: (index: number) => void;
  onClose: () => void;
}

/**
 * Simple bounded cache: maps filePath → object URL (or asset URL).
 * Evicts oldest entries when size exceeds MAX_CACHE_SIZE.
 */
class PreviewCache {
  private map = new Map<string, string>(); // filePath → src url
  private order: string[] = []; // insertion order for LRU eviction

  get(filePath: string): string | undefined {
    return this.map.get(filePath);
  }

  set(filePath: string, src: string) {
    if (this.map.has(filePath)) return;
    this.map.set(filePath, src);
    this.order.push(filePath);
    this.evict();
  }

  private evict() {
    while (this.order.length > MAX_CACHE_SIZE) {
      const oldest = this.order.shift()!;
      this.map.delete(oldest);
    }
  }

  clear() {
    this.map.clear();
    this.order.length = 0;
  }
}

export function MediaPreviewModal({
  mediaPool,
  currentIndex,
  onNavigate,
  onClose,
}: MediaPreviewModalProps) {
  const cacheRef = useRef(new PreviewCache());
  const current = mediaPool[currentIndex];
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < mediaPool.length - 1;

  // Resolve src for current image (always synchronous via convertFileSrc)
  const currentSrc = convertFileSrc(current.filePath);
  cacheRef.current.set(current.filePath, currentSrc);

  // Preload adjacent images asynchronously
  useEffect(() => {
    const cache = cacheRef.current;
    const toPreload: string[] = [];
    if (currentIndex > 0) toPreload.push(mediaPool[currentIndex - 1].filePath);
    if (currentIndex < mediaPool.length - 1) toPreload.push(mediaPool[currentIndex + 1].filePath);

    for (const filePath of toPreload) {
      if (cache.get(filePath)) continue;
      const src = convertFileSrc(filePath);
      cache.set(filePath, src);
      // Kick off actual decode in background — non-blocking
      const img = new Image();
      img.decoding = 'async';
      img.src = src;
    }
  }, [currentIndex, mediaPool]);

  // Clean up cache on unmount
  useEffect(() => {
    const cache = cacheRef.current;
    return () => cache.clear();
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft' && hasPrev) {
        onNavigate(currentIndex - 1);
      } else if (e.key === 'ArrowRight' && hasNext) {
        onNavigate(currentIndex + 1);
      }
    },
    [onClose, onNavigate, currentIndex, hasPrev, hasNext]
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

      {/* File name + position */}
      <div className="absolute top-4 left-4 text-white/70 text-sm">
        {current.fileName}
        <span className="ml-2 text-white/40">{currentIndex + 1} / {mediaPool.length}</span>
      </div>

      {/* Prev arrow */}
      {hasPrev && (
        <button
          onClick={(e) => { e.stopPropagation(); onNavigate(currentIndex - 1); }}
          className="absolute left-4 top-1/2 -translate-y-1/2 p-2 text-white/50 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
        >
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      )}

      {/* Image */}
      <img
        src={currentSrc}
        alt={current.fileName}
        className="max-w-[90vw] max-h-[90vh] object-contain"
        draggable={false}
      />

      {/* Next arrow */}
      {hasNext && (
        <button
          onClick={(e) => { e.stopPropagation(); onNavigate(currentIndex + 1); }}
          className="absolute right-4 top-1/2 -translate-y-1/2 p-2 text-white/50 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
        >
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      )}

      {/* Instructions */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/50 text-xs">
        ← → to navigate · Escape to close
      </div>
    </div>
  );
}
