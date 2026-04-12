import { useEffect, useRef, useCallback } from 'react';
import type { Element } from '../../types';
import { useSnapStore, type SnapSettings } from '../../stores/snapStore';
import {
  calculateSnapLines,
  prepareFillLines,
  findFillBounds,
  type FillBounds,
} from '../../utils/snapping';

interface UseCanvasFillModeOptions {
  elements: Element[];
  totalDesignWidth: number;
  designSize: { width: number; height: number };
  numSlides: number;
}

/**
 * Manages fill-mode state: F-key tracking, async pre-computation of fill
 * lines, and fill bounds lookup. Shared between media drop and element drag.
 */
export function useCanvasFillMode({
  elements,
  totalDesignWidth,
  designSize,
  numSlides,
}: UseCanvasFillModeOptions) {
  const snapEnabled = useSnapStore((s) => s.snapEnabled);
  const snapSettings = useSnapStore((s) => s.snapSettings);
  const setFillModeActive = useSnapStore((s) => s.setFillModeActive);

  // Pre-computed fill lines, updated asynchronously
  const fillLinesRef = useRef<{ vertical: number[]; horizontal: number[] } | null>(null);

  // Cache for getFillBoundsExcluding (one entry, keyed by excludeId)
  const excludeCacheRef = useRef<{ id: string; lines: { vertical: number[]; horizontal: number[] } } | null>(null);

  // Invalidate exclude cache when inputs change
  useEffect(() => {
    excludeCacheRef.current = null;
  }, [snapEnabled, snapSettings, elements, totalDesignWidth, designSize.width, designSize.height, numSlides]);

  // Async pre-computation of fill lines whenever inputs change
  const computeIdRef = useRef(0);
  useEffect(() => {
    if (!snapEnabled) {
      fillLinesRef.current = null;
      return;
    }

    // Bump ID so stale completions are ignored
    const id = ++computeIdRef.current;

    // Schedule off the critical path
    requestAnimationFrame(() => {
      if (id !== computeIdRef.current) return; // stale

      const snapLines = calculateSnapLines(
        elements, '__fill_drop__', totalDesignWidth, designSize.height,
        snapSettings, designSize.width, numSlides,
      );
      const result = prepareFillLines(snapLines, designSize.height, totalDesignWidth);

      if (id === computeIdRef.current) {
        fillLinesRef.current = result;
      }
    });
  }, [snapEnabled, snapSettings, elements, totalDesignWidth, designSize.width, designSize.height, numSlides]);

  // F key tracking
  const fillKeyRef = useRef(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'f' || e.key === 'F') {
        const tag = (e.target as HTMLElement).tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (!fillKeyRef.current) {
          fillKeyRef.current = true;
          setFillModeActive(true);
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'f' || e.key === 'F') {
        fillKeyRef.current = false;
        setFillModeActive(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [setFillModeActive]);

  /**
   * Look up fill bounds for a design-space point. Returns null if fill
   * mode isn't active or no fill lines are available.
   */
  const getFillBounds = useCallback((designX: number, designY: number): FillBounds | null => {
    if (!fillKeyRef.current || !fillLinesRef.current) return null;
    const bounds = findFillBounds(designX, designY, fillLinesRef.current.vertical, fillLinesRef.current.horizontal);
    return (bounds.width > 0 && bounds.height > 0) ? bounds : null;
  }, []);

  /**
   * For element drags, we need fill lines that exclude the dragged element.
   * Lines are cached per excludeId so the expensive part runs once per drag,
   * not per mousemove. Cache invalidates via the effect above when deps change.
   */
  const getFillBoundsExcluding = useCallback((designX: number, designY: number, excludeId: string): FillBounds | null => {
    if (!fillKeyRef.current || !snapEnabled) return null;

    let lines: { vertical: number[]; horizontal: number[] };
    if (excludeCacheRef.current && excludeCacheRef.current.id === excludeId) {
      lines = excludeCacheRef.current.lines;
    } else {
      const filteredElements = elements.filter(el => el.id !== excludeId);
      const snapLines = calculateSnapLines(
        filteredElements, '__fill_drag__', totalDesignWidth, designSize.height,
        snapSettings as SnapSettings, designSize.width, numSlides,
      );
      lines = prepareFillLines(snapLines, designSize.height, totalDesignWidth);
      excludeCacheRef.current = { id: excludeId, lines };
    }

    const bounds = findFillBounds(designX, designY, lines.vertical, lines.horizontal);
    return (bounds.width > 0 && bounds.height > 0) ? bounds : null;
  }, [snapEnabled, snapSettings, elements, totalDesignWidth, designSize.width, designSize.height, numSlides]);

  return {
    fillKeyRef,
    fillLinesRef,
    getFillBounds,
    getFillBoundsExcluding,
  };
}
