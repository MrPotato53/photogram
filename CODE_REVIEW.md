# Code Review Findings & Progress

Full-codebase review (2026-07-06). Tracks bugs, performance work, and architecture improvements
across sessions. Status: ✅ fixed · 🔍 needs manual verification · ⏳ open · ❌ not a bug (withdrawn).

Coverage note: all stores, canvas hooks, CanvasElementRenderer, EditorLayout, services, and Rust
command files were read in full. EditBar (824 lines) and CropOverlay (1,066 lines) were only
skimmed — crop-rect math and edit-bar controls not fully audited.

---

## Fixed (2026-07-06)

### ✅ 1. Auto-scroll "cursor outside window" path was dead
`CanvasArea` passed `isDragging: isDraggingRef.current` — a ref read at render time — to
`useCanvasAutoScroll`. Drag start sets the ref but never re-renders, so the hook's global
mousemove effect never attached; edge scrolling stopped the moment the cursor passed the
container edge (`distanceToLeft < 0` → speed 0).

**Fix**: removed the `isDragging` prop and the dead global-listener effect entirely.
`updateScrollSpeed` (called from Konva dragmove) now handles at/past-edge positions with full
speed. The rAF loop keeps the last speed even when the cursor is stationary outside, until
`stopAutoScroll` on drag end. Files: `useCanvasAutoScroll.ts`, `CanvasArea.tsx`.

### ✅ 2. Scroll-to-pasted-element was dead code — removed
`elementMap.get(newIds[0])` after `await pasteElements()` used the pre-paste memoized map, so
the lookup always missed and `scrollToElement` never ran. Analysis: it's also unnecessary —
keyboard paste targets the (clamped) viewport center and right-click paste targets the cursor,
so pasted elements land on screen by construction. Removed the lookup blocks and the now-unused
`scrollToElement` function rather than fixing them.

### ✅ 3. duplicateSlide aliased embedded assets
`duplicateSlide` copied elements with `...element`, keeping the same `assetPath` as the
original. When either copy was later deleted and the deletion fell off the history stack, asset
cleanup deleted the *shared* file — surviving element loses its image (shows red X placeholder).
Note: the user-visible test "delete media from pool → element persists" is *expected* behavior
(elements own embedded copies under `assets/`); the bug was specifically the duplicate sharing
one embedded file.

**Fix**: `duplicateSlide` now embeds a fresh asset copy per duplicated photo element (same
pattern as `duplicateSelectedElement`), preferring the media-pool original, falling back to the
source element's embedded asset, and dropping the aliased path if embedding fails.
File: `slideStore.ts`. Remaining smaller case (⏳): `pasteElements` keeps the aliased path when
`embedElementAsset` throws (error path only).

### ✅ 4. Delete key fired both element-delete and slide-delete
Two independent window keydown listeners: canvas (element delete, gated on `selectedElementId`)
and SlidesPanel (slide delete, gated on `hasFocus`). Clicking a slide thumbnail set `hasFocus`
without clearing element selection → one Delete press ran both.

**Root cause of the observed undo weirdness**: both handlers are async and both read
`useProjectStore.getState().project` *before* either finishes. Each builds its own updated
project from the same stale base and each pushes its own history entry; last write wins.
- Element on a *different* slide: element-delete state got clobbered by slide-delete state
  (built from the base that still had the element) → end state looked correct, but history held
  [elementDeleted, slideDeleted+elementPresent]. Undo stepped to the first entry → slide
  restored AND element vanished in one step. Exactly what was observed.
- Element on the deleted slide: entry 1 = element deleted, entry 2 = slide (and its elements)
  deleted → two undos needed, slide first, element second. Also as observed.

**Fix** (single-owner routing, so history only ever gets one entry per Delete):
- Clicking or right-clicking a slide thumbnail now clears canvas element selection
  (`selectElement(null)`) when the panel takes focus.
- SlidesPanel's Delete handler additionally skips when an element is selected (covers Tab-cycle
  selection, which selects without clicking the canvas and therefore doesn't clear panel focus).
Files: `SlidesPanel.tsx`.

**Deeper issue left open** (⏳, architecture): any two concurrent store actions that read
project state, `await updateProject`, then write, can clobber each other (stale-read /
last-write-wins). The Delete fix removes this trigger but not the class of bug. A queued or
versioned write path would fix it generally.

### ✅ 5. Replace mode leaked/orphaned embedded assets
Three sites fixed:
- **Media-pool → photo (R-drop)** `useCanvasMediaDrop.ts`: now embeds the new media as the
  element's own asset (fresh UUID filename — reusing the element id would overwrite the existing
  asset file in place, breaking undo) and registers the old asset via `trackDeletedAsset` so
  cleanup happens when the entry falls off history (mirrors `removeElement`).
