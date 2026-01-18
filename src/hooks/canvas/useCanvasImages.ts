import { useEffect, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { Element } from '../../types';
import { useProjectStore } from '../../stores/projectStore';

/**
 * Hook for loading and managing images for canvas elements
 */
export function useCanvasImages(elements: Element[]) {
  const [loadedImages, setLoadedImages] = useState<Map<string, HTMLImageElement>>(new Map());
  const { project } = useProjectStore();

  // Load images for all elements
  useEffect(() => {
    const loadImages = async () => {
      const newLoadedImages = new Map<string, HTMLImageElement>();

      for (const element of elements) {
        if (element.type === 'photo' && element.mediaId) {
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
            const existingImage = loadedImages.get(element.id);
            // Only reuse existing image if it loaded successfully
            if (existingImage && existingImage.complete && existingImage.naturalWidth > 0) {
              newLoadedImages.set(element.id, existingImage);
            } else {
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

      setLoadedImages(newLoadedImages);
    };

    loadImages();
  }, [elements, project?.mediaPool]);

  return loadedImages;
}

