import { useEffect, useRef, useState, useCallback, memo } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { convertFileSrc } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import clsx from 'clsx';
import { useProjectStore } from '../../../stores/projectStore';
import { useMediaStore } from '../../../stores/mediaStore';
import { ConfirmDialog } from '../../common/ConfirmDialog';
import { MediaPreviewModal } from '../MediaPreviewModal';
import { showInFolder, checkMediaExists, relinkMedia, bulkRelinkMedia, type RelinkResult } from '../../../services/tauri';
import type { MediaItem } from '../../../types';
import { updateDragPreviewPosition } from '../DragPreview';
import { preloadImage } from '../../../utils/imageCache';

// Zoom settings
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;
const ZOOM_STEP = 0.25;
const BASE_THUMBNAIL_SIZE = 80; // Base size in pixels at 100% zoom

// Memoized media item to prevent re-renders during panel resize
interface MediaItemProps {
  media: MediaItem;
  isSelected: boolean;
  isDragging: boolean;
  inUse: boolean;
  isMissing: boolean;
  showNativeAspectRatio: boolean;
  onMouseDown: (e: React.MouseEvent, mediaId: string) => void;
  onDoubleClick: (media: MediaItem) => void;
  onContextMenu: (e: React.MouseEvent, media: MediaItem) => void;
  getMediaSrc: (media: MediaItem, isMissing: boolean) => string | null;
}

const MediaItemComponent = memo(function MediaItemComponent({
  media,
  isSelected,
  isDragging,
  inUse,
  isMissing,
  showNativeAspectRatio,
  onMouseDown,
  onDoubleClick,
  onContextMenu,
  getMediaSrc,
}: MediaItemProps) {
  const src = getMediaSrc(media, isMissing);

  return (
    <div
      onMouseDown={(e) => onMouseDown(e, media.id)}
      onDoubleClick={() => onDoubleClick(media)}
      onContextMenu={(e) => onContextMenu(e, media)}
      className={clsx(
        'aspect-square rounded overflow-hidden cursor-grab relative select-none',
        showNativeAspectRatio ? 'bg-theme-bg-tertiary/50' : 'bg-theme-bg-tertiary',
        // Selection ring is keyed to missing state so the blue/red layers
        // don't clobber each other (both set the same Tailwind ring vars).
        // Missing + selected → bright amber with offset: distinct from both
        // "just missing" (dim red) and "selected linked" (blue).
        isSelected && isMissing && 'ring-2 ring-amber-400 ring-offset-2 ring-offset-theme-bg-secondary',
        isSelected && !isMissing && 'ring-2 ring-blue-500 ring-offset-2 ring-offset-theme-bg-secondary',
        !isSelected && isMissing && 'ring-2 ring-red-500/50',
        !isSelected && !isMissing && 'hover:ring-2 hover:ring-theme-border',
        isDragging && 'opacity-50 cursor-grabbing'
      )}
      title={isMissing ? `${media.fileName} (Missing)` : media.fileName}
    >
      {isMissing ? (
        <div className="w-full h-full flex flex-col items-center justify-center text-red-400 px-1 gap-0.5">
          <svg className="w-6 h-6 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          {/* End-anchored filename: shows the most distinguishing trailing
              characters when the tile is too narrow for the full name
              (e.g. "…IMG_0421.jpg"). direction:rtl flips truncation to the
              left side while keeping ltr text order via the bdi wrapper. */}
          <span
            className="text-[10px] leading-tight text-center w-full overflow-hidden whitespace-nowrap"
            style={{ direction: 'rtl', textOverflow: 'ellipsis' }}
          >
            <bdi>{media.fileName}</bdi>
          </span>
        </div>
      ) : (
        <div className={clsx(
          'w-full h-full flex items-center justify-center',
          showNativeAspectRatio && 'p-1'
        )}>
          <img
            src={src || ''}
            alt={media.fileName}
            className={clsx(
              'pointer-events-none',
              showNativeAspectRatio
                ? 'max-w-full max-h-full object-contain'
                : 'w-full h-full object-cover'
            )}
            draggable={false}
            loading="lazy"
            decoding="async"
          />
        </div>
      )}
      {/* In-use indicator */}
      {inUse && !isMissing && (
        <div
          className="absolute bottom-1 right-1 w-2.5 h-2.5 bg-blue-500 rounded-full border border-white/50 shadow-sm"
          title="On canvas"
        />
      )}
    </div>
  );
});

