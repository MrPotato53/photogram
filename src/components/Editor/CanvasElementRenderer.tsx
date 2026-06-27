import { memo, useCallback, useLayoutEffect, useRef } from 'react';
import { Image as KonvaImage, Group, Rect } from 'react-konva';
import type Konva from 'konva';
import type { Element } from '../../types';
import { coverScaleForRotation } from '../../utils/contentRotation';

interface CanvasElementRendererProps {
  element: Element;
  loadedImage: HTMLImageElement | null;
  isSelected: boolean;
  isBeingCropped: boolean;
  zoomLevel: number;
  onElementClick: (elementId: string, e: Konva.KonvaEventObject<MouseEvent>) => void;
  onDragStart: () => void;
  onDragMove: (elementId: string, e: Konva.KonvaEventObject<any>) => void;
  onDragEnd: (elementId: string, e: Konva.KonvaEventObject<any>) => void;
  onTransformEnd: (elementId: string, e: Konva.KonvaEventObject<Event>) => void;
  cropModeElementId: string | null;
}

/**
 * Simple rectangle hit function for Konva elements.
 * Replaces Konva's default pixel-perfect hit detection (which draws the full image
 * to a hidden canvas and calls getImageData on every mousemove) with a simple
 * rectangle fill. This reduces hit testing from O(image_pixels) to O(1) per element.
 */
function rectHitFunc(context: Konva.Context, shape: Konva.Shape) {
  context.beginPath();
  context.rect(0, 0, shape.width(), shape.height());
  context.closePath();
  context.fillStrokeShape(shape);
}

