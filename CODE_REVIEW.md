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

## Multi-slide (spanning) elements — home-slide semantics unified (2026-07-13)

**Bug (user-reported):** 2-panel template image spanning two slides; dragging its slide from
the end to the middle left the image hanging off the right edge of the canvas instead of
following the slide.

**Root cause:** slide ops (`removeSlide`/`reorderSlides`/`duplicateSlide` shift logic) homed
elements on the slide under their **left edge** (`getSlideIndex(element.x)`), while the rest of
the app (selection, slide indicators, template capture) homes by **center**
(`getSlideIndexFromCenter`). A 2-slide-wide image spanning [N, N+1] has its center exactly on
the boundary, which floors to N+1 — the UI shows it as N+1's content, but reorder treated it
as N's. Moving slide N+1 put the image's home (N) in the "shift right" range, pushing the span
to [N+1, N+2] — off-canvas when N+1 was last.

**Fix (`slideStore.ts`):** `getHomeSlideIndex` now takes the element and homes by center,
clamped to `[0, numSlides-1]` (covers both the old negative-x exemption and its mirror on the
right edge). All five call sites updated.

**Deliberate behavior change:** deleting a slide now deletes the elements whose *center* is on
it (matches what the UI highlights), not those whose left edge is on it. For a spread this
means the image lives with its right slide on the exact boundary. Spreads still can't survive
their two slides being separated — the half over a non-moved slide overlaps whatever slide ends
up there; that's inherent, not a bug.

**Test:** 2-panel spread at the end → drag its slide to the middle → whole spread follows
(image spans the moved slide and the one before it). Also: delete each slide of a spread and
check which half survives; reorder non-spread slides to confirm no regression; undo/redo the
reorder.

## Placeholder frames as replace/fill targets (2026-07-13)

**User report:** R-replace and F-fill don't work on (image) frames — hit hard by the 2-panel
template, which instantiates as a placeholder frame spanning two slides.

**Archaeology:** not a regression — `getReplacementTarget` has excluded placeholders since the
original replace feature (`d7362f2`), and F-fill computes its region from snap lines, which
include the slide boundary running through the middle of a multi-slide frame (so F over a
2-panel frame filled only half, or dropped a new element on top leaving the empty frame
beneath). Plain drop-on-frame was the only frame-fill path.

**Changes:**
- `useCanvasFillMode.ts`: `ReplaceTarget` gains `targetType: 'photo' | 'placeholder'`;
  `getReplacementTarget` now accepts placeholder frames; new exported `findPlaceholderAt`
  (topmost frame by z-order) shared by all hit-tests.
- `useCanvasMediaDrop.ts` (media-pool drags): replace branch sets `type: 'photo'` (converts
  frames; no-op for photos). Placeholder hit-test moved ABOVE the fill branch and switched to
  `findPlaceholderAt`, so **F-drop over a frame fills the frame** instead of region-filling
  half of it. Preview labels: "Fill frame (F)" / "Fill frame (R)" vs "Fill area (F)" /
  "Replace image (R)".
- `CanvasArea.tsx` (canvas element drags): R and F over a frame both route to the
  media-transfer flow (frame consumes the dragged element's media + embedded asset, dragged
  element removed, single history entry, `type: 'photo'` conversion). Frame preview wins over
  region preview. Uses an `elementsRef` so `handleDragMove` doesn't regain an `elements` dep.

**Test:** ① empty 2-panel frame + drag pool image over it with F → whole frame highlights,
drop fills both panels; ② same with R; ③ plain drop still fills; ④ drag an existing canvas
photo onto the frame with R and with F → frame takes the image, dragged element disappears,
one undo restores both; ⑤ R onto a filled photo still swaps; ⑥ F over empty canvas area still
region-fills; ⑦ undo after each converts the frame back to a placeholder.

## Crop-mode rotation: shadow fix, 360°, rotation dial (2026-07-19)

**User requests:** (1) the dark shadow outside the crop frame didn't rotate with the image
during Straighten — it stayed shaped like the unrotated image; (2) allow full 360° content
rotation in crop mode (rotate the image inside the frame without changing the frame);
(3) new rotation UI: hovering angle indicator above the image, click-drag in a circular motion
around the image with clock-style tick marks that rotate with it, Shift = fine mode.

**Root cause (1):** `CropOverlayDarkOverlay` drew four axis-aligned rects covering
`fullBounds − cropRect`, but the rotation preview (in `CropOverlay`) imperatively transforms
the image node — rotated by `element.rotation + contentRotation` and cover-scaled around the
crop-rect center. Rotated image corners poked out undarkened and the shadow rects covered
empty canvas.

**Changes:**
- `CropOverlayDarkOverlay.tsx`: new optional `rotatedShadow` prop — a single Konva `Shape`
  filling the transformed image footprint quad (clockwise) with the crop window wound
  counterclockwise (nonzero fill rule punches the hole). Zero-rotation path unchanged.
- `CropOverlay.tsx`: computes the footprint with the exact same math as the rotation preview
  effect (pivot = crop-rect center, `coverScaleForRotation`, +`element.rotation`; flip ignorable
  since mirroring maps the rect's corner set onto itself). Also mounts the new dial.
- `contentRotation.ts`: `CONTENT_ROTATION_MAX` 45 → 180; `clampContentRotation` now **wraps**
  into [-180, 180] instead of pinning, so continuous dial rotation rolls over. Cover-scale math
  was already valid for arbitrary angles. Toolbar slider/number input pick up ±180 from the
  constant; the slider's pointer-drag **pins** at ±180 (a linear slider jumping +180 → −180
  mid-drag reads as a glitch — the dial is the control that wraps).