// Context menu component
interface ContextMenuProps {
  x: number;
  y: number;
  isMissing: boolean;
  // Count of currently-selected missing items including this one. When > 1
  // the menu shows a "Relink N selected..." entry that opens the folder
  // picker for bulk relink instead of the single-file picker.
  selectedMissingCount: number;
  onClose: () => void;
  onShowInFinder: () => void;
  onRelink: () => void;
  onRelinkSelected: () => void;
  onPreview: () => void;
  onDelete: () => void;
}

function MediaContextMenu({
  x,
  y,
  isMissing,
  selectedMissingCount,
  onClose,
  onShowInFinder,
  onRelink,
  onRelinkSelected,
  onPreview,
  onDelete,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    window.addEventListener('mousedown', handleClickOutside);
    return () => window.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="fixed bg-theme-bg-secondary border border-theme-border rounded-lg shadow-xl py-1 min-w-[160px] z-[150]"
      style={{ left: x, top: y }}
    >
      {!isMissing && (
        <button
          onClick={onPreview}
          className="w-full px-3 py-1.5 text-left text-sm text-theme-text hover:bg-theme-bg-tertiary transition-colors"
        >
          Preview
        </button>
      )}
      {!isMissing && (
        <button
          onClick={onShowInFinder}
          className="w-full px-3 py-1.5 text-left text-sm text-theme-text hover:bg-theme-bg-tertiary transition-colors"
        >
          Show in Finder
        </button>
      )}
      {isMissing && selectedMissingCount > 1 && (
        <button
          onClick={onRelinkSelected}
          className="w-full px-3 py-1.5 text-left text-sm text-theme-text hover:bg-theme-bg-tertiary transition-colors"
        >
          {`Relink ${selectedMissingCount} selected…`}
        </button>
      )}
      {isMissing && selectedMissingCount <= 1 && (
        <button
          onClick={onRelink}
          className="w-full px-3 py-1.5 text-left text-sm text-theme-text hover:bg-theme-bg-tertiary transition-colors"
        >
          Relink Media...
        </button>
      )}
      <div className="my-1 border-t border-theme-border" />
      <button
        onClick={onDelete}
        className="w-full px-3 py-1.5 text-left text-sm text-red-500 hover:bg-red-500/10 transition-colors"
      >
        Delete
      </button>
    </div>
  );
}

// Right-click on empty grid background.
interface EmptyAreaContextMenuProps {
  x: number;
  y: number;
  missingCount: number;
  onClose: () => void;
  onRelinkAll: () => void;
}

function EmptyAreaContextMenu({
  x,
  y,
  missingCount,
  onClose,
  onRelinkAll,
}: EmptyAreaContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', handleClickOutside);
    return () => window.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // Nothing relevant to offer when no items are missing.
  if (missingCount === 0) return null;

  return (
    <div
      ref={menuRef}
      className="fixed bg-theme-bg-secondary border border-theme-border rounded-lg shadow-xl py-1 min-w-[200px] z-[150]"
      style={{ left: x, top: y }}
    >
      <button
        onClick={onRelinkAll}
        className="w-full px-3 py-1.5 text-left text-sm text-theme-text hover:bg-theme-bg-tertiary transition-colors"
      >
        {`Relink ${missingCount} missing item${missingCount === 1 ? '' : 's'}…`}
      </button>
    </div>
  );
}

// Toast shown after a bulk relink completes. Counts each tier separately and
// lists not-found / ambiguous filenames so the user can manually resolve them.
interface RelinkSummaryToastProps {
  summary: {
    results: RelinkResult[];
    scannedCount: number;
    requestedCount: number;
  };
  onDismiss: () => void;
}

