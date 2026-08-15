
---

## Finder drag-drop into media pool — root cause + fix

**Symptom:** dragging images from Finder into the media pool did nothing.

### Root cause: the thumbnail stream was never applied to the project

`import_media_files` returns media with `thumbnail_path: null` and generates thumbnails on a
background thread, emitting `thumbnails-ready` as they land. The Rust side documents the contract:
*"The frontend merges these straight into its in-memory project."* It didn't. `MediaPoolPanel`'s
listener only called `bumpThumbnailVersions(ids)` — a local cache-bust counter — and never wrote
`thumbnailPath` back into the store.

`MediaPoolTile` renders `!media.thumbnailPath ? <pulsing placeholder> : <img>`. So imported media
sat on the placeholder **forever**, and the drop looked like a no-op.

**Why creating a project looked fast:** it isn't faster generation — it is the *same* backend call.
The difference is that creation navigates home → editor, which runs `get_project`, re-reading the
project file the background thread has already written thumbnail paths into (and healing any that
are missing). The open-project path never re-reads, so it never saw them.

### Secondary defects fixed

1. **The subscription was re-registered on every batch it received** (`mediaPool` in the dep array).
   `listen` is async, so each re-registration left a window with no listener — updates were dropped,
   and the more images imported the more went missing.
2. **Two global drop listeners.** Tauri broadcasts drag-drop to the whole webview; `MediaPoolPanel`
   and `useCanvasFileDrop` both subscribed and neither checked position. A drop over a floating
   media pool ran two concurrent imports; the second saw the first's filenames already present,
   imported nothing, and wrote back a project captured before the first finished — erasing it.
3. **`importMedia` captured `project` before its await** and merged into that stale copy.
4. **Drag positions are physical pixels**, compared directly against CSS-pixel DOM rects — every
   canvas file-drop bounds check was off by `devicePixelRatio` on a HiDPI display.
5. **Format allowlists disagreed**: the canvas filter accepted `.tiff`/`.tif`, `is_image_file`
   rejected them, so those files imported nothing with no error.

### Backend: why import into an established project is slower

`still_present()` re-read **and re-parsed the entire project JSON per job, per phase** — 2N full
parses for N images, with every rayon worker contending on one file. Cost scales with total
document size (all elements + the whole media pool), which is near-zero on a fresh project and
significant on an established one. Now snapshotted once per phase into a `HashSet`; deletions
mid-phase are still honoured by the writer, which discards vanished media and removes the orphan.

The writer's per-batch read → parse → `to_string_pretty` → atomic write of the whole document is
inherent to the file-per-project design and was left alone.

### Changed

- `stores/mediaStore.ts` — `thumbnailVersions` + `applyThumbnailUpdates()` / `bumpThumbnailVersions()`;
  `importMedia` re-reads after its await and de-dupes by id.
- `hooks/useThumbnailSync.ts` (new) — single session-long subscription, mounted by `EditorLayout`.
- `utils/dropZones.ts` (new) — `isPointerOverMediaPool()` + physical→CSS `toCssPoint()`; both drop
  handlers consult it so exactly one claims each drop.
- `MediaPoolPanel.tsx` — local listener and local version map removed; container tagged
  `data-media-dropzone`.
- `commands/media.rs` — per-phase live-id snapshot.
- `commands/utils/image_processing.rs` — TIFF added to the allowlist.