- `CropRotationDial.tsx` (new, Konva): floating angle pill (rotate icon + live degree readout)
  above the crop frame, constant screen size via `1/layerScale`. Drag = cursor orbits the
  crop-rect center; incremental shortest-arc deltas (no ±180 seam jump); Shift ×0.1 fine mode
  read per event; double-click resets to 0°. While dragging: tick ring around the image
  (every 5°, major every 45°) rotated by `contentRotation` so it turns with the image, plus a
  fixed blue 12-o'clock marker as reference. Window pointer listeners cleaned up on unmount
  (crop exit mid-drag). History is free: changes flow through the same `contentRotation` prop
  as the slider → existing 400ms-debounced crop-history effect batches a drag into one undo.
- `CanvasArea.tsx`: passes `layerScale={scale * zoomLevel}` to `CropOverlay`.

**Test:** straighten to various angles → shadow hugs the rotated image exactly (no bright
corners, no dark patches on empty canvas), including after moving/resizing the crop rect and
during Option+scroll zoom; drag the pill in circles → image follows cursor 1:1 through full
360°, ticks rotate, Shift slows to 0.1×, crossing straight-up/down doesn't jump; double-click
pill resets; undo/redo inside crop mode restores rotation; Apply → final render matches the
crop preview at large angles (90°, 180°); slider still works and pins at ±180.

### Rotation pivot redesign — fixed image center (2026-07-19, round 4)

User report: "border math still broken", and dragging the crop rect after rotating visibly
moved/spun the image. Root cause was a genuine design conflict, not an arithmetic slip:
content rotation pivoted around the LIVE crop rect's own center, which is what let the image
hug the crop borders tightly (the round-3 fix), but it also meant the pivot moved every time
the rect was dragged — moving a rotated image's pivot necessarily repositions it on screen.
Tight/minimal scale is inherently position-dependent (how much cover you need depends on
exactly where the window sits), so it can't be made "stable under dragging" without changing
what the pivot is anchored to.

**User decision (asked via AskUserQuestion): pivot fixed at the source image's own center.**
Dragging the crop rect no longer moves or spins the underlying image at all; the adaptive
cover scale still keeps it minimal for wherever the rect currently is, so it only zooms
(grows around its own fixed center) as the rect nears the rotated image's edge — never pans.
`contentCoverScale` (contentRotation.ts) was rewritten around this: pivot is always
`(fullWidth/2, fullHeight/2)`, so margins are constant in every direction (no more per-side
lookup) and the required scale is `max(|inverse-rotated corner offset| / half-extent)` over
the 4 window corners.

Two new pivot helpers formalize the composition with `element.rotation` (the frame's own
tilt on canvas, independent of content rotation):
- `contentPivotLocalOffset(fullW, fullH, windowX, windowY)` — the image center's position
  relative to the window's top-left, i.e. in the frame's own unrotated coordinate space.
  Used directly as a child's x/y by the FINAL renderer (`CanvasElementRenderer.tsx`), whose
  clip Group already composes `element.rotation` for free via real Konva nesting.