function RelinkSummaryToast({ summary, onDismiss }: RelinkSummaryToastProps) {
  const { results, scannedCount, requestedCount } = summary;
  const exact = results.filter((r) => r.status === 'exact').length;
  const renamed = results.filter((r) => r.status === 'renamed').length;
  const resaved = results.filter((r) => r.status === 'resaved').length;
  const ambiguous = results.filter((r) => r.status === 'ambiguous').length;
  const notFound = results.filter((r) => r.status === 'notFound').length;
  const linked = exact + renamed + resaved;

  // Auto-dismiss when everything resolved cleanly. Stay open if anything
  // needs the user's attention (ambiguous / not found).
  useEffect(() => {
    if (ambiguous === 0 && notFound === 0) {
      const t = setTimeout(onDismiss, 3500);
      return () => clearTimeout(t);
    }
  }, [ambiguous, notFound, onDismiss]);

  return (
    <div className="fixed bottom-6 right-6 z-[200] w-80 bg-theme-bg-secondary border border-theme-border rounded-lg shadow-2xl p-3 select-none">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm font-medium text-theme-text">
          {`Relinked ${linked} of ${requestedCount}`}
        </span>
        <button
          onClick={onDismiss}
          className="text-theme-text-muted hover:text-theme-text ml-2 leading-none"
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
      <div className="text-xs text-theme-text-muted space-y-0.5">
        {exact > 0 && <div>{`${exact} exact match${exact === 1 ? '' : 'es'}`}</div>}
        {renamed > 0 && <div>{`${renamed} renamed (matched by size + dimensions)`}</div>}
        {resaved > 0 && <div>{`${resaved} re-saved (matched by name + dimensions)`}</div>}
        {ambiguous > 0 && <div className="text-amber-400">{`${ambiguous} ambiguous — multiple candidates`}</div>}
        {notFound > 0 && <div className="text-red-400">{`${notFound} not found`}</div>}
        <div className="mt-1 opacity-70">{`Scanned ${scannedCount} file${scannedCount === 1 ? '' : 's'}`}</div>
      </div>
    </div>
  );
}

