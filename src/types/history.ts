import type { Element, Slide, MediaItem } from './index';

/**
 * Lightweight snapshot of project state for history
 * Contains only JSON-serializable data, NO image instances
 */
export interface HistorySnapshot {
  elements: Element[];
  slides: Slide[];
  mediaPool: MediaItem[];
}

/**
 * Represents a single entry in the undo/redo history stack
 */
export interface HistoryEntry {
  id: string;
  timestamp: number;
  label: string;
  snapshot: HistorySnapshot;
}

/**
 * Source of the state change for labeling
 */
export type HistorySource =
  | 'element'
  | 'slide'
  | 'media'
  | 'transform'
  | 'crop'
  | 'reorder'
  | 'paste'
  | 'template';

/**
 * Type of action performed
 */
export type HistoryActionType =
  | 'add'
  | 'update'
  | 'delete'
  | 'move'
  | 'resize'
  | 'rotate'
  | 'crop'
  | 'flip'
  | 'reorder'
  | 'duplicate'
  | 'paste'
  | 'apply';

/**
 * Context for tracking operation details
 */
export interface HistoryOperationContext {
  source: HistorySource;
  actionType: HistoryActionType;
  elementId?: string;
  slideIndex?: number;
}

/**
 * Tracks soft-deleted assets pending cleanup
 */
export interface DeletedAssetInfo {
  assetPath: string;
  mediaId: string;
  deletedAt: number;
  historyEntryId: string;
}

/**
 * Configuration for history behavior
 */
export interface HistoryConfig {
  maxEntries: number;
  debounceMs: number;
  hotTierSize: number; // Entries to keep assets in memory
}

export const DEFAULT_HISTORY_CONFIG: HistoryConfig = {
  maxEntries: 50,
  debounceMs: 300,
  hotTierSize: 5,
};
