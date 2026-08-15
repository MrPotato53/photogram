import { useEffect, useRef, useState } from 'react';
import { Circle, Group, Line, Path, Rect, Text } from 'react-konva';
import type Konva from 'konva';
import { clampContentRotation, snapContentRotation } from '../../utils/contentRotation';

interface CropRotationDialProps {
  // Crop rect in ABSOLUTE design coordinates
  cropRect: { x: number; y: number; width: number; height: number };
  // Layer scale (design units → screen px); UI chrome divides by this so it
  // renders at constant screen size regardless of zoom.
  layerScale: number;
  // Current content rotation (degrees)
  rotation: number;
  onRotationChange: (deg: number) => void;
  // Called once when a drag begins, before any onRotationChange. The parent
  // uses it to open a single undo step and to pin the zoom reference for the
  // whole gesture.
  onRotateStart?: () => void;
  // Called with the final value when a drag (or double-click reset) commits —
  // the parent pushes crop history immediately so undo right after the
  // gesture doesn't race the debounced watcher.
  onRotateEnd?: (finalDeg: number) => void;
}

const PILL_W = 78;
const PILL_H = 24;
// Feather "rotate-cw" icon path (24×24 viewbox)
const ROTATE_ICON = 'M23 4v6h-6M20.49 15a9 9 0 1 1-2.12-9.36L23 10';

/**
 * Circular rotation control for crop mode.
 *
 * A floating angle pill hovers above the crop frame. Dragging it orbits the
 * cursor around the crop-rect center: the image's content rotation follows
 * the cursor's angular motion 1:1 (Shift = 0.1× fine mode, readable per
 * event so it can engage mid-drag). While dragging, a clock-style tick ring
 * appears around the image and rotates with it; a fixed blue marker at the
 * top gives a stationary reference. Double-click the pill to reset to 0°.
 *
 * History integration is free: rotation flows through onRotationChange into
 * the same contentRotation prop the Straighten slider uses, and CropOverlay's
 * debounced rotation-history effect batches the drag into one undo entry.
 */
