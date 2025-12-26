import type { AspectRatio } from '../types';

export const ASPECT_RATIOS: AspectRatio[] = [
  { width: 4, height: 5, name: 'Portrait (4:5)' },
  { width: 1, height: 1, name: 'Square (1:1)' },
  { width: 5, height: 4, name: 'Photo (5:4)' },
  { width: 16, height: 9, name: 'Video (16:9)' },
  { width: 191, height: 100, name: 'Landscape (1.91:1)' },
];

export const getResolution = (aspectRatio: AspectRatio): { width: number; height: number } => {
  const baseWidth = 1080;
  const ratio = aspectRatio.height / aspectRatio.width;

  if (ratio >= 1) {
    // Taller than wide or square
    return {
      width: baseWidth,
      height: Math.round(baseWidth * ratio),
    };
  } else {
    // Wider than tall
    return {
      width: baseWidth,
      height: Math.round(baseWidth * ratio),
    };
  }
};

export const formatAspectRatio = (ar: AspectRatio): string => {
  if (ar.width === 191 && ar.height === 100) {
    return '1.91:1';
  }
  return `${ar.width}:${ar.height}`;
};
