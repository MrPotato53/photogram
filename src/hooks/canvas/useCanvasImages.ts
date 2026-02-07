import { useEffect, useState, useRef, useMemo } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { Element } from '../../types';
import { useProjectStore } from '../../stores/projectStore';

/**
 * Hook for loading and managing images for canvas elements
 * Optimized to avoid re-running during drag operations (position-only changes)
 */
export function useCanvasImages(elements: Element[]) {
  const [loadedImages, setLoadedImages] = useState<Map<string, HTMLImageElement>>(new Map());
  const { project } = useProjectStore();

  // Track the image-relevant parts of elements to detect actual changes
  // Only id, mediaId, and assetPath matter for image loading - position changes are ignored
  const imageRelevantKey = useMemo(() => {
    return elements
      .filter((el) => el.type === 'photo' && el.mediaId)
      .map((el) => `${el.id}:${el.mediaId}:${el.assetPath || ''}`)
      .join('|');
  }, [elements]);

  // Track the last processed key to avoid redundant work
  const lastProcessedKeyRef = useRef<string>('');
  const loadedImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());

  // Load images for all elements - only runs when image-relevant data changes
  useEffect(() => {
    // Skip if nothing image-relevant changed (e.g., just position updates during drag)
    if (imageRelevantKey === lastProcessedKeyRef.current) {
      return;
    }
    lastProcessedKeyRef.current = imageRelevantKey;

    const loadImages = async () => {
      const currentImages = loadedImagesRef.current;
      const newLoadedImages = new Map<string, HTMLImageElement>();
      let hasChanges = false;

      // Build a set of element IDs we need images for
      const neededElementIds = new Set<string>();

      for (const element of elements) {
        if (element.type === 'photo' && element.mediaId) {
          neededElementIds.add(element.id);

          let imagePath: string | null = null;

          if (element.assetPath) {
            imagePath = element.assetPath;
          } else {
            const media = project?.mediaPool.find((m) => m.id === element.mediaId);
            if (media) {
              imagePath = media.filePath;
            }
          }

          if (imagePath) {
            const existingImage = currentImages.get(element.id);
            // Reuse existing image if it loaded successfully
            if (existingImage && existingImage.complete && existingImage.naturalWidth > 0) {
              newLoadedImages.set(element.id, existingImage);
            } else {
              // Need to load this image
              hasChanges = true;
              const img = new window.Image();
              img.crossOrigin = 'anonymous';
              img.src = convertFileSrc(imagePath);
              const loaded = await new Promise<boolean>((resolve) => {
                img.onload = () => resolve(true);
                img.onerror = () => {
                  console.warn(`Failed to load image for element ${element.id}: ${imagePath}`);
                  resolve(false);
                };
              });
              // Only add to map if image loaded successfully
              if (loaded && img.complete && img.naturalWidth > 0) {
                newLoadedImages.set(element.id, img);
              }
            }
          }
        }
      }

      // Check if any images were removed
      for (const id of currentImages.keys()) {
        if (!neededElementIds.has(id)) {
          hasChanges = true;
        }
      }

      // Only update state if there are actual changes
      if (hasChanges || newLoadedImages.size !== currentImages.size) {
        loadedImagesRef.current = newLoadedImages;
        setLoadedImages(newLoadedImages);
      }
    };

    loadImages();
  }, [imageRelevantKey, project?.mediaPool]);

  return loadedImages;
}