- **Media-pool → placeholder**: now embeds like `addElement` does, instead of leaving the
  element referencing the media-pool file (which breaks if the original moves).
- **Element → element (R-drag)** `CanvasArea.tsx`: target now takes ownership of the removed
  source's embedded asset (`assetPath: element.assetPath` instead of `undefined`); target's old
  asset registered for history-pruned cleanup.

**Undo interaction**: old files stay on disk until the replace entry leaves the history stack —
undoing a replace restores the old image correctly. Same retention model as element deletion.

### ✅ 6. Non-atomic writes of project JSON (data-loss risk)
`fs::write` straight onto `{id}.json` — crash/power-loss mid-write truncates the entire user
document. **Fix**: added `write_atomic` (temp file + `fs::rename`, atomic on the same
filesystem) in `src-tauri/src/commands/utils/fs_atomic.rs`; applied to every project JSON write
site in `projects.rs` and `media.rs` (including background-thread best-effort writes), plus
`templates.rs` and `preferences.rs`. `cargo check` clean.

### ✅ 7. `console.time('createSnapshot')` removed
Answer to "is this debugging or how history saves?": it was pure instrumentation.
`console.time`/`timeEnd` only start a stopwatch and print `createSnapshot: Nms` to the devtools
console on **every history push**. The actual snapshot (the `JSON.parse(JSON.stringify(...))`
between them) is the mechanism and is untouched. Removing the two lines changes no behavior —
just stops console spam and the (tiny) timer overhead.

### ✅ 8. slideStore mutated store state in place
`updatedSlides.forEach((slide) => { slide.order = index; })` wrote through to the *same* slide
objects held by current store state (filter/splice copy the array, not the objects).

Answer to "what change detection would this have broken?" — current impact was **almost nil**,
which is why it never bit:
- React re-renders happen anyway because `setProject` swaps the top-level project object; the
  UI renders slides by array position, barely reading `.order`.
- History snapshots are deep copies taken at push time, so past entries were already safe.

The risk was latent, and became concrete with planned work: (a) any future `React.memo`/selector
keyed on slide object identity would skip re-rendering a slide whose `order` changed, and
(b) the planned history optimization (store references instead of deep copies — see backlog)
is only correct if state is never mutated in place. **Fix**: both sites now map to new objects.
This unblocks the snapshot optimization.

### ✅ 9. Keyboard nudge now clamps to visible bounds
Arrows could push an element fully off-canvas (drag path clamped, keyboard path didn't).
**Fix**: `updateElementClamped` wrapper in CanvasArea applies the same `clampToVisibleBounds`
as drag; `clampToVisibleBounds` moved above the keyboard hook. File: `CanvasArea.tsx`.

### ✅ 10. Negative-x elements now participate in slide operations
Drag clamp allows x down to `-width+50`; `floor(x / slideWidth)` gave home index −1, silently
exempting those elements from removeSlide/reorderSlides/duplicateSlide shift logic. **Fix**:
`getHomeSlideIndex` (clamped to ≥ 0) used in all slideStore ops. File: `slideStore.ts`.

### ✅ 11. Wheel zoom no longer drops steps
Answer to "what does this mean in practice?": a fast trackpad pinch/scroll fires several wheel
events between React renders. Each computed `newZoom = staleClosureZoom + delta` and set an
*absolute* value, so all but the last event in a render window were overwritten — zoom felt
sluggish/notchy during fast gestures (e.g. 5 events × 0.05 intended = 0.25, actual ≈ 0.05).
**Fix**: `zoomTargetRef` accumulates synchronously per event; the mouse-anchor math still uses
the rendered zoom (correct for the visible layout). File: `useCanvasZoom.ts`.

### ✅ 12. Synthetic Enter hack replaced
Crop toolbar Apply dispatched `new KeyboardEvent('keydown', {key:'Enter'})` window-wide. Now
`CropOverlay` exposes its confirm path through an `applyRef` handle and the toolbar calls it
directly — same code path as the real Enter key, no fake events. Files: `CropOverlay.tsx`,
`CanvasArea.tsx`.

### ✅ 13. Crop gated to photo elements
'c' key, EditBar Crop button (now disabled for placeholders), and context-menu
Crop / Reset Crop / Reset Aspect Ratio items all require `type === 'photo'`.
Files: `useCanvasKeyboard.ts`, `EditBar.tsx`, `CanvasArea.tsx`.

### ✅ (bonus) Slide deletion now tracks removed elements' assets
`removeSlide` deleted elements without registering their embedded assets for cleanup —
files orphaned on disk forever. Now mirrors `removeElement`'s `trackDeletedAsset` pattern
(files stay on disk while the deletion is in undo range). File: `slideStore.ts`.

### ❌ Withdrawn: "media removal never reclaims disk"
Wrong on my part. The media pool references the user's **original files** (e.g. a photos
folder); they don't belong to the project and must never be deleted. `removeMedia` correctly
only drops the reference. Only project-owned embedded copies under `assets/` are subject to
cleanup — and those are handled by the asset-retention paths above.

