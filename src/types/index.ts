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
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  scale: number;
  locked: boolean;
  zIndex: number;
  spanFrames?: string[];
}

export interface Slide {
  id: string;
  elements: Element[];
  order: number;
}

export interface Project {
  id: string;
  name: string;
  aspectRatio: AspectRatio;
  slides: Slide[];
  mediaPool: MediaItem[];
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