export const CanvasElementRenderer = memo(function CanvasElementRenderer({
  element,
  loadedImage,
  isSelected,
  isBeingCropped,
  zoomLevel,
  onElementClick,
  onDragStart,
  onDragMove,
  onDragEnd,
  onTransformEnd,
  cropModeElementId,
}: CanvasElementRendererProps) {
  // Stable callbacks to avoid re-creating inline functions
  const handleClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => onElementClick(element.id, e),
    [element.id, onElementClick]
  );
  const handleTap = useCallback(
    (e: Konva.KonvaEventObject<TouchEvent>) =>
      onElementClick(element.id, e as unknown as Konva.KonvaEventObject<MouseEvent>),
    [element.id, onElementClick]
  );
  const strokeRef = useRef<Konva.Rect>(null);
  // Visual group for the content-rotation branch; synced imperatively from
  // the interaction proxy during drag/transform (same pattern as strokeRef).
  const clipGroupRef = useRef<Konva.Group>(null);
  const handleDragMove = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      // Stroke is a sibling node (so selection doesn't invalidate the image
      // cache). Konva updates e.target.x/y imperatively during drag, but the
      // stroke's x/y props only refresh on React re-render (after drag end),
      // so we sync it here or the border appears to lag behind.
      if (strokeRef.current) {
        strokeRef.current.x(e.target.x());
        strokeRef.current.y(e.target.y());
      }
      onDragMove(element.id, e);
    },
    [element.id, onDragMove]
  );
  const handleDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => onDragEnd(element.id, e),
    [element.id, onDragEnd]
  );
  const handleTransformEnd = useCallback(
    (e: Konva.KonvaEventObject<Event>) => {
      // Invalidate the cache before committing new dimensions. Konva stores the
      // cached bitmap at its original pixel size; blitting it inside the new
      // bounds would show the image at its old size for one frame. Clearing
      // here makes the post-commit paint use raw drawScene at the correct new
      // size (one slow frame) before useLayoutEffect rebuilds the cache.
      imageRef.current?.clearCache();
      onTransformEnd(element.id, e);
    },
    [element.id, onTransformEnd]
  );

  // Konva node cache: converts the KonvaImage's scene output to an offscreen
  // canvas at display resolution so Layer.draw() blits a small bitmap instead
  // of resampling the full source JPEG on every frame. Huge perf win on drag
  // (measured: ~200ms per drawImage → ~1ms per blit on large images).
  // Invalidate only on cache-relevant props — position changes (x/y) don't
  // require re-caching, and Transformer uses scaleX/Y during drag so width/height
  // only change on transformEnd.
  const imageRef = useRef<Konva.Image>(null);
  // useLayoutEffect so the cache is rebuilt synchronously before the browser
  // paints — otherwise the first post-commit paint draws with a stale cache
  // against the new dimensions, producing a one-frame flash on resize.
  useLayoutEffect(() => {
    const node = imageRef.current;
    if (!node || !loadedImage) return;
    // In crop mode we render the full uncropped image and want live updates
    // (pan, aspect change), so cache would freeze the view. Clear it.
    if (isBeingCropped) {
      node.clearCache();
      node.getLayer()?.batchDraw();
      return;
    }
    try {
      // Content rotation cover-scales the image up; multiply the cache
      // resolution by that factor so the upscaled draw still lands at
      // native display density (otherwise we'd be magnifying a
      // display-res rasterization → visible blur). Capped at 4 to bound
      // memory for extreme aspect ratios at high angles. The ratio is
      // recorded on the node so the export path can re-cache at the same
      // density after a high-res export clears caches.
      const cover = coverScaleForRotation(
        element.width,
        element.height,
        element.contentRotation ?? 0
      );
      const ratio = Math.min(Math.min(window.devicePixelRatio || 1, 2) * cover, 4);
      node.setAttr('cachePixelRatio', ratio);
      node.cache({ pixelRatio: ratio });
      node.getLayer()?.batchDraw();
    } catch {
      // cache() throws on zero-size nodes; safe to skip
    }
  }, [
    loadedImage,
    isBeingCropped,
    element.width,
    element.height,
    element.cropX,
    element.cropY,
    element.cropWidth,
    element.cropHeight,
    // Toggling content rotation 0 ↔ non-zero remounts the image node into a
    // different tree shape; including it here re-caches the fresh node.
    element.contentRotation,
  ]);

  const isDraggable = !element.locked && !cropModeElementId;

  // Render placeholder/frame elements
  if (element.type === 'placeholder') {
    const plusSize = Math.min(element.width, element.height) * 0.3;
    const centerX = element.width / 2;
    const centerY = element.height / 2;

    return (
      <Group
        key={element.id}
        id={element.id}
        x={element.x}
        y={element.y}
        width={element.width}
        height={element.height}
        rotation={element.rotation}
        draggable={isDraggable}
        onClick={handleClick}
        onTap={handleTap}
        onDragStart={onDragStart}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        onTransformEnd={handleTransformEnd}
      >
        {/* Gray background */}
        <Rect
          width={element.width}
          height={element.height}
          fill="#e5e7eb"
          stroke={isSelected ? '#3b82f6' : '#d1d5db'}
          strokeWidth={isSelected ? 2 / zoomLevel : 1 / zoomLevel}
          strokeScaleEnabled={false}
          dash={isSelected ? undefined : [8, 4]}
          hitFunc={rectHitFunc}
        />
        {/* Plus icon - horizontal line */}
        <Rect
          x={centerX - plusSize / 2}
          y={centerY - plusSize / 12}
          width={plusSize}
          height={plusSize / 6}
          fill="#9ca3af"
          listening={false}
        />
        {/* Plus icon - vertical line */}
        <Rect
          x={centerX - plusSize / 12}
          y={centerY - plusSize / 2}
          width={plusSize / 6}
          height={plusSize}
          fill="#9ca3af"
          listening={false}
        />
      </Group>
    );
  }

  // Render photo elements
  if (element.type !== 'photo') return null;

  // Show placeholder for missing/broken images
  if (!loadedImage) {
    return (
      <Group
        key={element.id}
        id={element.id}
        x={element.x}
        y={element.y}
        width={element.width}
        height={element.height}
        rotation={element.rotation}
        draggable={isDraggable}
        onClick={handleClick}
        onTap={handleTap}
        onDragStart={onDragStart}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        onTransformEnd={handleTransformEnd}
      >
        {/* Error background */}
        <Rect
          width={element.width}
          height={element.height}
          fill="#fef2f2"
          stroke={isSelected ? '#3b82f6' : '#fca5a5'}
          strokeWidth={isSelected ? 2 / zoomLevel : 1 / zoomLevel}
          strokeScaleEnabled={false}
          hitFunc={rectHitFunc}
        />
        {/* X icon - diagonal lines */}
        <Rect
          x={element.width / 2 - 2}
          y={element.height / 2 - 15}
          width={4}
          height={30}
          fill="#ef4444"
          rotation={45}
          offsetX={2}
          offsetY={15}
          listening={false}
        />
        <Rect
          x={element.width / 2 - 2}
          y={element.height / 2 - 15}
          width={4}
          height={30}
          fill="#ef4444"
          rotation={-45}
          offsetX={2}
          offsetY={15}
          listening={false}
        />
      </Group>
    );
  }

  const flipScaleX = element.flipX ? -1 : 1;
  const flipScaleY = element.flipY ? -1 : 1;

  const existingCropX = element.cropX ?? 0;
  const existingCropY = element.cropY ?? 0;
  const existingCropW = element.cropWidth ?? 1;
  const existingCropH = element.cropHeight ?? 1;
  const hasCrop = existingCropX > 0 || existingCropY > 0 || existingCropW < 1 || existingCropH < 1;

  if (isBeingCropped) {
    const fullWidth = element.width / existingCropW;
    const fullHeight = element.height / existingCropH;
    const fullX = element.x - existingCropX * fullWidth;
    const fullY = element.y - existingCropY * fullHeight;
    const fullOffsetX = element.flipX ? fullWidth : 0;
    const fullOffsetY = element.flipY ? fullHeight : 0;

    return (
      <KonvaImage
        ref={imageRef}
        // Distinct key from the normal-mode node: crop enter/exit must
        // REMOUNT the image. The CropOverlay rotation preview mutates node
        // attrs imperatively; if React reused the node on exit, the prop
        // diff would see unchanged JSX values (e.g. rotation) and never
        // reset the imperative residue — leaving a cancelled straighten
        // visually applied.
        key={`${element.id}-cropmode`}
        id={element.id}
        image={loadedImage}
        x={fullX}
        y={fullY}
        width={fullWidth}
        height={fullHeight}
        rotation={element.rotation}
        scaleX={flipScaleX}
        scaleY={flipScaleY}
        offsetX={fullOffsetX}
        offsetY={fullOffsetY}
        draggable={false}
        listening={false}
        perfectDrawEnabled={false}
      />
    );
  }

  const offsetX = element.flipX ? element.width : 0;
  const offsetY = element.flipY ? element.height : 0;
  const cropConfig = hasCrop ? {
    x: existingCropX * loadedImage.naturalWidth,
    y: existingCropY * loadedImage.naturalHeight,
    width: existingCropW * loadedImage.naturalWidth,
    height: existingCropH * loadedImage.naturalHeight,
  } : undefined;

  const contentRotation = element.contentRotation ?? 0;

  // ── Content-rotation branch ──────────────────────────────────────────
  // Image rotated INSIDE an upright frame. Structure:
  //   1. clipped Group (visual only, listening=false) — frame-shaped clip
  //      containing the image rotated/cover-scaled around the frame center
  //   2. invisible proxy Rect carrying the element id + all interaction
  //      (drag, click, Transformer attachment). Its geometry == frame, so
  //      the Transformer box is correct (a clipped Group's getClientRect
  //      would report the oversized rotated content instead).
  // The proxy imperatively syncs the Group during drag/transform, same
  // pattern as the selection-stroke sync above. The zero-rotation path
  // below is byte-identical to the pre-feature renderer.
  if (contentRotation !== 0) {
    const cover = coverScaleForRotation(element.width, element.height, contentRotation);
    const syncGroup = (node: Konva.Node) => {
      const g = clipGroupRef.current;
      if (!g) return;
      g.x(node.x());
      g.y(node.y());
      g.rotation(node.rotation());
      g.scaleX(node.scaleX());
      g.scaleY(node.scaleY());
    };
    return (
      <>
        <Group
          ref={clipGroupRef}
          key={`${element.id}-clip`}
          x={element.x}
          y={element.y}
          rotation={element.rotation}
          clipFunc={(ctx) => {
            ctx.rect(0, 0, element.width, element.height);
          }}
          listening={false}
        >
          <KonvaImage
            ref={imageRef}
            image={loadedImage}
            x={element.width / 2}
            y={element.height / 2}
            width={element.width}
            height={element.height}
            offsetX={element.width / 2}
            offsetY={element.height / 2}
            rotation={contentRotation}
            scaleX={cover * flipScaleX}
            scaleY={cover * flipScaleY}
            crop={cropConfig}
            listening={false}
            perfectDrawEnabled={false}
          />
        </Group>
        {/* Interaction proxy — invisible, frame-shaped. Carries the element
            id so Transformer/selection lookups attach here. */}
        <Rect
          key={element.id}
          id={element.id}
          x={element.x}
          y={element.y}
          width={element.width}
          height={element.height}
          rotation={element.rotation}
          fill="#000"
          opacity={0}
          draggable={isDraggable}
          onClick={handleClick}
          onTap={handleTap}
          onDragStart={onDragStart}
          onDragMove={(e) => {
            // Parent handler may snap-adjust the node position; sync the
            // visual group AFTER so it lands on the snapped coordinates.
            handleDragMove(e);
            syncGroup(e.target);
          }}
          onDragEnd={handleDragEnd}
          onTransform={(e) => syncGroup(e.target)}
          onTransformEnd={handleTransformEnd}
          perfectDrawEnabled={false}
          hitFunc={rectHitFunc}
        />
        {isSelected && (
          <Rect
            ref={strokeRef}
            x={element.x}
            y={element.y}
            width={element.width}
            height={element.height}
            rotation={element.rotation}
            stroke="#3b82f6"
            strokeWidth={2 / zoomLevel}
            strokeScaleEnabled={false}
            listening={false}
            perfectDrawEnabled={false}
          />
        )}
      </>
    );
  }

  return (
    <>
      <KonvaImage
        ref={imageRef}
        key={element.id}
        id={element.id}
        image={loadedImage}
        x={element.x}
        y={element.y}
        width={element.width}
        height={element.height}
        rotation={element.rotation}
        scaleX={flipScaleX}
        scaleY={flipScaleY}
        offsetX={offsetX}
        offsetY={offsetY}
        crop={cropConfig}
        draggable={isDraggable}
        onClick={handleClick}
        onTap={handleTap}
        onDragStart={onDragStart}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        onTransformEnd={handleTransformEnd}
        perfectDrawEnabled={false}
        hitFunc={rectHitFunc}
      />
      {/* Selection stroke — separate node so selecting/deselecting doesn't
          invalidate the KonvaImage cache (a full re-rasterize of the source). */}
      {isSelected && (
        <Rect
          ref={strokeRef}
          x={element.x}
          y={element.y}
          width={element.width}
          height={element.height}
          rotation={element.rotation}
          scaleX={flipScaleX}
          scaleY={flipScaleY}
          offsetX={offsetX}
          offsetY={offsetY}
          stroke="#3b82f6"
          strokeWidth={2 / zoomLevel}
          strokeScaleEnabled={false}
          listening={false}
          perfectDrawEnabled={false}
        />
      )}
    </>
  );
});