---

## Verification checklist (manual, in-app)

- [ ] Drag element to window edge and beyond → scrolling continues at full speed; stops on drop.
- [ ] Duplicate a slide with photos → check `assets/` dir has new files per duplicate; delete
      original element, make 50+ edits (prune history) → duplicate's image survives.
- [ ] Click slide thumbnail (element selected elsewhere) → element deselects; Delete removes
      only the slide; single undo restores it exactly.
- [ ] R-drop new media onto a photo → undo shows old image; redo shows new.
- [ ] Drop media onto a placeholder → element gets `assetPath` in project JSON.
- [ ] Arrow-nudge element to any edge → always ≥50px remains visible.
- [ ] Fast pinch-zoom → zoom tracks gesture magnitude.
- [ ] Placeholder selected → 'c' does nothing, EditBar Crop disabled, no Crop in context menu.
- [ ] Crop toolbar Apply == Enter behavior.

---

## Open backlog

### Performance (next up)
1. **Snap lines recomputed during drag** (`CanvasArea.handleDragMove`): inputs (other elements,
   slide geometry) are frozen for the whole drag — compute once in `handleDragStart`, keep only
   `findSnap` per move, delete the 32ms/3px throttle + cached-target apparatus. Snapping gets
   *more* responsive.
2. **History snapshots**: state is immutable now (fix 8 was the blocker) — store references
   instead of `JSON.parse(JSON.stringify(...))` deep copies. O(1) pushes, ~50× less history
   memory.
3. **Debounce backend persistence**: every `updateElement` (each drag end, each nudge keypress)
   pretty-prints the entire project JSON and writes to disk. UI is already optimistic; debounce
   the `updateProject` call ~500ms.
4. **`imageCache` never evicts**: full-res `HTMLImageElement`s accumulate for app lifetime.
   LRU or clear on project switch.
5. **`useCanvasImages` O(elements × mediaPool)**: build a media Map first.

### Architecture
1. **Elements have no `slideId`** — slide membership derived from x position everywhere
   (`getSlideIndex`). Root cause of the home-slide edge cases and the shift math in
   remove/reorder/duplicateSlide. Explicit `slideId` + slide-relative x would simplify all of it.
   Biggest structural improvement available.
2. **Concurrent store writes can clobber each other** (see fix 4 notes): read-modify-write with
   `await` in between, no queue/versioning. Serialize project mutations through one writer.
3. **CanvasArea.tsx ~2,100 lines**: extract context-menu block (~400 lines), crop-session state,
   transform-snap handler.
4. **`MAX_SLIDES = 20`** duplicated (CanvasArea const + three hardcoded checks in slideStore +
   SlidesPanel const).
5. **Dead `scale` field on Element** — always 1, never rendered.
6. `useCanvasMediaDrop` attaches window mousemove/mouseup unconditionally (early-return guarded;
   inconsistent with the house rule of attach-on-demand).
7. Redo path doesn't re-soft-delete assets restored by undo (leak-safe direction, but asymmetric).

### UX
1. **No multi-select on canvas** (single `selectedElementId`) — no group move/align/delete.
   Largest workflow gap.
2. Zoom: 150% max is low for photo work; no fit-to-window / zoom-to-selection; reset-zoom
   doesn't anchor the viewport center.
3. Element context menu: flat 12-item list, no separators/shortcut hints; element-menu Paste
   shown even when clipboard is empty (canvas menu checks `hasClipboardData`, element menu
   doesn't).
4. Keep/extend: space-pan, F-fill/R-replace previews, Tab cycling, crop-local undo.

---

## Q&A log (from review discussion)

- **Paste behavior**: keyboard paste centers on the visible viewport center (clamped into the
  slide under it); right-click paste centers on the cursor. Both land on screen by construction,
  so the (dead) scroll-after-paste code was removed, not fixed. No known scenario needs a scroll:
  even zoomed in, the paste target is inside the viewport. Multi-element pastes keep relative
  layout around that center, so outer elements of a very wide selection can extend off screen —
  acceptable; the selection anchor is visible.
- **"Media in use" test (finding 3)**: deleting pool media while elements use it is safe *by
  design* — elements render from their embedded asset copies. The actual bug was duplicates
  sharing one embedded file (now fixed).
- **console.time**: instrumentation only; see fix 7.
- **slideStore mutation impact**: negligible today, fatal for the planned snapshot-by-reference
  optimization; see fix 8.
- **Wheel zoom step loss**: only noticeable on fast trackpad gestures; see fix 11.
- **Original media files**: never deleted by the project — confirmed and finding withdrawn.
