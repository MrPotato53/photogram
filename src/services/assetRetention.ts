/**
 * Asset Retention Service
 *
 * Manages soft deletion of assets for undo support.
 * Files are only truly deleted when they fall off the history stack.
 * All cleanup operations are async and non-blocking.
 */

import { invoke } from '@tauri-apps/api/core';
import type { DeletedAssetInfo } from '../types/history';

// Set of asset paths pending deletion
const pendingDeletions = new Map<string, DeletedAssetInfo>();

// Track which assets are currently "soft deleted" (removed from UI but file still exists)
const softDeletedAssets = new Set<string>();

/**
 * Mark an asset as soft-deleted (removed from mediaPool but file kept)
 * This is synchronous and instant - no file I/O
 */
export function softDeleteAsset(info: DeletedAssetInfo): void {
  pendingDeletions.set(info.assetPath, info);
  softDeletedAssets.add(info.assetPath);
}

/**
 * Restore a soft-deleted asset (undo deletion)
 * This is synchronous - just removes from pending set
 */
export function restoreAsset(assetPath: string): void {
  pendingDeletions.delete(assetPath);
  softDeletedAssets.delete(assetPath);
}

/**
 * Check if an asset is currently soft-deleted
 */
export function isAssetSoftDeleted(assetPath: string): boolean {
  return softDeletedAssets.has(assetPath);
}

/**
 * Get all pending deletions
 */
export function getPendingDeletions(): DeletedAssetInfo[] {
  return Array.from(pendingDeletions.values());
}

/**
 * Actually delete files from disk
 * Called when entries fall off the history stack
 * This is async and non-blocking - uses requestIdleCallback
 */
export function scheduleAssetCleanup(assetPaths: string[]): void {
  if (assetPaths.length === 0) return;
  if (!currentProjectId) {
    console.warn('Cannot cleanup assets: no project ID set');
    return;
  }

  const projectId = currentProjectId;

  // Use requestIdleCallback for non-blocking cleanup
  const cleanup = () => {
    // Process deletions asynchronously
    for (const assetPath of assetPaths) {
      deleteAssetFile(assetPath, projectId).catch((err) => {
        console.warn(`Failed to delete asset: ${assetPath}`, err);
      });

      // Remove from tracking
      pendingDeletions.delete(assetPath);
      softDeletedAssets.delete(assetPath);
    }
  };

  if ('requestIdleCallback' in window) {
    requestIdleCallback(cleanup, { timeout: 5000 });
  } else {
    // Fallback for browsers without requestIdleCallback
    setTimeout(cleanup, 100);
  }
}

/**
 * Delete a single element asset file from disk via Tauri
 * Uses the existing delete_element_asset command
 */
async function deleteAssetFile(assetPath: string, projectId: string): Promise<void> {
  try {
    await invoke('delete_element_asset', { projectId, assetPath });
  } catch (error) {
    console.error(`Failed to delete asset file: ${assetPath}`, error);
    throw error;
  }
}

// Store project ID for cleanup operations
let currentProjectId: string | null = null;

/**
 * Set the current project ID for asset cleanup operations
 */
export function setCurrentProjectId(projectId: string | null): void {
  currentProjectId = projectId;
}

/**
 * Clear all pending deletions (e.g., on project switch)
 * Optionally delete all pending files
 */
export function clearPendingDeletions(deleteFiles: boolean = false): void {
  if (deleteFiles) {
    const paths = Array.from(pendingDeletions.keys());
    scheduleAssetCleanup(paths);
  } else {
    pendingDeletions.clear();
    softDeletedAssets.clear();
  }
}

/**
 * Prune assets that are beyond the "safe" history range
 * Called when history entries are removed
 *
 * @param safeAssetPaths - Asset paths that are still referenced in history
 */
export function pruneOrphanedAssets(safeAssetPaths: Set<string>): void {
  const toPrune: string[] = [];

  for (const assetPath of pendingDeletions.keys()) {
    if (!safeAssetPaths.has(assetPath)) {
      toPrune.push(assetPath);
    }
  }

  if (toPrune.length > 0) {
    scheduleAssetCleanup(toPrune);
  }
}
