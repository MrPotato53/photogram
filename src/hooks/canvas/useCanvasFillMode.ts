import { useEffect, useRef, useCallback } from 'react';
import type { Element } from '../../types';
import { useSnapStore, type SnapSettings } from '../../stores/snapStore';
import { isPointInRotatedRect } from '../../utils/coordinates';
import { useElementStore } from '../../stores/elementStore';
import {
  calculateSnapLines,
  prepareFillLines,
  findFillBounds,
  type FillBounds,
} from '../../utils/snapping';

export interface ReplaceTarget {
  elementId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  // 'placeholder' targets are empty frames — the drop converts them to a
  // photo instead of swapping media. Lets previews label the action
  // ("Fill frame" vs "Replace image").
  targetType: 'photo' | 'placeholder';
}

/**
 * Topmost placeholder frame under a design-space point, optionally
 * excluding one element (the one being dragged). Standalone (not hook
 * state) so drop/drag handlers can hit-test frames for F-key fill:
 * fill-region lookup is wrong for frames — a multi-slide frame is split
 * by the slide-boundary snap line, so region fill only covers half of it.
 */
export function findPlaceholderAt(
  elements: Element[],
  designX: number,
  designY: number,
  excludeId?: string
): ReplaceTarget | null {
  const sorted = [...elements].sort((a, b) => b.zIndex - a.zIndex);
  for (const el of sorted) {
    if (excludeId && el.id === excludeId) continue;
    if (el.type !== 'placeholder') continue;
    if (designX >= el.x && designX <= el.x + el.width && designY >= el.y && designY <= el.y + el.height) {
      return { elementId: el.id, x: el.x, y: el.y, width: el.width, height: el.height, targetType: 'placeholder' };
    }
  }
  return null;
}

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
  const setReplaceModeActive = useSnapStore((s) => s.setReplaceModeActive);

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

  // F key tracking (fill mode), R key tracking (replace mode), S key
  // tracking (swap mode).
  // Mutual exclusion: whichever key was pressed first wins; the others are
  // ignored until all are released.
  const fillKeyRef = useRef(false);
  const replaceKeyRef = useRef(false);
  const swapKeyRef = useRef(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === 'f' || e.key === 'F') {
        // Only activate fill if nothing else is already active
        if (!fillKeyRef.current && !replaceKeyRef.current && !swapKeyRef.current) {
          fillKeyRef.current = true;
          setFillModeActive(true);
        }
      }
      if (e.key === 'r' || e.key === 'R') {
        // Only activate replace if nothing else is already active
        if (!replaceKeyRef.current && !fillKeyRef.current && !swapKeyRef.current) {
          replaceKeyRef.current = true;
          setReplaceModeActive(true);
        }
      }
      if (e.key === 's' || e.key === 'S') {
        // Swap only exists DURING a canvas element drag — at rest `s` stays
        // the slides-panel shortcut. Unlike F/R it therefore cannot be armed
        // ahead of the drag; it is pressed once the drag is under way.
        if (!useElementStore.getState().isDraggingElement) return;
        if (!swapKeyRef.current && !fillKeyRef.current && !replaceKeyRef.current) {
          swapKeyRef.current = true;
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'f' || e.key === 'F') {
        fillKeyRef.current = false;
        setFillModeActive(false);
      }
      if (e.key === 'r' || e.key === 'R') {
        replaceKeyRef.current = false;
        setReplaceModeActive(false);
      }
      if (e.key === 's' || e.key === 'S') {
        swapKeyRef.current = false;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [setFillModeActive, setReplaceModeActive]);

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

  /**
   * Find the topmost replaceable element under the given design-space
   * point, optionally excluding a specific element (the one being dragged).
   * Targets are photos with media (swap the image) AND placeholder frames
   * (fill the frame) — the drop handler branches on targetType.
   */
  const getReplacementTarget = useCallback((designX: number, designY: number, excludeId?: string): ReplaceTarget | null => {
    if (!replaceKeyRef.current) return null;

    // Iterate in reverse z-order (highest zIndex first)
    const sorted = [...elements].sort((a, b) => b.zIndex - a.zIndex);
    for (const el of sorted) {
      if (excludeId && el.id === excludeId) continue;
      const isPhotoTarget = el.type === 'photo' && !!el.mediaId;
      const isFrameTarget = el.type === 'placeholder';
      if (!isPhotoTarget && !isFrameTarget) continue;
      // Rotation-exact: a tilted frame must be hittable where it is drawn,
      // not where its unrotated box would have been.
      if (isPointInRotatedRect(designX, designY, el.x, el.y, el.width, el.height, el.rotation)) {
        return {
          elementId: el.id,
          x: el.x,
          y: el.y,
          width: el.width,
          height: el.height,
          targetType: isFrameTarget ? 'placeholder' : 'photo',
        };
      }
    }
    return null;
  }, [elements]);

  /**
   * Swap target under a design-space point: another photo, or an EMPTY
   * frame. Trading with an empty frame is a real workflow — it moves the
   * image across and leaves an empty frame behind, ready for another photo
   * — which is why placeholders are valid here even though replace/fill
   * also accept them.
   */
  const getSwapTarget = useCallback((designX: number, designY: number, excludeId?: string): ReplaceTarget | null => {
    if (!swapKeyRef.current) return null;

    // Topmost first, matching the other target lookups.
    const sorted = [...elements].sort((a, b) => b.zIndex - a.zIndex);
    for (const el of sorted) {
      if (excludeId && el.id === excludeId) continue;
      const isPhoto = el.type === 'photo' && !!el.mediaId;
      const isFrame = el.type === 'placeholder';
      if (!isPhoto && !isFrame) continue;
      if (isPointInRotatedRect(designX, designY, el.x, el.y, el.width, el.height, el.rotation)) {
        return {
          elementId: el.id,
          x: el.x,
          y: el.y,
          width: el.width,
          height: el.height,
          targetType: isFrame ? 'placeholder' : 'photo',
        };
      }
    }
    return null;
  }, [elements]);

  return {
    fillKeyRef,
    replaceKeyRef,
    swapKeyRef,
    getSwapTarget,
    fillLinesRef,
    getFillBounds,
    getFillBoundsExcluding,
    getReplacementTarget,
  };
}
