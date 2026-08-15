/**
 * Geometry self-validation harness.
 *
 * Run:  npm run validate:geometry
 *
 * Checks the rotation/crop/snapping geometry against the behaviours the
 * app actually promises, so regressions surface here instead of in the
 * editor. Zero new dependencies: the TS modules are bundled with the
 * esbuild binary that already ships inside vite, then imported.
 *
 * Every assertion below maps to a concrete user-visible behaviour; the
 * describe string is written as that behaviour, not as a math identity.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = mkdtempSync(join(tmpdir(), 'photogram-geom-'));

function bundle(entry, name) {
  const outfile = join(outDir, name);
  execFileSync(
    join(ROOT, 'node_modules/.bin/esbuild'),
    [join(ROOT, entry), '--bundle', '--format=esm', '--log-level=error', `--outfile=${outfile}`],
    { stdio: ['ignore', 'ignore', 'inherit'] }
  );
  return import(pathToFileURL(outfile).href);
}

const R = await bundle('src/utils/contentRotation.ts', 'rotation.mjs');
const C = await bundle('src/utils/coordinates.ts', 'coords.mjs');
const F = await bundle('src/utils/photoFraming.ts', 'framing.mjs');
const H = await bundle('src/utils/elementHitTest.ts', 'hittest.mjs');

// ── tiny assertion kit ───────────────────────────────────────────────
let passed = 0;
const failures = [];

function check(describe, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    failures.push({ describe, message: err.message });
  }
}

function ok(cond, msg) {
  if (!cond) throw new Error(msg);
}

function near(a, b, tol, msg) {
  if (Math.abs(a - b) > tol) throw new Error(`${msg} (got ${a}, want ${b})`);
}

// Deterministic pseudo-random so a failure is always reproducible.
let seed = 12345;
const rand = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

// Representative angles including the exact quarter turns and the
// awkward in-between ones.
const ANGLES = [0, 1, 15, 30, 45, 60, 89, 90, 91, 120, 135, 179, 180, -37, -90, -135, -180];

// ── The crop-window / rotated-image contract ─────────────────────────

check('a crop window is never left hanging outside the rotated image', () => {
  for (let i = 0; i < 4000; i++) {
    const fullW = 200 + rand() * 1600;
    const fullH = 200 + rand() * 1600;
    const deg = ANGLES[Math.floor(rand() * ANGLES.length)];
    const w = 20 + rand() * fullW * 0.9;
    const h = 20 + rand() * fullH * 0.9;
    const m = R.minImageScaleForRotation(fullW, fullH, w, h, deg);
    const sW = fullW * Math.max(1, m);
    const sH = fullH * Math.max(1, m);
    // Deliberately place it out of bounds, then clamp.
    const rect = { x: -500 + rand() * (sW + 1000), y: -500 + rand() * (sH + 1000), width: w, height: h };
    const clamped = R.clampWindowToRotatedImage(sW, sH, deg, rect);
    ok(
      R.isWindowInsideRotatedImage(sW, sH, deg, clamped, 1e-6),
      `window escaped the image: fullW=${sW.toFixed(2)} fullH=${sH.toFixed(2)} deg=${deg} rect=${JSON.stringify(rect)} clamped=${JSON.stringify(clamped)}`
    );
  }
});

check('clamping keeps the window exactly the size the frame asked for', () => {
  for (let i = 0; i < 1000; i++) {
    const fullW = 300 + rand() * 900;
    const fullH = 300 + rand() * 900;
    const deg = ANGLES[Math.floor(rand() * ANGLES.length)];
    const w = 20 + rand() * 200;
    const h = 20 + rand() * 200;
    const m = Math.max(1, R.minImageScaleForRotation(fullW, fullH, w, h, deg));
    const rect = { x: rand() * fullW, y: rand() * fullH, width: w, height: h };
    const c = R.clampWindowToRotatedImage(fullW * m, fullH * m, deg, rect);
    near(c.width, w, 1e-9, 'clamp changed window width');
    near(c.height, h, 1e-9, 'clamp changed window height');
  }
});

check('a window already inside the image is left completely untouched', () => {
  for (let i = 0; i < 1000; i++) {
    const fullW = 400 + rand() * 800;
    const fullH = 400 + rand() * 800;
    const deg = ANGLES[Math.floor(rand() * ANGLES.length)];
    const w = 20 + rand() * 100;
    const h = 20 + rand() * 100;
    const m = Math.max(1, R.minImageScaleForRotation(fullW, fullH, w, h, deg));
    const sW = fullW * m;
    const sH = fullH * m;
    const seedRect = { x: rand() * sW, y: rand() * sH, width: w, height: h };
    const inside = R.clampWindowToRotatedImage(sW, sH, deg, seedRect);
    const again = R.clampWindowToRotatedImage(sW, sH, deg, inside);
    near(again.x, inside.x, 1e-6, 'clamp moved an already-valid window (x)');
    near(again.y, inside.y, 1e-6, 'clamp moved an already-valid window (y)');
  }
});

// ── THE regression the user kept reporting ───────────────────────────

check('dragging the crop rectangle never rescales the image', () => {
  // The whole point of the fixed image-centre pivot: the zoom factor must
  // depend on the window's SIZE and the angle, never on where it sits.
  // Prove it by sweeping the window across the entire image and showing
  // the scale is bit-identical at every position.
  for (const deg of ANGLES) {
    const fullW = 900;
    const fullH = 600;
    const w = 240;
    const h = 180;
    const base = R.contentRenderScale(fullW, fullH, w, h, deg);
    for (let i = 0; i < 200; i++) {
      const rect = { x: rand() * fullW, y: rand() * fullH, width: w, height: h };
      // Position must not be an input at all — assert via the clamp path
      // that the scale used for rendering is unchanged wherever it lands.
      const clamped = R.clampWindowToRotatedImage(fullW, fullH, deg, rect);
      const moved = R.contentRenderScale(fullW, fullH, clamped.width, clamped.height, deg);
      near(moved, base, 0, `scale drifted while the window moved at ${deg}°`);
    }
  }
});

check('the image can always be shrunk until its edges meet the crop rectangle', () => {
  // At exactly the minimum scale the window must still fit, and any
  // smaller must fail — that boundary IS "edges touching".
  for (const deg of ANGLES) {
    for (let i = 0; i < 200; i++) {
      const fullW = 300 + rand() * 900;
      const fullH = 300 + rand() * 900;
      const w = 20 + rand() * 250;
      const h = 20 + rand() * 250;
      const m = R.minImageScaleForRotation(fullW, fullH, w, h, deg);
      const atW = fullW * m;
      const atH = fullH * m;
      // Centre the window: at the limit that is the only fitting spot.
      const rect = { x: (atW - w) / 2, y: (atH - h) / 2, width: w, height: h };
      ok(
        R.isWindowInsideRotatedImage(atW, atH, deg, rect, 1e-6),
        `window did not fit at the stated minimum scale (${deg}°)`
      );
      const shrunk = 0.98;
      ok(
        !R.isWindowInsideRotatedImage(atW * shrunk, atH * shrunk, deg, {
          x: (atW * shrunk - w) / 2,
          y: (atH * shrunk - h) / 2,
          width: w,
          height: h,
        }, 1e-6),
        `minimum scale was not tight — image could still shrink at ${deg}°`
      );
    }
  }
});

check('a 90°-rotated landscape photo shrinks down to the crop rectangle', () => {
  // The exact case reported: horizontal photo, rotated 90° in crop mode,
  // "this is as small as I can make it". At 90° the image only needs to
  // be as wide as the window is TALL, and as tall as the window is WIDE.
  const w = 300; // window (frame) is portrait
  const h = 500;
  const fullW = 2000;
  const fullH = 1200;
  const m = R.minImageScaleForRotation(fullW, fullH, w, h, 90);
  near(m, Math.max(h / fullW, w / fullH), 1e-9, '90° limit is not the swapped-dimension limit');
  ok(m < 1, 'a large landscape image should have room to shrink at 90°');
  const atW = fullW * m;
  const atH = fullH * m;
  near(Math.min(atW / h, atH / w), 1, 1e-9, 'at the limit an image edge should touch the window');
});

check('rotating to a quarter turn asks for the swapped-dimension zoom', () => {
  for (const deg of [90, -90, 270]) {
    const m = R.minImageScaleForRotation(400, 400, 200, 100, deg);
    near(m, Math.max(100 / 400, 200 / 400), 1e-9, `wrong zoom at ${deg}°`);
  }
});

check('with no rotation the model behaves exactly as it always did', () => {
  for (let i = 0; i < 500; i++) {
    const fullW = 100 + rand() * 900;
    const fullH = 100 + rand() * 900;
    const w = 10 + rand() * fullW;
    const h = 10 + rand() * fullH;
    near(
      R.minImageScaleForRotation(fullW, fullH, w, h, 0),
      Math.max(w / fullW, h / fullH),
      1e-9,
      'unrotated zoom limit changed'
    );
    near(R.contentRenderScale(fullW, fullH, w, h, 0), 1, 0, 'unrotated images must never be scaled');
    const rect = { x: -50, y: fullH + 20, width: Math.min(w, fullW), height: Math.min(h, fullH) };
    const c = R.clampWindowToRotatedImage(fullW, fullH, 0, rect);
    near(c.x, 0, 1e-9, 'unrotated clamp should pin to the left edge');
    near(c.y, fullH - rect.height, 1e-9, 'unrotated clamp should pin to the bottom edge');
  }
});

check('well-formed crop state never triggers a rescue zoom at render time', () => {
  for (let i = 0; i < 2000; i++) {
    const fullW = 200 + rand() * 1200;
    const fullH = 200 + rand() * 1200;
    const deg = ANGLES[Math.floor(rand() * ANGLES.length)];
    const w = 20 + rand() * 200;
    const h = 20 + rand() * 200;
    const m = Math.max(1, R.minImageScaleForRotation(fullW, fullH, w, h, deg));
    // After the rotation-time refit the window fits, so the renderer must
    // draw at natural size — any inflation here would be the old "image is
    // always bigger than the frame" bug coming back.
    near(R.contentRenderScale(fullW * m, fullH * m, w, h, deg), 1, 1e-9, `renderer inflated a valid crop at ${deg}°`);
  }
});

// ── Angle handling ───────────────────────────────────────────────────

check('spinning the dial past a half turn rolls over instead of sticking', () => {
  near(R.clampContentRotation(190), -170, 1e-9, '190° should wrap');
  near(R.clampContentRotation(-190), 170, 1e-9, '-190° should wrap');
  near(R.clampContentRotation(360), 0, 1e-9, 'a full turn should return to zero');
  near(R.clampContentRotation(725), 5, 1e-9, 'multiple turns should wrap');
  near(R.clampContentRotation(45), 45, 1e-9, 'ordinary angles must pass through');
});

check('the dial catches at quarter turns but still lets go', () => {
  near(R.snapContentRotation(2), 0, 1e-9, 'should catch near 0°');
  near(R.snapContentRotation(88.5), 90, 1e-9, 'should catch near 90°');
  near(R.snapContentRotation(-91), -90, 1e-9, 'should catch near -90°');
  near(R.snapContentRotation(30), 30, 1e-9, 'must not catch far from a quarter turn');
  near(R.snapContentRotation(45), 45, 1e-9, 'must not catch at 45°');
  const outside = R.ROTATION_SNAP_TOLERANCE + 0.5;
  near(R.snapContentRotation(outside), outside, 1e-9, 'rotation must be able to leave the snap band');
});

// ── Element bounds (canvas-level rotation) ───────────────────────────

check('a rotated element reports the box you actually see on canvas', () => {
  const b0 = C.getRotatedBounds(10, 20, 100, 50, 0);
  near(b0.x, 10, 1e-9, 'x');
  near(b0.y, 20, 1e-9, 'y');
  near(b0.width, 100, 1e-9, 'width');
  near(b0.height, 50, 1e-9, 'height');

  // At 90° about the top-left anchor the footprint sits to the LEFT of x.
  const b90 = C.getRotatedBounds(0, 0, 100, 50, 90);
  near(b90.width, 50, 1e-9, '90° width should be the original height');
  near(b90.height, 100, 1e-9, '90° height should be the original width');
  near(b90.x, -50, 1e-9, '90° footprint should start left of the anchor');
  near(b90.y, 0, 1e-9, '90° footprint top');

  const b180 = C.getRotatedBounds(0, 0, 100, 50, 180);
  near(b180.x, -100, 1e-9, '180° footprint should start a full width left');
  near(b180.y, -50, 1e-9, '180° footprint should start a full height up');
});

check('the reported box always contains every corner of the element', () => {
  for (let i = 0; i < 3000; i++) {
    const x = -500 + rand() * 1000;
    const y = -500 + rand() * 1000;
    const w = 10 + rand() * 500;
    const h = 10 + rand() * 500;
    const deg = -180 + rand() * 360;
    const b = C.getRotatedBounds(x, y, w, h, deg);
    const rad = (deg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    for (const [px, py] of [[0, 0], [w, 0], [w, h], [0, h]]) {
      const cx = x + px * cos - py * sin;
      const cy = y + px * sin + py * cos;
      ok(
        cx >= b.x - 1e-6 && cx <= b.x + b.width + 1e-6 &&
        cy >= b.y - 1e-6 && cy <= b.y + b.height + 1e-6,
        `corner (${cx.toFixed(2)}, ${cy.toFixed(2)}) escaped bounds at ${deg.toFixed(1)}°`
      );
    }
  }
});

check('a straightened photo keeps its angle when dropped on another frame', () => {
  // fitCropToRotation is what lets the angle travel: whatever crop the
  // cover-fit produced (computed as if upright), the result must be valid
  // AT that angle — otherwise the new frame would show blank corners.
  for (let i = 0; i < 3000; i++) {
    const frameW = 40 + rand() * 900;
    const frameH = 40 + rand() * 900;
    const deg = ANGLES[Math.floor(rand() * ANGLES.length)];
    const cropWidth = 0.05 + rand() * 0.95;
    const cropHeight = 0.05 + rand() * 0.95;
    const cropX = rand() * (1 - cropWidth);
    const cropY = rand() * (1 - cropHeight);

    const out = R.fitCropToRotation(frameW, frameH, { cropX, cropY, cropWidth, cropHeight }, deg);

    // Sizes stay normalized (the window never exceeds the image).
    ok(out.cropWidth > 0 && out.cropWidth <= 1 + 1e-9, `cropWidth left [0,1] at ${deg}°`);
    ok(out.cropHeight > 0 && out.cropHeight <= 1 + 1e-9, `cropHeight left [0,1] at ${deg}°`);
    // NOTE: the crop ORIGIN may legitimately fall outside [0,1] while
    // rotated — in this frame the image is a tilted quad whose corners
    // reach past the upright box, so a window fully inside the image can
    // sit at a negative x. Containment below is the real invariant.

    // And the window must genuinely fit the rotated image.
    const fullW = frameW / out.cropWidth;
    const fullH = frameH / out.cropHeight;
    ok(
      R.isWindowInsideRotatedImage(fullW, fullH, deg, {
        x: out.cropX * fullW,
        y: out.cropY * fullH,
        width: frameW,
        height: frameH,
      }, 1e-6),
      `carried rotation left the window outside the image at ${deg}°`
    );
    // Well-formed ⇒ the renderer draws at natural size, no rescue zoom.
    near(R.contentRenderScale(fullW, fullH, frameW, frameH, deg), 1, 1e-9, `rescue zoom needed at ${deg}°`);
  }
});

check('straightening back to upright puts the crop window back in range', () => {
  // While rotated the crop origin may sit outside [0,1] (see above). The
  // unrotated renderer feeds those values to Konva's crop attr, which
  // cannot sample outside the source — so returning to 0° must pull the
  // window back inside the image.
  for (let i = 0; i < 2000; i++) {
    const frameW = 40 + rand() * 900;
    const frameH = 40 + rand() * 900;
    const deg = ANGLES[Math.floor(rand() * ANGLES.length)];
    const cropWidth = 0.05 + rand() * 0.95;
    const cropHeight = 0.05 + rand() * 0.95;
    const rotated = R.fitCropToRotation(
      frameW,
      frameH,
      { cropX: rand() * (1 - cropWidth), cropY: rand() * (1 - cropHeight), cropWidth, cropHeight },
      deg
    );
    // Now straighten back out, exactly as the dial returning to 0 does.
    const fullW = frameW / rotated.cropWidth;
    const fullH = frameH / rotated.cropHeight;
    const back = R.clampWindowToRotatedImage(fullW, fullH, 0, {
      x: rotated.cropX * fullW,
      y: rotated.cropY * fullH,
      width: frameW,
      height: frameH,
    });
    ok(back.x >= -1e-6 && back.y >= -1e-6, 'upright window should not start outside the image');
    ok(
      back.x + frameW <= fullW + 1e-6 && back.y + frameH <= fullH + 1e-6,
      'upright window should not extend past the image'
    );
  }
});

check('an upright photo is unaffected by the rotation re-fit', () => {
  const crop = { cropX: 0.1, cropY: 0.2, cropWidth: 0.5, cropHeight: 0.4 };
  const out = R.fitCropToRotation(300, 200, crop, 0);
  near(out.cropX, crop.cropX, 0, 'cropX changed');
  near(out.cropY, crop.cropY, 0, 'cropY changed');
  near(out.cropWidth, crop.cropWidth, 0, 'cropWidth changed');
  near(out.cropHeight, crop.cropHeight, 0, 'cropHeight changed');
});

check('the crop rect keeps its shape and stays put while the image shrinks', () => {
  // Zooming the image out must never reshape or teleport the box. Walk the
  // image all the way down to its limit, one scroll step at a time, and
  // require the rect to hold its exact aspect and to move continuously.
  for (const deg of ANGLES) {
    for (let t = 0; t < 40; t++) {
      const w = 40 + rand() * 300;
      const h = 40 + rand() * 300;
      const aspect = w / h;
      let fullW = 800 + rand() * 1200;
      let fullH = 800 + rand() * 1200;
      let rect = R.clampWindowToRotatedImage(fullW, fullH, deg, {
        x: (fullW - w) / 2,
        y: (fullH - h) / 2,
        width: w,
        height: h,
      });

      for (let step = 0; step < 25; step++) {
        const floor = R.minImageScaleForRotation(fullW, fullH, rect.width, rect.height, deg);
        const s = Math.max(floor, 0.94); // one scroll notch, respecting the limit
        const nW = fullW * s;
        const nH = fullH * s;
        // Scale about the rect centre, exactly as the scroll handler does.
        const cx = rect.x + rect.width / 2;
        const cy = rect.y + rect.height / 2;
        const prev = rect;
        rect = R.clampWindowToRotatedImage(nW, nH, deg, {
          x: s * cx - rect.width / 2,
          y: s * cy - rect.height / 2,
          width: rect.width,
          height: rect.height,
        });
        fullW = nW;
        fullH = nH;

        near(rect.width / rect.height, aspect, 1e-9, `aspect changed at ${deg}° step ${step}`);
        near(rect.width, w, 1e-9, `rect width changed at ${deg}°`);
        near(rect.height, h, 1e-9, `rect height changed at ${deg}°`);
        ok(
          R.isWindowInsideRotatedImage(fullW, fullH, deg, rect, 1e-6),
          `rect left the image at ${deg}° step ${step}`
        );
        // No teleporting: a 6% zoom step cannot move the box across the image.
        const jump = Math.hypot(rect.x - s * prev.x, rect.y - s * prev.y);
        ok(jump < Math.max(fullW, fullH) * 0.5, `rect jumped at ${deg}° step ${step}`);
      }
    }
  }
});

check('clamping a rotated crop rect never reshapes it', () => {
  // Guards the specific regression: clamping each axis against the image's
  // UNROTATED extents squashed the rect once the image was small.
  for (let i = 0; i < 3000; i++) {
    const deg = ANGLES[Math.floor(rand() * ANGLES.length)];
    const w = 20 + rand() * 400;
    const h = 20 + rand() * 400;
    // An image only just big enough — the regime where the old code squashed.
    const need = R.minImageScaleForRotation(1000, 1000, w, h, deg);
    const fullW = 1000 * need * (1 + rand() * 0.3);
    const fullH = 1000 * need * (1 + rand() * 0.3);
    const out = R.clampWindowToRotatedImage(fullW, fullH, deg, {
      x: -200 + rand() * (fullW + 400),
      y: -200 + rand() * (fullH + 400),
      width: w,
      height: h,
    });
    near(out.width / out.height, w / h, 1e-9, `clamp reshaped the rect at ${deg}°`);
    ok(R.isWindowInsideRotatedImage(fullW, fullH, deg, out, 1e-6), `clamp left the image at ${deg}°`);
  }
});

check('a swapped photo fills its new frame without stretching', () => {
  // Swap moves a photo into a frame of a different shape. The crop must be
  // re-shaped so the visible region matches the new frame's aspect exactly,
  // or the photo renders distorted.
  for (let i = 0; i < 4000; i++) {
    const imageW = 200 + rand() * 4000;
    const imageH = 200 + rand() * 4000;
    const cropWidth = 0.05 + rand() * 0.95;
    const cropHeight = 0.05 + rand() * 0.95;
    const crop = {
      cropX: rand() * (1 - cropWidth),
      cropY: rand() * (1 - cropHeight),
      cropWidth,
      cropHeight,
    };
    const frameW = 20 + rand() * 800;
    const frameH = 20 + rand() * 800;
    const frameRatio = frameW / frameH;

    const out = R.adaptCropToFrame(imageW, imageH, crop, frameRatio);

    // The visible region's true aspect uses PIXEL dimensions, not the
    // normalized crop values.
    const shownRatio = (out.cropWidth * imageW) / (out.cropHeight * imageH);
    near(shownRatio, frameRatio, 1e-6 * Math.max(1, frameRatio), 'photo would be stretched in its new frame');

    // Must stay a real, in-bounds window.
    ok(out.cropWidth > 0 && out.cropHeight > 0, 'crop collapsed');
    ok(out.cropX >= -1e-9 && out.cropY >= -1e-9, 'crop origin went negative');
    ok(out.cropX + out.cropWidth <= 1 + 1e-9, 'crop ran past the right edge');
    ok(out.cropY + out.cropHeight <= 1 + 1e-9, 'crop ran past the bottom edge');
  }
});

check('a swap never zooms out to reveal cropped-away content', () => {
  // The re-shaped window must sit INSIDE the original crop: growing it
  // would resurrect content the user deliberately cropped out.
  for (let i = 0; i < 3000; i++) {
    const imageW = 200 + rand() * 3000;
    const imageH = 200 + rand() * 3000;
    const cropWidth = 0.05 + rand() * 0.95;
    const cropHeight = 0.05 + rand() * 0.95;
    const crop = {
      cropX: rand() * (1 - cropWidth),
      cropY: rand() * (1 - cropHeight),
      cropWidth,
      cropHeight,
    };
    const out = R.adaptCropToFrame(imageW, imageH, crop, (20 + rand() * 800) / (20 + rand() * 800));
    ok(out.cropWidth <= crop.cropWidth + 1e-9, 'window grew horizontally');
    ok(out.cropHeight <= crop.cropHeight + 1e-9, 'window grew vertically');
  }
});

check('swapping a photo back and forth is stable', () => {
  // Round-tripping between two frames must converge, not creep smaller on
  // every swap.
  const imageW = 3000;
  const imageH = 2000;
  const ratioA = 4 / 5;
  const ratioB = 16 / 9;
  let crop = { cropX: 0.1, cropY: 0.1, cropWidth: 0.8, cropHeight: 0.8 };
  crop = R.adaptCropToFrame(imageW, imageH, crop, ratioA);
  const firstA = { ...crop };
  for (let i = 0; i < 8; i++) {
    crop = R.adaptCropToFrame(imageW, imageH, crop, ratioB);
    crop = R.adaptCropToFrame(imageW, imageH, crop, ratioA);
  }
  ok(crop.cropWidth <= firstA.cropWidth + 1e-9, 'window grew across round trips');
  ok(crop.cropWidth > 0 && crop.cropHeight > 0, 'window collapsed across round trips');
  near(
    (crop.cropWidth * imageW) / (crop.cropHeight * imageH),
    ratioA,
    1e-6,
    'aspect drifted across round trips'
  );
});

check('you can click a rotated frame where you actually see it', () => {
  // 90° about the top-left anchor puts the frame to the LEFT of x.
  const [x, y, w, h] = [100, 100, 200, 60];
  ok(C.isPointInRotatedRect(150, 120, x, y, w, h, 0), 'unrotated centre should hit');
  ok(!C.isPointInRotatedRect(150, 120, x, y, w, h, 90), 'old box should NOT hit once rotated');
  // Rotated 90°, the frame spans x-60..x horizontally and y..y+200 vertically.
  ok(C.isPointInRotatedRect(x - 30, y + 100, x, y, w, h, 90), 'the visible rotated frame should hit');
  ok(!C.isPointInRotatedRect(x - 90, y + 100, x, y, w, h, 90), 'outside the rotated frame should miss');
});

check('a point hits a rotated element exactly when it is drawn there', () => {
  for (let i = 0; i < 3000; i++) {
    const x = -200 + rand() * 400;
    const y = -200 + rand() * 400;
    const w = 20 + rand() * 300;
    const h = 20 + rand() * 300;
    const deg = -180 + rand() * 360;
    // Pick a point that is by construction inside/outside the element's own
    // frame, then forward-rotate it — the hit test must agree.
    const insideLocal = rand() < 0.5;
    const lx = insideLocal ? rand() * w : w + 5 + rand() * 100;
    const ly = insideLocal ? rand() * h : h + 5 + rand() * 100;
    const rad = (deg * Math.PI) / 180;
    const px = x + lx * Math.cos(rad) - ly * Math.sin(rad);
    const py = y + lx * Math.sin(rad) + ly * Math.cos(rad);
    const hit = C.isPointInRotatedRect(px, py, x, y, w, h, deg);
    ok(hit === insideLocal, `hit test disagreed at ${deg.toFixed(1)}° (expected ${insideLocal})`);
  }
});

// ── shared photo framing ─────────────────────────────────────────────
// These back every "put this photo in that frame" path (swap, replace,
// fill, media-pool drop), so a break here breaks all of them at once.

check('a photo dropped into any frame fills it without stretching or letterboxing', () => {
  for (let i = 0; i < 4000; i++) {
    const mediaW = 50 + rand() * 6000;
    const mediaH = 50 + rand() * 6000;
    const frameW = 20 + rand() * 2000;
    const frameH = 20 + rand() * 2000;
    const c = F.coverCrop(mediaW, mediaH, frameW, frameH);

    // The window must lie inside the image...
    ok(c.cropX >= -1e-9 && c.cropY >= -1e-9, 'crop origin escaped the image');
    ok(c.cropX + c.cropWidth <= 1 + 1e-9, 'crop overflowed the image width');
    ok(c.cropY + c.cropHeight <= 1 + 1e-9, 'crop overflowed the image height');
    // ...and its on-screen shape must match the frame, or the photo is
    // squashed. Crop values are normalized, so shape is (cw·mediaW):(ch·mediaH).
    const windowRatio = (c.cropWidth * mediaW) / (c.cropHeight * mediaH);
    near(windowRatio, frameW / frameH, 1e-6, 'photo would be stretched in its frame');
    // Cover, not contain: one axis is always used in full.
    ok(
      Math.abs(c.cropWidth - 1) < 1e-9 || Math.abs(c.cropHeight - 1) < 1e-9,
      'photo was zoomed in more than the frame required'
    );
  }
});

check('a cover crop is centred, so the drop keeps the middle of the photo', () => {
  const c = F.coverCrop(4000, 1000, 100, 100);
  near(c.cropX + c.cropWidth / 2, 0.5, 1e-9, 'horizontal centre drifted');
  near(c.cropY + c.cropHeight / 2, 0.5, 1e-9, 'vertical centre drifted');
});

check('a degenerate or missing image size never produces an invisible element', () => {
  for (const args of [[0, 100, 50, 50], [100, 0, 50, 50], [100, 100, 0, 50], [-5, 10, 10, 10]]) {
    const c = F.coverCrop(...args);
    ok(
      Number.isFinite(c.cropX) && Number.isFinite(c.cropWidth) && c.cropWidth > 0 && c.cropHeight > 0,
      `coverCrop(${args.join(',')}) produced an unusable window`
    );
  }
});

check('the image behind the crop rectangle lines up with the visible photo', () => {
  for (let i = 0; i < 3000; i++) {
    const cropWidth = 0.05 + rand() * 0.95;
    const cropHeight = 0.05 + rand() * 0.95;
    const el = {
      x: -300 + rand() * 600,
      y: -300 + rand() * 600,
      width: 20 + rand() * 900,
      height: 20 + rand() * 900,
      cropX: rand() * (1 - cropWidth),
      cropY: rand() * (1 - cropHeight),
      cropWidth,
      cropHeight,
    };
    const full = F.getFullImageRect(el);
    // The frame must sit exactly on the crop window within the full image —
    // this is what makes entering crop mode not jump the picture.
    near(full.x + el.cropX * full.width, el.x, 1e-6, 'frame left edge drifted');
    near(full.y + el.cropY * full.height, el.y, 1e-6, 'frame top edge drifted');
    near(full.width * el.cropWidth, el.width, 1e-6, 'frame width drifted');
    near(full.height * el.cropHeight, el.height, 1e-6, 'frame height drifted');
    ok(full.width >= el.width - 1e-9, 'full image narrower than the frame it contains');
  }
});

check('resetting crop reveals the whole photo without moving what you can see', () => {
  const el = { x: 100, y: 50, width: 200, height: 100, cropX: 0.25, cropY: 0.5, cropWidth: 0.5, cropHeight: 0.25 };
  const full = F.getFullImageRect(el);
  // Reset writes full.* as the new frame — the previously visible region
  // must still cover the same pixels on screen.
  near(full.x + 0.25 * full.width, 100, 1e-9, 'visible region shifted horizontally on reset');
  near(full.y + 0.5 * full.height, 50, 1e-9, 'visible region shifted vertically on reset');
});

check('a straightened photo moved to another frame still has no blank corners', () => {
  for (const deg of ANGLES) {
    for (let i = 0; i < 120; i++) {
      const mediaW = 200 + rand() * 4000;
      const mediaH = 200 + rand() * 4000;
      const frameW = 40 + rand() * 900;
      const frameH = 40 + rand() * 900;
      // Both transfer flavours: fresh cover (replace/fill) and carried
      // framing (swap).
      const carry = i % 2 === 0 ? undefined : (() => {
        const w = 0.2 + rand() * 0.8;
        const h = 0.2 + rand() * 0.8;
        return { cropX: rand() * (1 - w), cropY: rand() * (1 - h), cropWidth: w, cropHeight: h };
      })();

      const c = F.cropForFrame({
        mediaWidth: mediaW,
        mediaHeight: mediaH,
        frameWidth: frameW,
        frameHeight: frameH,
        contentRotation: deg,
        carry,
      });

      ok(c.cropWidth > 0 && c.cropHeight > 0, `empty window at ${deg}°`);
      // The frame's window, expressed on the full image, must sit inside the
      // rotated image — otherwise the tilt exposes background.
      const fullW = frameW / c.cropWidth;
      const fullH = frameH / c.cropHeight;
      ok(
        R.isWindowInsideRotatedImage(fullW, fullH, deg, {
          x: c.cropX * fullW,
          y: c.cropY * fullH,
          width: frameW,
          height: frameH,
        }, 1e-6),
        `blank corners after transfer at ${deg}°`
      );
    }
  }
});

// ── shared drop-target lookup ────────────────────────────────────────

check('the frame that highlights under the cursor is the one on top', () => {
  const mk = (id, x, zIndex) => ({
    id, x, y: 0, width: 100, height: 100, zIndex, rotation: 0,
    type: 'photo', mediaId: 'm', locked: false, scale: 1,
  });
  // Three overlapping photos; the highest zIndex must win regardless of
  // the order they happen to sit in the array.
  const els = [mk('a', 0, 5), mk('b', 10, 9), mk('c', 20, 1)];
  const hit = H.findTopmostElementAt(els, 50, 50, { match: H.isDropTarget });
  ok(hit && hit.id === 'b', `expected the topmost frame, got ${hit && hit.id}`);
  const excluded = H.findTopmostElementAt(els, 50, 50, { match: H.isDropTarget, excludeId: 'b' });
  ok(excluded && excluded.id === 'a', 'excluding the dragged frame should fall through to the next');
});

check('a tilted frame is a drop target where it looks, not where its upright box was', () => {
  const el = {
    id: 'f', x: 200, y: 100, width: 200, height: 60, zIndex: 0, rotation: 90,
    type: 'placeholder', locked: false, scale: 1,
  };
  const els = [el];
  // Rotated 90° about its top-left anchor it occupies x 140..200, y 100..300.
  ok(
    H.findTopmostElementAt(els, 170, 200, { match: H.isEmptyFrame }),
    'the drawn frame should accept a drop'
  );
  ok(
    !H.findTopmostElementAt(els, 300, 130, { match: H.isEmptyFrame }),
    'the unrotated box should NOT accept a drop'
  );
});

check('empty frames and photos are both valid drop targets, and nothing else is', () => {
  const base = { x: 0, y: 0, width: 100, height: 100, zIndex: 0, rotation: 0, locked: false, scale: 1 };
  ok(H.isDropTarget({ ...base, id: '1', type: 'photo', mediaId: 'm' }), 'a photo should be a target');
  ok(H.isDropTarget({ ...base, id: '2', type: 'placeholder' }), 'an empty frame should be a target');
  // A photo element whose media is gone has nothing to trade.
  ok(!H.isDropTarget({ ...base, id: '3', type: 'photo' }), 'a photo with no media should not be a target');
});

// ── crop-mode rotation: reversible zoom ──────────────────────────────
// Crop mode zooms the image only as far as the tilt requires. Measured
// against a FIXED reference, that factor is a pure function of the angle —
// which is what makes the zoom shrink back on the way out instead of
// ratcheting up, and what makes a half turn land where it started.

const appliedScale = (fw, fh, w, h, deg) =>
  Math.max(1, R.minImageScaleForRotation(fw, fh, w, h, deg));

check('turning the image and back leaves it exactly the size it started', () => {
  for (let i = 0; i < 2000; i++) {
    const fw = 200 + rand() * 4000;
    const fh = 200 + rand() * 4000;
    const w = 20 + rand() * fw * 0.9;
    const h = 20 + rand() * fh * 0.9;
    const start = -180 + rand() * 360;

    const before = appliedScale(fw, fh, w, h, start);
    // Wander through arbitrary angles, then come back.
    for (let step = 0; step < 5; step++) {
      appliedScale(fw, fh, w, h, -180 + rand() * 360);
    }
    const after = appliedScale(fw, fh, w, h, start);
    near(after, before, 1e-12, 'returning to the same angle changed the zoom');
  }
});

check('a 180° turn ends at the same size as no turn at all', () => {
  for (let i = 0; i < 2000; i++) {
    const fw = 200 + rand() * 4000;
    const fh = 200 + rand() * 4000;
    const w = 20 + rand() * fw * 0.9;
    const h = 20 + rand() * fh * 0.9;
    const deg = -180 + rand() * 360;
    // A half turn maps the window onto itself, so it needs identical room.
    const opposite = deg > 0 ? deg - 180 : deg + 180;
    near(
      appliedScale(fw, fh, w, h, opposite),
      appliedScale(fw, fh, w, h, deg),
      1e-9,
      `half turn changed the zoom at ${deg.toFixed(1)}°`
    );
    near(
      appliedScale(fw, fh, w, h, 180),
      appliedScale(fw, fh, w, h, 0),
      1e-9,
      '180° did not match 0°'
    );
  }
});

check('zooming for a tilt never shrinks the photo below its natural size', () => {
  for (const deg of ANGLES) {
    for (let i = 0; i < 200; i++) {
      const fw = 200 + rand() * 4000;
      const fh = 200 + rand() * 4000;
      const w = 20 + rand() * fw;
      const h = 20 + rand() * fh;
      ok(appliedScale(fw, fh, w, h, deg) >= 1, `scale dropped below 1 at ${deg}°`);
    }
  }
});

check('the crop box still fits once the angle-driven zoom is applied', () => {
  for (const deg of ANGLES) {
    for (let i = 0; i < 200; i++) {
      const fw = 300 + rand() * 3000;
      const fh = 300 + rand() * 3000;
      const w = 20 + rand() * fw * 0.8;
      const h = 20 + rand() * fh * 0.8;
      const s = appliedScale(fw, fh, w, h, deg);
      // Centre the box in the scaled image, exactly as the refit does.
      const zw = fw * s;
      const zh = fh * s;
      ok(
        R.isWindowInsideRotatedImage(zw, zh, deg, {
          x: (zw - w) / 2,
          y: (zh - h) / 2,
          width: w,
          height: h,
        }, 1e-6),
        `box escaped the tilted image at ${deg}°`
      );
    }
  }
});

// Mirrors CropOverlay's refit: size and position for an angle are both
// derived from a fixed natural-space anchor, then clamped.
const seatForAngle = (nat, w, h, deg) => {
  const s = Math.max(1, R.minImageScaleForRotation(nat.width, nat.height, w, h, deg));
  const seated = R.clampWindowToRotatedImage(nat.width * s, nat.height * s, deg, {
    x: nat.rectX * s,
    y: nat.rectY * s,
    width: w,
    height: h,
  });
  return { x: seated.x, y: seated.y, scale: s, fullW: nat.width * s, fullH: nat.height * s };
};

check('rotating away and back restores the exact framing, not just the size', () => {
  for (let i = 0; i < 1500; i++) {
    const width = 400 + rand() * 3000;
    const height = 400 + rand() * 3000;
    const w = 40 + rand() * width * 0.7;
    const h = 40 + rand() * height * 0.7;
    const nat = { width, height, rectX: rand() * (width - w), rectY: rand() * (height - h) };
    const start = -180 + rand() * 360;

    const before = seatForAngle(nat, w, h, start);
    for (let step = 0; step < 4; step++) seatForAngle(nat, w, h, -180 + rand() * 360);
    const after = seatForAngle(nat, w, h, start);

    near(after.x, before.x, 1e-9, 'framing drifted horizontally after a round trip');
    near(after.y, before.y, 1e-9, 'framing drifted vertically after a round trip');
    near(after.scale, before.scale, 1e-12, 'zoom drifted after a round trip');
  }
});

check('the framing you asked for is kept whenever the tilt allows it', () => {
  // The real promise: the crop is only ever moved when it has to be. Note
  // the valid region inside a TILTED image is itself tilted, so x and y are
  // coupled — an edge-anchored crop can legitimately be nudged along one
  // axis further than the other. What must hold is that a reachable framing
  // is reproduced exactly.
  for (const deg of ANGLES) {
    for (let i = 0; i < 200; i++) {
      const width = 600 + rand() * 2000;
      const height = 600 + rand() * 2000;
      const w = 40 + rand() * width * 0.6;
      const h = 40 + rand() * height * 0.6;
      const nat = { width, height, rectX: rand() * (width - w), rectY: rand() * (height - h) };

      const seated = seatForAngle(nat, w, h, deg);
      const s = seated.scale;
      const desired = { x: nat.rectX * s, y: nat.rectY * s, width: w, height: h };

      if (R.isWindowInsideRotatedImage(seated.fullW, seated.fullH, deg, desired, 1e-6)) {
        near(seated.x, desired.x, 1e-6, `moved a crop that already fitted at ${deg}°`);
        near(seated.y, desired.y, 1e-6, `moved a crop that already fitted at ${deg}°`);
      }

      ok(
        R.isWindowInsideRotatedImage(seated.fullW, seated.fullH, deg, {
          x: seated.x,
          y: seated.y,
          width: w,
          height: h,
        }, 1e-6),
        `crop escaped the tilted image at ${deg}°`
      );
    }
  }
});

check('an upright crop against the top edge is left exactly where it is', () => {
  for (let i = 0; i < 500; i++) {
    const width = 600 + rand() * 2000;
    const height = 600 + rand() * 2000;
    const w = 40 + rand() * width * 0.6;
    const h = 40 + rand() * height * 0.6;
    // Framed hard against the top-left, the way the reported case was.
    const upright = seatForAngle({ width, height, rectX: 0, rectY: 0 }, w, h, 0);
    near(upright.scale, 1, 1e-12, 'an upright crop should need no zoom');
    near(upright.x, 0, 1e-9, 'upright crop left the left edge');
    near(upright.y, 0, 1e-9, 'upright crop left the top edge');
  }
});

// ── report ───────────────────────────────────────────────────────────
rmSync(outDir, { recursive: true, force: true });

if (failures.length === 0) {
  console.log(`geometry: ${passed} checks passed`);
  process.exit(0);
}

console.error(`geometry: ${passed} passed, ${failures.length} FAILED\n`);
for (const f of failures) {
  console.error(`  x ${f.describe}`);
  console.error(`    ${f.message}\n`);
}
process.exit(1);