export function CropRotationDial({
  cropRect,
  layerScale,
  rotation,
  onRotationChange,
  onRotateStart,
  onRotateEnd,
}: CropRotationDialProps) {
  const anchorRef = useRef<Konva.Group>(null);
  const [isRotating, setIsRotating] = useState(false);
  const rotationRef = useRef(rotation);
  rotationRef.current = rotation;
  const lastDownAtRef = useRef(0);

  // Window listeners must not leak if crop mode exits (Escape) mid-drag.
  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanupRef.current?.(), []);

  // Screen px → design units at the current zoom
  const px = (v: number) => v / layerScale;

  const centerX = cropRect.x + cropRect.width / 2;
  const centerY = cropRect.y + cropRect.height / 2;
  const ringRadius = Math.hypot(cropRect.width, cropRect.height) / 2 + px(28);

  const handleMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    e.cancelBubble = true;
    e.evt.preventDefault();

    // Double-click → reset to 0 (same convention as the Straighten slider)
    const now = performance.now();
    if (now - lastDownAtRef.current < 300) {
      lastDownAtRef.current = 0;
      onRotationChange(0);
      onRotateEnd?.(0);
      return;
    }
    lastDownAtRef.current = now;

    const stage = anchorRef.current?.getStage();
    const layer = anchorRef.current?.getLayer();
    if (!stage || !layer) return;

    // Crop-rect center in client coordinates — the pivot the cursor orbits.
    const containerRect = stage.container().getBoundingClientRect();
    const centerStage = layer.getAbsoluteTransform().point({ x: centerX, y: centerY });
    const cx = containerRect.left + centerStage.x;
    const cy = containerRect.top + centerStage.y;

    // `raw` tracks the TRUE cursor-driven angle, unaffected by snapping —
    // only the reported/displayed value snaps. Snapping raw itself would
    // stomp small per-event deltas back to the snap point on every move
    // (e.g. starting at 0°, each event's few-degree delta would get erased
    // right back to 0), trapping rotation inside the tolerance band forever.
    let raw = rotationRef.current;
    let displayed = raw;
    let prevAngle = (Math.atan2(e.evt.clientY - cy, e.evt.clientX - cx) * 180) / Math.PI;

    setIsRotating(true);
    document.body.style.cursor = 'grabbing';
    onRotateStart?.();

    // Pointer events fire far faster than the display refreshes — high-rate
    // trackpads and mice deliver several hundred per second. Each one used to
    // drive a full React commit AND the crop re-fit, so the work queued up
    // faster than it could drain and the image visibly trailed the cursor.
    //
    // The angle accumulator below still integrates EVERY event (dropping any
    // would lose rotation and change the math); only the publish is coalesced
    // to one per animation frame, which is as often as the screen can show it.
    let frame = 0;
    let pending = displayed;
    const publish = () => {
      frame = 0;
      onRotationChange(Math.round(pending * 10) / 10);
    };

    const move = (ev: PointerEvent) => {
      const a = (Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180) / Math.PI;
      // Incremental shortest-arc delta so crossing the ±180° seam never jumps
      let d = a - prevAngle;
      if (d > 180) d -= 360;
      if (d < -180) d += 360;
      prevAngle = a;
      raw = clampContentRotation(raw + d * (ev.shiftKey ? 0.1 : 1));
      // Snap to 0/90/180/270 within tolerance (Transformer-style catch) for
      // DISPLAY only; releases smoothly once raw clears the tolerance band.
      // Shift (fine-tune mode) skips snapping — the whole point is precise
      // sub-degree control.
      displayed = ev.shiftKey ? raw : snapContentRotation(raw);
      pending = displayed;
      if (!frame) frame = requestAnimationFrame(publish);
    };
    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      // Cancel any frame still queued and emit the exact final angle, so the
      // committed value is never one frame stale.
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      const final = Math.round(displayed * 10) / 10;
      onRotationChange(final);
      document.body.style.cursor = '';
      cleanupRef.current = null;
      setIsRotating(false);
      onRotateEnd?.(final);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    cleanupRef.current = finish;
  };

  // Tick marks every 5°, longer/brighter every 45°. Rendered in a group
  // rotated by the current rotation so the ring turns with the image.
  const ticks = [];
  for (let a = 0; a < 360; a += 5) {
    const major = a % 45 === 0;
    const len = px(major ? 12 : 6);
    const rad = (a * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    ticks.push(
      <Line
        key={a}
        points={[
          ringRadius * cos,
          ringRadius * sin,
          (ringRadius + len) * cos,
          (ringRadius + len) * sin,
        ]}
        stroke={major ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.55)'}
        strokeWidth={px(major ? 2 : 1)}
        listening={false}
      />
    );
  }

  return (
    <>
      {/* Stage/layer access anchor (always mounted, renders nothing) */}
      <Group ref={anchorRef} listening={false} />

      {/* Tick ring — visible only during a rotation drag */}
      {isRotating && (
        <Group listening={false}>
          <Circle
            x={centerX}
            y={centerY}
            radius={ringRadius}
            stroke="rgba(255,255,255,0.35)"
            strokeWidth={px(1)}
          />
          <Group x={centerX} y={centerY} rotation={rotation}>
            {ticks}
          </Group>
          {/* Fixed reference marker at 12 o'clock */}
          <Group
            x={centerX}
            y={centerY - ringRadius - px(20)}
            scaleX={1 / layerScale}
            scaleY={1 / layerScale}
          >
            <Line points={[0, 7, -5, -4, 5, -4]} closed fill="#3b82f6" />
          </Group>
        </Group>
      )}

      {/* Floating angle indicator / drag handle above the crop frame */}
      <Group
        x={centerX}
        y={cropRect.y - px(34)}
        scaleX={1 / layerScale}
        scaleY={1 / layerScale}
        onMouseDown={handleMouseDown}
        onMouseEnter={(e) => {
          const st = e.target.getStage();
          if (st) st.container().style.cursor = 'grab';
        }}
        onMouseLeave={(e) => {
          const st = e.target.getStage();
          if (st) st.container().style.cursor = '';
        }}
      >
        <Rect
          x={-PILL_W / 2}
          y={-PILL_H / 2}
          width={PILL_W}
          height={PILL_H}
          cornerRadius={PILL_H / 2}
          fill="rgba(17,24,39,0.92)"
          stroke="rgba(255,255,255,0.25)"
          strokeWidth={1}
          shadowColor="black"
          shadowBlur={8}
          shadowOpacity={0.35}
        />
        <Path
          data={ROTATE_ICON}
          x={-PILL_W / 2 + 9}
          y={-6}
          scaleX={0.5}
          scaleY={0.5}
          stroke="#e5e7eb"
          strokeWidth={2.5}
          listening={false}
        />
        <Text
          x={-PILL_W / 2 + 20}
          y={-PILL_H / 2}
          width={PILL_W - 26}
          height={PILL_H}
          text={`${rotation.toFixed(1)}°`}
          align="center"
          verticalAlign="middle"
          fontSize={11}
          fill="#ffffff"
          listening={false}
        />
      </Group>
    </>
  );
}
