import { useEffect, useState, useRef, useMemo } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { Element } from '../../types';
import { useProjectStore } from '../../stores/projectStore';
import { preloadImage, getCachedImage } from '../../utils/imageCache';

/**
 * Hook for loading and managing images for canvas elements.
 * Uses a module-level image cache so preloads started elsewhere (e.g.
 * media-pool drag start) are reused without reloading. Falls back to
 * the media's thumbnail while the full-size image is still decoding.
 */
export function useCanvasImages(elements: Element[]) {
  const [loadedImages, setLoadedImages] = useState<Map<string, HTMLImageElement>>(new Map());
  const project = useProjectStore((s) => s.project);

  // Track the image-relevant parts of elements to detect actual changes
  // Only id, mediaId, and assetPath matter for image loading - position changes are ignored
  const imageRelevantKey = useMemo(() => {
    return elements
      .filter((el) => el.type === 'photo' && el.mediaId)
      .map((el) => `${el.id}:${el.mediaId}:${el.assetPath || ''}`)
      .join('|');
  }, [elements]);

  const lastProcessedKeyRef = useRef<string>('');
  const loadedImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  // Tracks which URL each element is currently displaying so we can detect
  // when a swap is needed (thumbnail → full, or media changed)
  const elementSrcRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (imageRelevantKey === lastProcessedKeyRef.current) return;
    lastProcessedKeyRef.current = imageRelevantKey;

    const currentImages = loadedImagesRef.current;
    const newLoadedImages = new Map<string, HTMLImageElement>();
    const elementTargets = new Map<string, { fullUrl: string; thumbUrl: string | null }>();

    // Pass 1: synchronously build map from cache + thumbnail fallback.
    // No awaits here — this path must be instant so the drop doesn't block.
    for (const element of elements) {
      if (element.type !== 'photo' || !element.mediaId) continue;

      const media = project?.mediaPool.find((m) => m.id === element.mediaId);
      const fullPath = element.assetPath || media?.filePath;
      const thumbPath = media?.thumbnailPath || null;
      if (!fullPath) continue;

      const fullUrl = convertFileSrc(fullPath);
      const thumbUrl = thumbPath ? convertFileSrc(thumbPath) : null;
      elementTargets.set(element.id, { fullUrl, thumbUrl });

      // Reuse existing if its source matches the full URL
      const existing = currentImages.get(element.id);
      if (existing && existing.complete && existing.naturalWidth > 0 && existing.src === fullUrl) {
        newLoadedImages.set(element.id, existing);
        continue;
      }

      // Full image in cache — use it instantly
      const cachedFull = getCachedImage(fullUrl);
      if (cachedFull) {
        newLoadedImages.set(element.id, cachedFull);
        continue;
      }

      // Thumbnail as placeholder while full image loads
      if (thumbUrl) {
        const cachedThumb = getCachedImage(thumbUrl);
        if (cachedThumb) {
          newLoadedImages.set(element.id, cachedThumb);
        }
      }
    }

    // Update display map immediately with whatever is ready
    const prev = loadedImagesRef.current;
    const changed =
      newLoadedImages.size !== prev.size ||
      [...newLoadedImages].some(([k, v]) => prev.get(k) !== v);
    if (changed) {
      loadedImagesRef.current = newLoadedImages;
      setLoadedImages(newLoadedImages);
    }

    // Pass 2: kick off async loads for anything not yet at full res.
    // Runs in parallel; each completion swaps its element's image in.
    for (const element of elements) {
      if (element.type !== 'photo' || !element.mediaId) continue;
      const target = elementTargets.get(element.id);
      if (!target) continue;

      const currentlyShown = loadedImagesRef.current.get(element.id);
      if (currentlyShown && currentlyShown.src === target.fullUrl) continue;

      // Start full-image load in parallel (preloadImage dedupes in-flight requests)
      preloadImage(target.fullUrl).then((img) => {
        if (!img) return;
        // Stale guard: only apply if the element still needs this URL
        const stillNeeded = elementSrcRef.current.get(element.id) === target.fullUrl;
        if (!stillNeeded) return;
        // Another run may have already applied it
        const existing = loadedImagesRef.current.get(element.id);
        if (existing === img) return;
        const next = new Map(loadedImagesRef.current);
        next.set(element.id, img);
        loadedImagesRef.current = next;
        setLoadedImages(next);
      });

      elementSrcRef.current.set(element.id, target.fullUrl);

      // If we don't have a thumbnail fallback loaded yet, preload that too
      if (!newLoadedImages.has(element.id) && target.thumbUrl) {
        preloadImage(target.thumbUrl).then((img) => {
          if (!img) return;
          // Only apply if the full hasn't arrived in the meantime
          const existing = loadedImagesRef.current.get(element.id);
          if (existing && existing.src === target.fullUrl) return;
          const next = new Map(loadedImagesRef.current);
          next.set(element.id, img);
          loadedImagesRef.current = next;
          setLoadedImages(next);
        });
      }
    }

    // Clean up elementSrcRef for removed elements
    const neededIds = new Set(elementTargets.keys());
    for (const id of elementSrcRef.current.keys()) {
      if (!neededIds.has(id)) elementSrcRef.current.delete(id);
    }
  }, [imageRelevantKey, project?.mediaPool]);

  return loadedImages;
}
