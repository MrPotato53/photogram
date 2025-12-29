export interface AspectRatio {
  width: number;
  height: number;
  name: string;
}

export interface MediaItem {
  id: string;
  fileName: string;
  filePath: string;
  thumbnailPath: string | null;
  width: number;
  height: number;
}

export interface Element {
  id: string;
  type: 'photo' | 'placeholder';
  mediaId?: string;
  // Embedded asset path (copy of image stored in project for portability)
  assetPath?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  scale: number;
  locked: boolean;
  zIndex: number;
  spanFrames?: string[];
  // Crop (normalized 0-1, relative to original image)
  cropX?: number;
  cropY?: number;
  cropWidth?: number;
  cropHeight?: number;
  // Flip/mirror
  flipX?: boolean;
  flipY?: boolean;
}

// Alignment guide for snapping
export interface Guide {
  orientation: 'vertical' | 'horizontal';
  position: number;
}

export interface Slide {
  id: string;
  order: number;
}

// Template for creating slides with pre-defined frame layouts
export interface Template {
  id: string;
  name: string;
  aspectRatio: AspectRatio;
  // Elements with positions relative to a single slide (0 to designWidth)
  elements: Omit<Element, 'mediaId' | 'assetPath'>[];
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  aspectRatio: AspectRatio;
  slides: Slide[];
  // Global elements - x coordinates span across all slides
  // (e.g., x=1200 on 1080-wide slides means element is on slide 2)
  elements: Element[];
  mediaPool: MediaItem[];
  templates: Template[];
  createdAt: string;
  updatedAt: string;
  accessedAt: string;
  thumbnail: string | null;
}

export interface ProjectSummary {
  id: string;
  name: string;
  aspectRatio: AspectRatio;
  slideCount: number;
  createdAt: string;
  updatedAt: string;
  accessedAt: string;
  thumbnail: string | null;
}

export interface Preferences {
  theme: 'light' | 'dark';
  sortBy: 'accessedAt' | 'createdAt' | 'name';
}

export type SortOption = {
  value: Preferences['sortBy'];
  label: string;
};

export interface Tab {
  id: string;
  type: 'home' | 'project';
  projectId?: string;
  projectName?: string;
}
