import type { AspectRatio } from '../types';

// Ordered square → tall → wide. Names follow social/print conventions:
// 4:5 is "Portrait", 5:4 is "Landscape" (also the classic 8×10 print ratio),
// 9:16 is "Story" (Instagram/Reels/TikTok term for vertical full-screen),
// 16:9 is "Video" (widescreen). The old 1.91:1 landscape was removed as
// unused; existing projects that reference it still load fine since the
// AspectRatio is stored per-project, not looked up from this list.
export const ASPECT_RATIOS: AspectRatio[] = [
  { width: 1, height: 1, name: 'Square (1:1)' },
  { width: 4, height: 5, name: 'Portrait (4:5)' },
  { width: 5, height: 4, name: 'Landscape (5:4)' },
  { width: 9, height: 16, name: 'Story (9:16)' },
  { width: 16, height: 9, name: 'Video (16:9)' },
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