- `contentPivotDisplay(frameX, frameY, elementRotationDeg, fullW, fullH, windowX, windowY)`
  — the same offset, but manually rotated by `elementRotationDeg` and added to the frame's
  absolute position. Needed by crop-mode's preview and shadow, which imperatively drive a
  single FLAT node (no wrapping Group to lean on) — this closes a **separate, pre-existing
  correctness gap**: crop-mode's rotation preview was fusing `element.rotation +
  contentRotation` into one rotation around one pivot, while the confirmed render always
  correctly used a two-level composition (frame tilts around its own corner, content spins
  independently inside). They only diverged for elements that are both tilted on canvas AND
  content-rotated — a narrow combo, but a real mismatch between preview and Apply. Fixed as
  part of this pass since the correct pivot was needed anyway.

Callers of the fixed pivot use `existingCropX/Y` (the crop SESSION's base window) rather
than the live-dragged `cropRect` — these only change via Option+scroll / reset / aspect-ratio
changes, not plain box-dragging, which is exactly what keeps the pivot stationary while
dragging but still lets it re-baseline correctly for those other (legitimately
pivot-shifting) gestures.

**Test:** rotate a photo in crop mode, then drag the crop rect around — the underlying image
must stay completely still (no pan, no spin), only the crop-rect outline moves, with the
image's zoom breathing subtly as the rect nears an edge; Option+scroll should still shrink
the image down to touch the (now-stationary) rect's borders at any rect position; apply and
confirm the canvas matches the preview exactly; the previous 90° horizontal→portrait test
case (image can shrink until edges touch a portrait frame) should still hold.

**Known, deliberately unfixed:** crop-mode's preview of a *plain* `element.rotation`
(element tilted on canvas, but WITHOUT any content rotation, AND with a pre-existing crop)
still pivots around the full image's own top-left corner rather than the frame's — a
pre-existing bug unrelated to this feature, out of scope for this pass. Flagging for a
future fix.

### Follow-up fixes (2026-07-19, round 3)

Round 2's Option+scroll "rotation-aware floor" was itself the bug the user hit next
("this is as small as I can make this 90° rotated image"): it conflated two different
quantities. `contentCoverScale` returns an ABSOLUTE required ratio (e.g. "must be 1.4× the
frame to avoid blank corners"), but the wheel handler's `scaleFactor`/`clampedScale` is a
RELATIVE per-tick zoom multiplier on the image size. Using the absolute ratio as a floor on
the relative multiplier permanently pinned the image at that size — since coverage is
already guaranteed automatically at render time (that's the whole point of round 2's
adaptive `contentCoverScale`), the floor was pure noise. Removed it entirely; the wheel
handler now only has to keep the crop WINDOW valid (the original 6 constraints), same at
every rotation.

Two more requests bundled in:

- **90° snap on the rotation dial.** `snapContentRotation()` (contentRotation.ts) rounds to
  the nearest multiple of 90° within a 4° tolerance, Konva-Transformer-style — catches near
  the cardinal angles, releases smoothly outside the band. Applied in the dial's drag-move
  handler; Shift (fine-tune mode) skips it since that mode exists for precise sub-degree
  control.
- **Rotation dial rendered under the slide-number tabs.** `CanvasSlideIndicators` sets
  `z-30`; the Konva `Stage` (a DOM sibling under the same positioned ancestor) had no
  z-index, so the tabs always painted above everything drawn on the canvas — including the
  crop dial — regardless of DOM order or what's drawn inside Konva. Reordering Konva nodes
  can't fix cross-DOM-element stacking. Fix: the Stage's wrapper style now sets
  `zIndex: cropModeElementId ? 40 : undefined` — bumped only while actively cropping, so
  normal editing keeps the original stacking.

**Test:** rotate 90° on a horizontal photo in crop, Option+scroll down — shrinks all the way
until the image edges meet the crop borders with no residual oversize; drag the dial near
0/90/180/270 — rotation catches there and releases past the ~4° band; Shift-drag near those
angles — no catch, free sub-degree movement; enter crop mode — the angle pill and (while
dragging) the tick ring render above the slide number tab strip at the top of the canvas.

### Swap follow-ups — panel spam, stranded border, empty frames

**Slides panel toggled repeatedly after a swap drop.** The drag guard sat in the keydown
handler, but the key is still held when the drop completes: the moment `isDraggingElement`
goes false, auto-repeat keydowns start passing the guard and each one toggles the panel.
Fixed with a swallow latch — a key pressed while a drag is running stays suppressed until it
is physically released (cleared on blur too, since keyup can be missed if focus leaves).
Also added a blanket `e.repeat` guard: holding a key should never drive a panel toggle.

**Selection border stranded where the drag ended.** Different mechanism from the earlier
"floating border after delete" fix, which cleared the *Transformer* when an element was
destroyed — that fix was correct and remains. This one is the selection *stroke*: it is a
sibling node moved imperatively during the drag (deliberately, so selection doesn't
invalidate the image cache). When a drag ends with the element's committed x/y UNCHANGED —
a swap leaves both frames put; snap-backs do the same — React diffs identical props, skips
the re-render, and the stroke is never pulled back from wherever the pointer left it. Now
re-seated on the node's final position inside `CanvasElementRenderer.handleDragEnd`, which is
the genuinely global spot: every drag path funnels through it (the rotated branch's clip
Group is re-seated there too).

**Empty frames are now valid swap targets**, in both directions — drag a photo onto an empty
frame (image moves across, an empty frame is left behind, ready for the next photo), or drag
an empty frame onto a photo. `moveInto` emits a placeholder when the source side has no
media, clearing mediaId/assetPath/crop/rotation/flips. Guarded so two empty frames don't
"swap" into a no-op. This intentionally overlaps replace/fill on placeholder targets: those
MOVE an image and consume the source element, whereas swap leaves the source frame standing.

### Swap (S) + no crop-mode entry mid-drag

**Swap.** Hold **S while dragging a canvas element** over another photo: the two images trade
frames. Each frame keeps its own geometry (position, size, rotation, z-order) and neither
element moves — only the image payloads change places. Every edit travels with its photo:
media, embedded asset, straighten angle, flips, and crop.

- Crop is re-shaped for the destination frame via new `adaptCropToFrame`. Crop values are
  normalized against the source's PIXEL dimensions, so the visible region's aspect is
  `(cropWidth·imageW) : (cropHeight·imageH)` — using the raw crop values would render
  non-square sources stretched. The new window preserves the centre and is the largest of the
  required shape that still fits INSIDE the old one, so a swap never zooms out to resurrect
  content the user cropped away. Then `fitCropToRotation` re-fits it for the carried
  straighten angle.
- Targets are photos that actually hold an image; placeholders are excluded (nothing to trade
  back — moving an image into an empty frame is what replace/fill already do).
- Green preview highlight, matching the fill (blue) / replace (purple) convention. Snapping is
  suppressed while S is held, as with F/R.
- Undo/redo: one `pushState` entry for the pair, same atomic pattern as replace. No asset
  cleanup is registered — unlike replace, both assets are still referenced afterwards.
- Media-pool drags are unaffected: swap is gated on an element drag being in progress.

**The `s` key conflict.** `s` is bound to `togglePanel.slides`. Rather than move it, swap is
scoped to the drag: `useCanvasFillMode` ignores `s` unless an element drag is live, and
`useEditorShortcuts` now suppresses ALL chrome shortcuts during a drag (the canvas owns the
keyboard for its F/R/S modifiers while dragging). Consequence worth knowing: unlike F and R,
**S cannot be armed before the drag starts** — press it once the drag is under way, or it
toggles the slides panel instead. F/R remain hardcoded drag modifiers (not registry actions),
and S follows that same existing convention.

**Crop mode can no longer open mid-drag.** Guarded inside `cropStore.enterCropMode`, which
covers all three entry points (EditBar button, context menu, keyboard) at once. Crop mode
snapshots element geometry on entry and drives an imperative preview from it; opening while
the element was still moving captured an already-stale position and left the overlay detached.

New shared drag flag `isDraggingElement` on `elementStore` (set in
`handleDragStart`/`handleDragEnd`) backs both behaviours — a store rather than a local ref
because crop mode and the shortcut layer both need to read it.

Harness now at 23 checks; three cover swap: the photo fills its new frame without stretching
(pixel-aware aspect), the window never grows, and repeated back-and-forth swaps stay stable
rather than creeping smaller.

### Rotation round 5 — crop rect reshaping/jumping after zoom-out

Round 4's zoom-out fix exposed two *pre-existing* axis-aligned clamps that only misbehave
once the image is small relative to the rect — a regime that was unreachable before, because
zoom-out used to stop early. Both are the same mistake: measuring a rotated image with its
UNROTATED extents.

**Aspect ratio changed** — `clampCropRect` did `Math.min(rect.width, fullBounds.width)` per
axis. Rotated, the image is legitimately smaller than the rect along an axis (at 90° it only
needs to be as wide as the rect is TALL), so each axis got squashed independently and the
aspect broke. Rotated now applies the rotated-fit limit as ONE uniform factor (the
minimum-size floor too), so the aspect is preserved exactly.

**Rect jumped** — the Option+scroll safety clamp used
`Math.max(0, Math.min(x, newFullBoundsW - rect.width))`. With the image narrower than the
rect that upper bound goes negative, so every scroll step slammed the rect to x=0. Rotated
now routes through `clampWindowToRotatedImage`.

Two harness checks lock this in (20 total): one walks the image down to its limit a scroll
notch at a time and asserts the rect holds its exact aspect, keeps its size, stays inside the
image and never teleports; the other asserts clamping alone never reshapes a rotated rect,
sampled in the just-barely-fits regime where the old code failed.

### Rotation round 4 — zoom-out limit + rotation travels with the photo

**1. 90° images still couldn't be zoomed out.** The Option+scroll floor was
`max(minSX, minSY, rotMin)`. `minSX`/`minSY` (`w/fullW`, `h/fullH`) are the *unrotated* fit
terms: at 90° the window's extent along the image's horizontal axis is its HEIGHT, not its
width, so `minSY` over-constrained and stopped the shrink early — for a 300×500 window that
is a 1.67× premature stop, matching the report. `rotMin` alone is the correct limit at every
angle (it reduces to `max(minSX, minSY)` at 0°), so it is now the whole constraint when
rotated. Positional terms stay unrotated-only; when rotated, position is handled by clamping
the window instead.

**2. Rotation now travels with the photo on replace/fill.** Round 3 reset
`contentRotation: 0` on the element→frame transfer — wrong: the straighten angle belongs to
the PHOTO, so it must follow it into the new frame. The catch is that the destination crop is
a cover-fit computed as if the photo were upright, so carrying an angle onto it would push
the window off the rotated image. New shared helper `fitCropToRotation(frameW, frameH, crop,
degrees)` re-fits any crop for an angle — zooming only as far as the tilt requires and
re-seating the window. Used by BOTH the transfer path and the crop-mode angle-change effect
(the duplicated inline logic there was removed).
- Media-pool → frame drops still reset to 0: the source is a pool item with no angle, and
  the target's angle belonged to the photo being replaced.
- The target frame keeps its own canvas `rotation` — that is a property of the layout slot,
  not of the photo. **If a canvas-rotated source should also rotate the destination frame,
  that is a deliberate product choice still open, not an oversight.**

**Harness caught a real modelling error here** (18 checks now). It initially asserted crop
origins stay in `[0,1]` and failed at 135°. The *test* was wrong: once rotated, the image is
a tilted quad whose corners reach past the upright box, so a window fully inside the image
can legitimately sit at a negative `x`. Replaced with the invariant that actually matters
(containment in the rotated image) plus a new check that straightening back to 0°
re-normalizes the window into range — which is what protects the unrotated renderer, since
Konva's `crop` attr cannot sample outside the source.

### Rotation model rebuild + self-validation (round 3)

**Self-validation (the important part).** `npm run validate:geometry` (or `npm run check`
for tsc + geometry) runs `scripts/validate-geometry.mjs`: 15 property/unit checks over the
rotation, crop-fit, element-bounds and hit-test math, ~20k randomized cases with a fixed
seed. Zero new dependencies — it bundles the TS modules with the esbuild binary already
vendored inside vite, then imports them in plain node. **Run it after any geometry change.**
Each check is phrased as a user-visible promise ("dragging the crop rectangle never rescales
the image", "the image can always be shrunk until its edges meet the crop rectangle"), so a
failure names the broken behaviour, not a formula.

**Root cause of the repeated "border math is still wrong".** The model inflated the image by
a *cover scale computed from the crop window's current position*. Two consequences, both
reported: (1) the image was permanently larger than the frame, so Option+scroll could never
bring its edges down to the crop borders; (2) because the factor was a function of position,
dragging the box sideways recomputed it every frame — the image visibly rescaled/swam.

**New model** (`src/utils/contentRotation.ts`, fully documented in-file):
- The image draws at its **natural size, scale 1**, rotated about **its own centre** — a
  fixed pivot that does not depend on the window. No automatic inflation.
- The **crop window** is what adapts: it is clamped to stay inside the rotated image
  (`clampWindowToRotatedImage`). Drag/resize slide to a stop against the tilted edge.
- Zoom is required **only when the angle changes** (`minImageScaleForRotation`), applied once
  in a `contentRotation`-keyed effect in `CropOverlay` and folded into the crop values.
  Because that factor depends only on sizes and the angle — never position — dragging the
  box structurally *cannot* rescale the image.
- Key simplification: inverse-rotating about the image centre turns "does the axis-aligned
  window fit in the rotated image?" into "does this rotated window fit in the axis-aligned
  image?", and a convex shape fits a box exactly when its bounding box does. That is where
  the position-independence comes from.
- `contentRenderScale` remains as a **safety net only** (returns exactly 1 for all
  well-formed state; asserted by the harness) to rescue legacy elements saved under the old
  model, which would otherwise show blank corners.
- Option+scroll's floor is now the rotated-fit limit — literally "shrink until the edges meet
  the box". At 0° it reduces to the previous width/height limits.

**Rotation coverage elsewhere** (elements rotate about their **top-left anchor**, so a
rotated element's footprint is *not* `[x, x+width]` — at 90° it sits entirely left of `x`):
- `getRotatedBounds` (`coordinates.ts`) — shared footprint helper. Snap lines from other
  elements, the dragged element's own snap rect, and the on-canvas drag clamp all use it.
  Snapping previously aligned an invisible box; the drag clamp stopped ~a full dimension
  early (the reported "can't drag a 90° image far enough right").
- `isPointInRotatedRect` (`coordinates.ts`) — rotation-exact hit test, now used by
  `findPlaceholderAt` / `getReplacementTarget`, so tilted frames are clickable where they are
  drawn rather than where their unrotated box used to be.
- Replace / placeholder-fill / element-to-frame transfer now reset `contentRotation: 0`. The
  frame's own `rotation` is preserved (those are merges), but the straighten angle belonged
  to the outgoing photo and was being applied to the incoming one against a crop window that
  had just been recomputed as if unrotated.

**Known limitation:** crop mode's overlay chrome (dark mask, box, handles) is drawn
axis-aligned, so cropping an element that is itself rotated on canvas shows an upright box
over a tilted image. The image transform itself is correct — `contentPivotDisplay` composes
`element.rotation` exactly as the final renderer's nested Group does, so preview matches
Apply — but the chrome does not tilt with it.

**Test:** rotate in crop → Option+scroll down until the image edges sit on the crop borders
(should now be reachable at any angle, including 90° on a landscape photo); drag the box
around at 45° and 90° — the image must not move or resize at all, the box just stops at the
tilted edge; rotate a frame 90° on canvas → drag it to every canvas edge; snap it against
another element (guides should align to what you see); drop a new photo onto a frame that had
a straightened image → new photo must come in upright.

### Follow-up fixes (2026-07-19, round 2)

Three user-reported bugs after the dial landed:

**1. Dial rotation not undoable in crop mode.** The crop-history push for rotation is
debounced 400ms after the last change; Cmd+Z pressed right after a dial drag found no entry
(and the entry landed afterwards, making undo look dead). Fix: `CropRotationDial` now calls
`onRotateEnd(finalDeg)` on pointer-up / double-click reset, and `CropOverlay` pushes the
entry immediately (cancelling the pending debounce; a late duplicate is deduped by
`entriesEqual`). The debounced watcher remains for the toolbar slider.

**2. Rotated content couldn't be scaled down to the crop borders.** The model inflated
rotated content by a FIXED cover scale computed from the frame alone
(`coverScaleForRotation`), so the drawn image was always bigger than the frame by that
factor and Option+scroll hit the unrotated clamp long before edges met the borders. New
model — same element state, crop values stay in [0,1]:
- `contentCoverScale(fullW, fullH, windowX/Y/W/H, deg)` — ADAPTIVE scale: `max(1, smallest
  factor that keeps the frame covered given where the crop window sits inside the image)`.
  With margin available the image draws at natural scale (edges can sit against the frame);
  the factor rises only to prevent blank corners. Reduces to the old formula when the window
  spans the whole image.
- `CanvasElementRenderer` rotated branch now draws the FULL image (no Konva `crop` attr,
  which can't sample beyond its window) positioned so the window lands on the frame, inside
  the existing frame-shaped clip Group — mirroring the crop-preview transform exactly.
  Caching moved from the (now oversized) image node to the clip Group with explicit frame
  bounds (raster = frame-sized; no cover multiplier needed since rasterization happens after
  the scale). `useSlideExport` matches any cached node (was `find('Image')`) and re-caches
  Groups with their width/height bounds.
- Option+scroll min-scale gains a rotation-aware floor (inverse-rotated crop-rect corners vs
  pivot-to-edge margins); identical to the old six constraints at 0°, binds where the rotated
  image's edges meet the crop rect at other angles. The old window-in-source constraints are
  kept so crop values can never leave [0,1].
- Note: at exactly ±90° with an extreme-aspect source, some residual overscan can remain —
  a perfect fit there would need the stored crop window itself to exceed the source, which
  would leak out-of-range crop values through every crop interaction. Typical sources reach
  full touching.

**3. 90°-rotated elements couldn't be dragged right (outside crop).** `clampToVisibleBounds`
assumed the element occupies `[x, x+w]×[y, y+h]`, but elements rotate around their top-left
anchor — at 90° the footprint sits entirely left of `x`, so the right-edge clamp fired ~a
full width early. Now clamps the rotated AABB (corner offsets around the anchor); at 0° the
math is identical to before. All three call sites (drag move, drag end, keyboard nudge) pass
`element.rotation`.

**Test:** rotate in crop → Cmd+Z immediately → rotation reverts (and redo works); rotate
~15° → Option+scroll down → image shrinks 1:1 until its edges meet the crop borders, no
blank corners at any angle/pan; rotate 90° in crop on a normal landscape photo → can scale
until the sideways image spans the frame; apply → canvas render matches preview; export a
slide with a rotated image at high res → stays sharp; rotate an element 90° on canvas →
drag it off every canvas edge until ~50px remains visible.

## Fast media import thumbnails (2026-07-14)

**User report:** Finder → media pool import takes far too long before anything usable shows.

**Diagnosis:** no file copying happens on import (media references originals) and the command
returns immediately — the latency was all in the thumbnail pipeline: full decode + **Lanczos3**
resize to 1024px per photo (seconds each on large files), ONE `thumbnails-ready` event after
the entire batch, and meanwhile tiles fell back to `<img src={original}>`, making the webview
decode N full-res photos (jank + competing with the thumbnailer for CPU).

**Changes:**
- Rust `image_processing.rs`: `generate_thumbnail_fast` — 256px via `DynamicImage::thumbnail()`
  (cheap progressive sampler), EXIF orientation applied post-resize. `FAST_THUMBNAIL_MAX_SIDE=256`.
- Rust `media.rs` import: two-phase background pipeline (fast pass → quality pass overwriting
  in place), results streamed through an mpsc channel to a coalescing writer that updates the
  project file and emits `thumbnails-ready` every ~150ms with a payload of
  `{mediaId, thumbnailPath}[]`. **Deleted-media voiding:** workers skip jobs whose media left
  the project (checked before decode); the writer deletes thumbnail files that landed after
  their media was removed.
- All other emit sites (single relink, bulk relink, `get_project` backfill) now send the same
  payload shape.
- `EditorLayout`: listener merges payload paths into the in-memory project via
  `setProjectSilent` — deliberately NOT `refreshProject()`: a re-fetch would clobber unsaved
  in-memory edits and would trigger `get_project`'s low-res backfill on the 256px fast thumbs
  → duplicate regens → more events (feedback loop).
- `MediaPoolPanel`: cache-bust versions bump only for payload ids; tiles with no
  `thumbnailPath` render a lightweight pulse placeholder instead of decoding the original.
- Undo-safety: `applySnapshot` carries live `thumbnailPath`s over snapshots that predate
  generation (thumbnails aren't user state), and `get_project` heals `thumbnail_path: None`
  media — restores the path if `<thumbnails_dir>/<id>.jpg` exists, else queues generation and
  now persists the resulting paths.

**Test:** drop 20+ large photos → tiles pulse briefly, low-res thumbs pop in incrementally
within ~1s, sharpen shortly after; delete a media item mid-import → no error, no thumbnail
resurrection, no orphan file; import → undo → redo → tiles keep thumbnails; relink still
refreshes tiles.

## Frame refill shows stale image (2026-07-13)

**User repro:** fill a frame from the media pool → undo → fill the same frame with a different
image → the FIRST image appears.

**Root cause:** the placeholder-fill path embedded the asset with the element id as the
filename (`assets/<frameId>.jpg`). Refilling the same frame overwrote that file in place, and
since the asset URL was unchanged, the image cache (module LRU + webview HTTP cache) served
the old bytes. It also silently corrupted history: snapshots referencing the old path now
pointed at the new image's content.

**Fix:** embed with a fresh `uuidv4()` filename per fill (`useCanvasMediaDrop.ts` placeholder
branch) — the media-drop replace branch already did this for the same reason. Every other
embed site passes a freshly created element id, which is equivalent.

**Known residual (pre-existing, low priority):** assets referenced only by truncated redo
entries (e.g. fill → undo → do something else) are never registered in `deletedAssets`, so the
files linger in the project's assets dir until project deletion. Applies to all embed paths,
not just frames.

**Test:** fill frame with A → undo → fill with B → B shows (and persists after restart);
fill → undo → redo → A shows; two different frames filled from the same media each work.

## Selection border sync (2026-07-13)

**User report:** after deleting an image or a fill/replace transfer, the transformer border
lingers on the removed element until clicking off; and dragging a not-yet-selected image
doesn't show the border.

**Fixes:**
- `CanvasArea` transformer effect: when the selected id's node no longer exists
  (`stage.findOne` misses — deleted or consumed by transfer), detach the transformer instead
  of silently doing nothing (the effect re-runs via its `elements.find(...)` dep).
- `handleDragStart`: dragging now selects the element (border + transformer + current slide),
  same as clicking — Konva fires dragstart without a click on press-and-move.
- Fill/replace transfer (element drag) and media-drop replace/frame-fill: select the target
  element that received the media, so the border lands on the result.
- `slideStore.removeSlide`: clears element selection when the selected element is deleted
  along with its slide.

**Test:** ① drag an unselected image — border appears immediately on drag start; ② Delete key,
context-menu delete, and deleting a slide containing the selected element — border disappears
with the element; ③ R/F transfer of a selected image into a frame/photo — border moves to the
result; ④ undo after each still restores correct state and selection stays sane.

## Verification checklist — performance pass (test these, riskiest first)

1. **Undo/redo torture test** (snapshot-by-reference is the highest-risk change): make a long
   mixed edit sequence — drag, resize, crop apply, duplicate slide, delete slide, reorder
   layers, paste, replace (R-drop) — then undo all the way back and redo all the way forward.
   Every step must restore *exactly*; watch especially that undoing step N doesn't show state
   from a later step (that would mean something mutated shared state in place).
2. **Crop cancel after edits**: drag an element, wait <0.5s, immediately enter crop mode,
   shift+pan and scale inside crop, Cancel → element must return to its exact pre-crop position.
   Then restart the app → project on disk must also show the pre-crop (post-drag) state.
3. **Rapid nudge + quit**: hold an arrow key (~20 nudges), wait ~1s, quit the app, reopen →
   final position persisted. Also: nudge and quit *immediately* (<0.5s) → at most the last
   burst is lost, project must not be corrupt.
4. **Tab switch mid-edit**: drag an element, immediately switch to another project tab and
   back → the edit must be persisted (flush-before-load path).
5. **Snapping feel**: drag near slide edges/centers/other elements — guides should appear and
   the element should snap at least as crisply as before (now evaluated every frame). Resize
   with corner/side anchors ditto; add/delete an element *between* drags and verify new snap
   targets are picked up on the next drag (lines are per-gesture, so this must work).
6. **Transform snapping with Shift** (centered scaling) — unchanged behavior expected.
7. **Memory sanity** (nice to have): open a big project, pan/zoom around, open Activity
   Monitor → memory should plateau rather than climb indefinitely; switch projects → drop.

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

### Performance — ALL DONE (2026-07-06, second pass)

1. ✅ **Snap lines computed once per drag/transform** (`CanvasArea.tsx`). `handleDragStart` now
   receives the element id (renderer prop signature changed to `(elementId) => void`) and
   computes the drag's snap lines into `dragSnapLinesRef`; `handleDragMove` runs only the cheap
   `findSnap` scan per move — every frame, no throttle. The 32ms/3px throttle + sticky-target
   cache (`lastSnapCalcRef`/`lastSnapTargetRef`/`SNAP_THROTTLE_MS`/`SNAP_MIN_DISTANCE`) is
   deleted. `handleDragEnd` reuses the same lines for the final snap and clears the ref on all
   exit paths (including replace/fill early returns). Same treatment for resize:
   `handleTransformStart` fills `transformSnapLinesRef`, `handleTransform` reads it,
   `handleTransformEnd` clears it. Guides are pushed to the snap store only when they actually
   change (`guidesEqual` in `utils/snapping.ts`) so `CanvasSnapGuides` no longer re-renders per
   mousemove. **Behavior change (intended):** snapping now reacts on every frame instead of
   every ~32ms — should feel *stickier/more precise*, not different.

   **Regression found & fixed (2026-07-13):** after this change the selection border visibly
   detached from the image while dragging inside a snap zone. Root cause was a pre-existing
   sync-order bug in `CanvasElementRenderer.handleDragMove`: the selection stroke (a sibling
   Konva node, synced imperatively per dragmove) was synced BEFORE the parent handler
   snap-adjusted the node — stroke landed on the raw pointer position, image on the snapped
   one (up to the 10px threshold apart). The old throttle masked it by leaving the node at the
   raw position on most frames; per-frame snapping made it constant. Fix: call `onDragMove`
   first, then sync the stroke from the node's post-snap position — the same ordering the
   content-rotation proxy's `syncGroup` already used (its comment documents exactly this).

2. ✅ **History snapshots by reference** (`historyStore.ts`). `createSnapshot` stores the
   `elements`/`slides`/`mediaPool` array references instead of `JSON.parse(JSON.stringify())`
   deep copies — O(1) per push, no more per-edit serialization of the whole document, and up to
   50 retained entries now share structure with live state. Safe because project state is
   immutable everywhere (verified store-by-store; fix 8 removed the last in-place mutation; a
   repo-wide grep for direct property assignment on project objects comes back clean).
   **Invariant to preserve going forward: never mutate elements/slides/media in place.**

3. ✅ **Debounced backend persistence** (`services/projectPersistence.ts`).
   `elementStore.updateElement` no longer writes the whole project JSON per call (each nudge
   keypress!) — it calls `schedulePersistProject()` (500ms debounce). The flush always writes
   the **latest** store state, never a captured copy, so it can't resurrect stale state over a
   newer direct write. Flush points that close the consistency windows:
   - `cropStore.enterCropMode` → flush (crop cancel relies on the backend holding pre-crop
     state; a timer firing mid-crop would have persisted transient crop values),
   - `EditorLayout` project-load effect → flush before `loadProject` (persists the outgoing
     project's last edits on tab switch),
   - `beforeunload` → best-effort flush.
   Worst-case loss window on hard crash: the last ≤500ms of edits. All other mutation paths
   (add/remove/reorder/slide ops/undo/redo) still write immediately.

4. ✅ **imageCache bounded LRU + project-switch clear** (`utils/imageCache.ts`,
   `projectStore.ts`). 64-entry LRU (Map insertion-order eviction, touch-on-access). Eviction
   only drops the cache's own reference — on-screen images are held by `useCanvasImages` and
   Konva, so nothing visibly unloads. `loadProject` clears the cache only when switching to a
   *different* project id.

5. ✅ **`useCanvasImages` media lookup** now via memoized `Map` — was O(elements × mediaPool)
   per image-relevant change.

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

---

## Recurring-pattern audit — centralization pass

Prompted by: *"make sure they are implemented modularly so that we don't need to reimplement them
every time we change something, what other reuseable patterns can you find that should be
centralized?"*

Method: grep each recurring idiom, compare the copies, and treat any divergence between them as a
bug report. Three real defects fell out — all of them cases where a copy never received a fix that
its siblings got.

### Extracted modules

| Module | Replaces | Call sites |
|---|---|---|
| `utils/photoFraming.ts` | `element.width / (cropWidth ?? 1)` + the 4-line cover-crop block | 5 + 5 |
| `utils/konvaPhotoProps.ts` | per-renderer Konva prop derivation (`planPhotoDraw`) | 2 |
| `utils/photoTransfer.ts` | "put this photo in that frame" payload assembly | 4 |
| `utils/elementHitTest.ts` | z-sorted drop-target loops | 3 |
| `hooks/useEditorHistory.ts` | "which undo stack is active?" | 2 |

Plus `historyStore.trackOrphanedAsset()` for the `entries[currentIndex]` reach-in (3 sites).

### Defects the duplication had produced

1. **Slide thumbnails ignored `contentRotation`.** `SlidesPanel` carried its own copy of the
   renderer and never grew the rotated branch, so a straightened photo showed up crooked in its
   own thumbnail. Both renderers now draw from `planPhotoDraw`.
2. **F-fill hit-tested rotated frames against the wrong box.** `findPlaceholderAt` still used an
   axis-aligned comparison while replace and swap had moved to `isPointInRotatedRect`, so holding
   F near a tilted frame filled a frame the cursor was not over. All three use
   `findTopmostElementAt`.
3. **The toolbar Undo button was not crop-aware.** `Cmd+Z` routed to the crop-local stack in crop
   mode; the button always called global undo, reverting the whole project behind an open crop
   overlay, and its enabled state described the wrong stack. Both go through `useEditorHistory`.

Two smaller inconsistencies fixed by unifying the transfer payload: fill-into-region did not
re-fit the crop for the photo's straighten angle (blank corners), and flips did not travel with a
photo on replace/media-drop the way `contentRotation` already did.

`utils/coordinates.ts` and `utils/contentRotation.ts` were already correctly centralized — the
rotation work had pushed the geometry there; what remained scattered was the layer above it.

### Harness

`scripts/validate-geometry.mjs` now bundles `photoFraming` and `elementHitTest` too: 32 checks
(was 23), covering cover-crop shape/centring/degenerate inputs, the full-image-rect ↔ frame
identity that crop mode and reset-crop depend on, no-blank-corners after a transfer at every
angle, and topmost/rotation-exact drop-target selection.

### Remaining candidates (not done — ranked)

1. **Two persistence paths.** `updateProject()` is called directly from 8 modules *and*
   `schedulePersistProject()` debounces through the store. Same operation, different latency and
   different failure handling. A single `persistProject({ immediate })` would remove the "which
   one does this path use?" question — the crop-cancel flush already depends on getting it right.
2. **`getWorldCenter` / `solvePositionForCenter`** are private to `EditBar.tsx` but are general
   rotation-and-flip-aware centre math; the Transformer and nudge paths re-derive parts of it.
   Belongs in `coordinates.ts`.
3. **Modifier-key latches.** `useCanvasFillMode` (F/R/S), `useEditorShortcuts` (swallow latch),
   `CropOverlay` (shift) each hand-roll keydown/keyup tracking with different edge-case handling
   (`repeat`, blur, input-focus). One `useHeldKey(key, { whileDragging })` would make the rules
   uniform.
4. **`Math.max(...elements.map(e => e.zIndex)) + 1`** appears in 5 places — `nextZIndex(elements)`.
5. **Element mutation via `elements.map(el => el.id === id ? {...} : el)`** is written inline in
   components that bypass `elementStore` (the swap and replace paths build the project object
   themselves to get one atomic history entry). A store action taking a set of element updates
   would let those paths keep atomicity without re-implementing the update.