export function MediaPoolPanel() {
  const containerRef = useRef<HTMLDivElement>(null);
  const project = useProjectStore((s) => s.project);
  const setProject = useProjectStore((s) => s.setProject);
  const selectedMediaIds = useMediaStore((s) => s.selectedMediaIds);
  const selectMedia = useMediaStore((s) => s.selectMedia);
  const importMedia = useMediaStore((s) => s.importMedia);
  const removeSelectedMedia = useMediaStore((s) => s.removeSelectedMedia);
  const removeMedia = useMediaStore((s) => s.removeMedia);
  const isMediaInUse = useMediaStore((s) => s.isMediaInUse);
  const draggingMediaId = useMediaStore((s) => s.draggingMediaId);
  const setDraggingMedia = useMediaStore((s) => s.setDraggingMedia);
  const setDragPosition = useMediaStore((s) => s.setDragPosition);

  const mediaPool = project?.mediaPool || [];
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    isOpen: boolean;
    x: number;
    y: number;
    media: MediaItem | null;
  }>({ isOpen: false, x: 0, y: 0, media: null });

  // Track which media files are missing
  const [missingMediaIds, setMissingMediaIds] = useState<Set<string>>(new Set());

  // Per-media thumbnail cache-bust version. Thumbnails regenerate at the
  // SAME path on disk after relink ({media_id}.jpg), so the browser would
  // serve the cached old image until session restart. Bumping this version
  // appends ?v=N to the URL — forces a fresh fetch once the backend has
  // written the new bytes (after `thumbnails-ready` fires).
  const [thumbnailVersions, setThumbnailVersions] = useState<Map<string, number>>(new Map());
  const bumpThumbnailVersions = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setThumbnailVersions((prev) => {
      const next = new Map(prev);
      for (const id of ids) next.set(id, (next.get(id) ?? 0) + 1);
      return next;
    });
  }, []);

  // Empty-area context menu (right-click in the grid background, not on a tile)
  const [emptyContextMenu, setEmptyContextMenu] = useState<{
    isOpen: boolean;
    x: number;
    y: number;
  }>({ isOpen: false, x: 0, y: 0 });

  // Summary toast shown after a bulk relink finishes. `null` = hidden.
  const [relinkSummary, setRelinkSummary] = useState<{
    results: RelinkResult[];
    scannedCount: number;
    requestedCount: number;
  } | null>(null);

  // Single-file relink mismatch confirm dialog. When the user explicitly
  // picks one file for one missing media item and signals don't agree, we
  // ask them to confirm rather than silently relinking.
  const [singleRelinkConfirm, setSingleRelinkConfirm] = useState<{
    isOpen: boolean;
    media: MediaItem | null;
    selectedPath: string;
    reason: string;
  }>({ isOpen: false, media: null, selectedPath: '', reason: '' });

  // Zoom level for thumbnails (0.5 = 50%, 1 = 100%, 2 = 200%)
  const [zoomLevel, setZoomLevel] = useState(1);

  // Native aspect ratio display toggle
  const [showNativeAspectRatio, setShowNativeAspectRatio] = useState(false);

  // Calculate thumbnail size based on zoom level
  const thumbnailSize = Math.round(BASE_THUMBNAIL_SIZE * zoomLevel);
  const gap = 8; // Gap between thumbnails in pixels

  // Track the filePath each media id was last existence-checked at. Keying
  // on (id → filePath) — not just id — means a relink (filePath change)
  // invalidates the prior result and forces a fresh check. This is the
  // single source of truth for missing-state recovery and works whether the
  // relink came from this panel, the single-tile path, or any future caller.
  const checkedPathsRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    const checkMissingMedia = async () => {
      const currentIds = new Set(mediaPool.map((m) => m.id));

      // Drop ids no longer in the pool from missingMediaIds.
      setMissingMediaIds((prev) => {
        const next = new Set(prev);
        for (const id of prev) {
          if (!currentIds.has(id)) next.delete(id);
        }
        return next.size !== prev.size ? next : prev;
      });
      // Same cleanup for the path-tracking ref.
      for (const id of Array.from(checkedPathsRef.current.keys())) {
        if (!currentIds.has(id)) checkedPathsRef.current.delete(id);
      }

      // Items needing a (re)check: never checked, or filePath changed since
      // last check (e.g. just relinked).
      const toCheck = mediaPool.filter((m) => {
        const prevPath = checkedPathsRef.current.get(m.id);
        return prevPath !== m.filePath;
      });
      if (toCheck.length === 0) return;

      for (const media of toCheck) {
        const exists = await checkMediaExists(media.filePath);
        checkedPathsRef.current.set(media.id, media.filePath);
        setMissingMediaIds((prev) => {
          const has = prev.has(media.id);
          if (!exists && !has) return new Set(prev).add(media.id);
          if (exists && has) {
            const next = new Set(prev);
            next.delete(media.id);
            return next;
          }
          return prev;
        });
      }
    };
    checkMissingMedia();
  }, [mediaPool]);

  // Listen for Tauri drag-drop events from file explorer
  useEffect(() => {
    const webview = getCurrentWebviewWindow();

    const unlistenPromise = webview.onDragDropEvent(async (event) => {
      const dragEvent = event.payload;
      if (dragEvent.type === 'over' || dragEvent.type === 'enter') {
        setIsDraggingOver(true);
      } else if (dragEvent.type === 'drop') {
        setIsDraggingOver(false);
        const paths = dragEvent.paths;
        if (paths && paths.length > 0) {
          await importMedia(paths);
        }
      } else if (dragEvent.type === 'leave') {
        setIsDraggingOver(false);
      }
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [importMedia]);

  // Handle keyboard events for delete
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (e.key === 'Backspace' || e.key === 'Delete') {
        if (selectedMediaIds.length > 0 && document.activeElement === containerRef.current) {
          e.preventDefault();
          handleDeleteSelected();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedMediaIds]);

  const handleDeleteSelected = () => {
    const anyInUse = selectedMediaIds.some((id) => isMediaInUse(id));
    if (anyInUse) {
      setDeleteConfirmOpen(true);
    } else {
      removeSelectedMedia();
    }
  };

  const confirmDelete = () => {
    removeSelectedMedia();
    setDeleteConfirmOpen(false);
  };

  const handleImport = async () => {
    try {
      const selected = await open({
        multiple: true,
        directory: false,
        filters: [
          {
            name: 'Images',
            extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'],
          },
        ],
      });

      if (selected) {
        const paths = Array.isArray(selected) ? selected : [selected];
        await importMedia(paths);
      }
    } catch (error) {
      console.error('Failed to open file dialog:', error);
    }
  };

  // Use mouse events for dragging (more reliable than HTML5 drag-drop across z-index boundaries)
  const handleMediaMouseDown = useCallback(
    (e: React.MouseEvent, mediaId: string) => {
      // Only handle left click
      if (e.button !== 0) return;

      // Don't start drag immediately - wait for mouse move to distinguish from click
      const startX = e.clientX;
      const startY = e.clientY;
      let isDragging = false;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;

        // Start dragging after 5px of movement
        if (!isDragging && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
          isDragging = true;
          // If the dragged item isn't selected, select only it
          if (!selectedMediaIds.includes(mediaId)) {
            selectMedia(mediaId);
          }
          setDraggingMedia(mediaId);
          // Kick off async preload of full-size image so it's ready on drop
          const media = mediaPool.find((m) => m.id === mediaId);
          if (media) {
            preloadImage(convertFileSrc(media.filePath));
            if (media.thumbnailPath) {
              preloadImage(convertFileSrc(media.thumbnailPath));
            }
          }
        }

        // Update drag preview position directly on the DOM (bypasses React re-renders)
        if (isDragging) {
          updateDragPreviewPosition(moveEvent.clientX, moveEvent.clientY);
        }
      };

      const handleMouseUp = (upEvent: MouseEvent) => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);

        if (isDragging) {
          // Set final position for drop handling
          setDragPosition({ x: upEvent.clientX, y: upEvent.clientY });
          // The drop will be handled by EditorLayout listening to dragPosition changes
        } else {
          // It was a click, not a drag
          selectMedia(mediaId, {
            shift: e.shiftKey,
            ctrl: e.metaKey || e.ctrlKey,
          });
        }
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [selectedMediaIds, selectMedia, setDraggingMedia, setDragPosition, mediaPool]
  );

  const handleDoubleClick = useCallback(async (media: MediaItem) => {
    // Check if already known to be missing
    if (missingMediaIds.has(media.id)) return;

    // Check if file still exists
    const exists = await checkMediaExists(media.filePath);
    if (!exists) {
      // Mark as missing
      setMissingMediaIds((prev) => new Set(prev).add(media.id));
      return;
    }

    const idx = mediaPool.findIndex((m) => m.id === media.id);
    if (idx !== -1) setPreviewIndex(idx);
  }, [missingMediaIds, mediaPool]);

  const handleContextMenu = useCallback((e: React.MouseEvent, media: MediaItem) => {
    e.preventDefault();
    setContextMenu({
      isOpen: true,
      x: e.clientX,
      y: e.clientY,
      media,
    });
  }, []);

  // Right-click on empty grid background → "Relink all missing" entry point.
  const handleEmptyAreaContextMenu = useCallback(
    (e: React.MouseEvent) => {
      // Only intercept when the target IS the wrapper itself (not bubbling
      // from a tile). Tile context menus stopPropagation effectively via
      // their own handler.
      if (e.target !== e.currentTarget) return;
      e.preventDefault();
      setEmptyContextMenu({ isOpen: true, x: e.clientX, y: e.clientY });
    },
    []
  );

  const handleShowInFinder = useCallback(async () => {
    if (!contextMenu.media) return;

    // Check if file still exists
    const exists = await checkMediaExists(contextMenu.media.filePath);
    if (!exists) {
      // Mark as missing
      setMissingMediaIds((prev) => new Set(prev).add(contextMenu.media!.id));
      setContextMenu({ ...contextMenu, isOpen: false });
      return;
    }

    try {
      await showInFolder(contextMenu.media.filePath);
    } catch (error) {
      console.error('Failed to show in folder:', error);
    }
    setContextMenu({ ...contextMenu, isOpen: false });
  }, [contextMenu]);

  // Apply a single-media relink with optional dimension/size verification.
  // Used by both the direct path (signals agree) and the post-confirm-dialog
  // path (signals disagree but user overrode).
  const applySingleRelink = useCallback(async (mediaId: string, newPath: string) => {
    if (!project) return;
    try {
      const updatedProject = await relinkMedia(project.id, mediaId, newPath);
      setProject(updatedProject);
      setMissingMediaIds((prev) => {
        const next = new Set(prev);
        next.delete(mediaId);
        return next;
      });
      bumpThumbnailVersions([mediaId]);
    } catch (error) {
      console.error('Failed to relink media:', error);
    }
  }, [project, setProject, bumpThumbnailVersions]);

  // Run bulk relink against a set of media ids and scan paths. Updates the
  // project store, clears resolved missing flags, surfaces a summary toast.
  // Always runs with maxDepth=3 (chosen with user; deep enough for typical
  // nested Lightroom-style folders without scanning huge trees).
  const runBulkRelink = useCallback(
    async (mediaIds: string[], scanPaths: string[]) => {
      if (!project || mediaIds.length === 0 || scanPaths.length === 0) return;
      try {
        const response = await bulkRelinkMedia(project.id, mediaIds, scanPaths, 3);
        setProject(response.project);
        // Clear missing flag for everything that got relinked.
        const resolvedIds = new Set(
          response.results
            .filter(
              (r) => r.status === 'exact' || r.status === 'renamed' || r.status === 'resaved'
            )
            .map((r) => r.mediaId)
        );
        if (resolvedIds.size > 0) {
          setMissingMediaIds((prev) => {
            const next = new Set(prev);
            for (const id of resolvedIds) next.delete(id);
            return next;
          });
          bumpThumbnailVersions(Array.from(resolvedIds));
        }
        setRelinkSummary({
          results: response.results,
          scannedCount: response.scannedCount,
          requestedCount: mediaIds.length,
        });
      } catch (error) {
        console.error('Bulk relink failed:', error);
      }
    },
    [project, setProject, bumpThumbnailVersions]
  );

  // Open the directory/file picker for a bulk relink of every currently-missing
  // item, OR a caller-provided subset (e.g. multi-selected missing tiles).
  const startBulkRelink = useCallback(
    async (mediaIds?: string[]) => {
      const ids =
        mediaIds && mediaIds.length > 0 ? mediaIds : Array.from(missingMediaIds);
      if (ids.length === 0) return;

      try {
        const selected = await open({
          multiple: true,
          directory: true,
          title: `Choose folder(s) to search for ${ids.length} missing item${ids.length === 1 ? '' : 's'}`,
        });
        if (!selected) return;
        const paths = Array.isArray(selected) ? selected : [selected];
        await runBulkRelink(ids, paths);
      } catch (error) {
        console.error('Failed to open folder dialog:', error);
      }
    },
    [missingMediaIds, runBulkRelink]
  );

  const handleRelink = useCallback(async () => {
    if (!contextMenu.media || !project) return;
    const media = contextMenu.media;
    setContextMenu({ ...contextMenu, isOpen: false });

    try {
      const selected = await open({
        multiple: false,
        directory: false,
        filters: [
          { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] },
        ],
      });
      if (!selected || typeof selected !== 'string') return;

      const chosenName = selected.split(/[\\/]/).pop() || '';
      const nameMatch = chosenName.toLowerCase() === media.fileName.toLowerCase();

      // Without reading the picked file we can't compare size/dimensions
      // here. Filename mismatch is the only cheap signal — surface a confirm
      // dialog mirroring the Lightroom UX. The backend will refresh dims
      // and size after the relink applies.
      if (!nameMatch) {
        setSingleRelinkConfirm({
          isOpen: true,
          media,
          selectedPath: selected,
          reason: `Filename differs: "${media.fileName}" → "${chosenName}"`,
        });
        return;
      }

      await applySingleRelink(media.id, selected);
    } catch (error) {
      console.error('Failed to relink media:', error);
    }
  }, [contextMenu, project, applySingleRelink]);

  // "Relink N selected…" — folder picker, bulk relink only the selected
  // items that are currently flagged missing.
  const handleRelinkSelected = useCallback(async () => {
    setContextMenu((prev) => ({ ...prev, isOpen: false }));
    const ids = selectedMediaIds.filter((id) => missingMediaIds.has(id));
    if (ids.length === 0) return;
    await startBulkRelink(ids);
  }, [selectedMediaIds, missingMediaIds, startBulkRelink]);

  const handleContextMenuPreview = useCallback(async () => {
    if (!contextMenu.media) {
      setContextMenu({ ...contextMenu, isOpen: false });
      return;
    }

    // Check if already known to be missing
    if (missingMediaIds.has(contextMenu.media.id)) {
      setContextMenu({ ...contextMenu, isOpen: false });
      return;
    }

    // Check if file still exists
    const exists = await checkMediaExists(contextMenu.media.filePath);
    if (!exists) {
      // Mark as missing
      setMissingMediaIds((prev) => new Set(prev).add(contextMenu.media!.id));
      setContextMenu({ ...contextMenu, isOpen: false });
      return;
    }

    const idx = mediaPool.findIndex((m) => m.id === contextMenu.media!.id);
    if (idx !== -1) setPreviewIndex(idx);
    setContextMenu({ ...contextMenu, isOpen: false });
  }, [contextMenu, missingMediaIds, mediaPool]);

  const handleContextMenuDelete = useCallback(async () => {
    if (!contextMenu.media) return;

    if (isMediaInUse(contextMenu.media.id)) {
      selectMedia(contextMenu.media.id);
      setDeleteConfirmOpen(true);
    } else {
      await removeMedia(contextMenu.media.id);
    }
    setContextMenu({ ...contextMenu, isOpen: false });
  }, [contextMenu, isMediaInUse, selectMedia, removeMedia]);

  const getMediaSrc = useCallback(
    (media: MediaItem, isMissing: boolean) => {
      if (isMissing) return null;
      // Use thumbnail if available for better performance
      const path = media.thumbnailPath || media.filePath;
      const url = convertFileSrc(path);
      // Append a cache-bust query when the media has been relinked in this
      // session — the thumbnail file at `path` has changed on disk but the
      // URL is identical, so without ?v=N the browser would serve the old
      // cached bytes.
      const v = thumbnailVersions.get(media.id);
      return v ? `${url}?v=${v}` : url;
    },
    [thumbnailVersions]
  );

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      data-panel="mediaPool"
      className={clsx(
        'p-3 h-full flex flex-col outline-none',
        isDraggingOver && 'bg-blue-500/10'
      )}
    >
      {mediaPool.length === 0 ? (
        <div
          className={clsx(
            'flex-1 flex flex-col items-center justify-center text-theme-text-muted border-2 border-dashed rounded-lg transition-colors',
            isDraggingOver ? 'border-blue-500 bg-blue-500/5' : 'border-theme-border'
          )}
        >
          <svg
            className="w-10 h-10 mb-2 opacity-50"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          <p className="text-sm text-center">No media imported</p>
          <p className="text-xs text-center mt-1 opacity-70">
            Drag & drop images or click Import
          </p>
        </div>
      ) : (
        <>
          {/* Zoom and display controls */}
          <div className="flex items-center justify-between mb-2 pb-2 border-b border-theme-border">
            {/* Zoom controls */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => setZoomLevel((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP))}
                disabled={zoomLevel <= MIN_ZOOM}
                className="p-1 rounded hover:bg-theme-bg-tertiary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Zoom out"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 12H4" />
                </svg>
              </button>
              <span className="text-xs text-theme-text-muted w-10 text-center">
                {Math.round(zoomLevel * 100)}%
              </span>
              <button
                onClick={() => setZoomLevel((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP))}
                disabled={zoomLevel >= MAX_ZOOM}
                className="p-1 rounded hover:bg-theme-bg-tertiary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Zoom in"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
                </svg>
              </button>
              {zoomLevel !== 1 && (
                <button
                  onClick={() => setZoomLevel(1)}
                  className="ml-1 px-1.5 py-0.5 text-[10px] rounded bg-theme-bg-tertiary hover:bg-theme-border transition-colors"
                  title="Reset zoom to 100%"
                >
                  Reset
                </button>
              )}
            </div>

            {/* Aspect ratio toggle */}
            <button
              onClick={() => setShowNativeAspectRatio((v) => !v)}
              className={clsx(
                'p-1 rounded transition-colors',
                showNativeAspectRatio
                  ? 'bg-blue-500/20 text-blue-400'
                  : 'hover:bg-theme-bg-tertiary text-theme-text-muted'
              )}
              title={showNativeAspectRatio ? 'Show cropped thumbnails' : 'Show native aspect ratios'}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z"
                />
              </svg>
            </button>
          </div>

          {/* Media grid */}
          <div
            className="flex-1 overflow-y-auto overflow-x-hidden"
            onContextMenu={handleEmptyAreaContextMenu}
          >
            {/* Extra padding to prevent ring clipping */}
            <div className="p-1" onContextMenu={handleEmptyAreaContextMenu}>
              <div
                className="grid justify-start"
                style={{
                  gridTemplateColumns: `repeat(auto-fill, ${thumbnailSize}px)`,
                  gap: `${gap}px`,
                }}
                onContextMenu={handleEmptyAreaContextMenu}
              >
                {mediaPool.map((media) => (
                  <div
                    key={media.id}
                    style={{ width: thumbnailSize, height: thumbnailSize }}
                  >
                    <MediaItemComponent
                      media={media}
                      isSelected={selectedMediaIds.includes(media.id)}
                      isDragging={draggingMediaId === media.id}
                      inUse={isMediaInUse(media.id)}
                      isMissing={missingMediaIds.has(media.id)}
                      showNativeAspectRatio={showNativeAspectRatio}
                      onMouseDown={handleMediaMouseDown}
                      onDoubleClick={handleDoubleClick}
                      onContextMenu={handleContextMenu}
                      getMediaSrc={getMediaSrc}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Import + Relink-all-missing buttons */}
      <div className="mt-3 flex gap-2">
        <button
          onClick={handleImport}
          className="flex-1 py-2 border border-dashed border-theme-border rounded text-sm text-theme-text-secondary hover:border-blue-500 hover:text-blue-500 transition-colors"
        >
          + Import Media
        </button>
        {missingMediaIds.size > 0 && (
          <button
            onClick={() => void startBulkRelink()}
            className="px-3 py-2 border border-dashed border-amber-500/60 text-amber-500 rounded text-sm hover:bg-amber-500/10 transition-colors whitespace-nowrap"
            title={`Relink ${missingMediaIds.size} missing item${missingMediaIds.size === 1 ? '' : 's'}`}
          >
            {`⚠ Relink ${missingMediaIds.size}`}
          </button>
        )}
      </div>

      {/* Selected media info */}
      {selectedMediaIds.length > 0 && (
        <div className="mt-2 pt-2 border-t border-theme-border text-xs text-theme-text-muted flex justify-between items-center">
          <span className="truncate flex-1">
            {selectedMediaIds.length === 1
              ? mediaPool.find((m) => m.id === selectedMediaIds[0])?.fileName
              : `${selectedMediaIds.length} items selected`}
          </span>
          <button
            onClick={handleDeleteSelected}
            className="ml-2 p-1 text-red-500 hover:bg-red-500/10 rounded transition-colors"
            title="Delete (Backspace)"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </button>
        </div>
      )}

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        isOpen={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        onConfirm={confirmDelete}
        title="Delete Media"
        message={
          selectedMediaIds.length === 1
            ? 'This media is currently used on the canvas. Deleting it will also remove it from all slides. Are you sure?'
            : 'Some of the selected media are used on the canvas. Deleting them will also remove them from all slides. Are you sure?'
        }
        confirmLabel="Delete"
        danger
      />

      {/* Preview modal */}
      {previewIndex !== null && mediaPool[previewIndex] && (
        <MediaPreviewModal
          mediaPool={mediaPool}
          currentIndex={previewIndex}
          onNavigate={setPreviewIndex}
          onClose={() => setPreviewIndex(null)}
        />
      )}

      {/* Context menu */}
      {contextMenu.isOpen && contextMenu.media && (
        <MediaContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          isMissing={missingMediaIds.has(contextMenu.media.id)}
          selectedMissingCount={
            selectedMediaIds.includes(contextMenu.media.id)
              ? selectedMediaIds.filter((id) => missingMediaIds.has(id)).length
              : 1
          }
          onClose={() => setContextMenu({ ...contextMenu, isOpen: false })}
          onShowInFinder={handleShowInFinder}
          onRelink={handleRelink}
          onRelinkSelected={handleRelinkSelected}
          onPreview={handleContextMenuPreview}
          onDelete={handleContextMenuDelete}
        />
      )}

      {/* Empty-area context menu (right-click on the grid background) */}
      {emptyContextMenu.isOpen && (
        <EmptyAreaContextMenu
          x={emptyContextMenu.x}
          y={emptyContextMenu.y}
          missingCount={missingMediaIds.size}
          onClose={() => setEmptyContextMenu({ ...emptyContextMenu, isOpen: false })}
          onRelinkAll={() => {
            setEmptyContextMenu({ ...emptyContextMenu, isOpen: false });
            void startBulkRelink();
          }}
        />
      )}

      {/* Single-file relink mismatch confirm */}
      <ConfirmDialog
        isOpen={singleRelinkConfirm.isOpen}
        onClose={() => setSingleRelinkConfirm({ ...singleRelinkConfirm, isOpen: false })}
        onConfirm={async () => {
          const { media, selectedPath } = singleRelinkConfirm;
          setSingleRelinkConfirm({ isOpen: false, media: null, selectedPath: '', reason: '' });
          if (media) await applySingleRelink(media.id, selectedPath);
        }}
        title="File doesn't appear to match"
        message={`${singleRelinkConfirm.reason}\n\nRelink anyway?`}
        confirmLabel="Relink"
      />

      {/* Bulk relink summary toast */}
      {relinkSummary && (
        <RelinkSummaryToast
          summary={relinkSummary}
          onDismiss={() => setRelinkSummary(null)}
        />
      )}
    </div>
  );
}
