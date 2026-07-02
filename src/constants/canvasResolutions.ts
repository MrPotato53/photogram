import { DESIGN_HEIGHT } from '../utils/designConstants';

/**
 * Canvas (working) resolution presets.
 *
 * These control ONLY the pixel resolution at which photos are rasterized on the
 * editing canvas (the Konva node cache). They are completely independent of the
 * design coordinate system (which is fixed at DESIGN_HEIGHT) and of the export
 * resolution. Raising it makes photos sharper when zoomed in (at the cost of
 * memory + redraw time); "Full" disables rasterization so photos are drawn from
 * their source bitmap at native resolution.
 *
 * `height` is the target vertical pixel count for a full-height slide. The Konva
 * cache pixelRatio is therefore `height / DESIGN_HEIGHT`. `height: null` means
 * "full" — no caching at all.
 */
export interface CanvasResolutionOption {
  key: string;
  label: string;
  height: number | null;
}

export const CANVAS_RESOLUTIONS: CanvasResolutionOption[] = [
  { key: '1080', label: '1080p', height: 1080 },
  { key: '1440', label: '1440p (2K)', height: 1440 },
  { key: '2160', label: '2160p (4K)', height: 2160 },
  { key: '2880', label: '2880p (5K)', height: 2880 },
  { key: '4320', label: '4320p (8K)', height: 4320 },
  { key: 'full', label: 'Full (no rasterization)', height: null },
];

export const DEFAULT_CANVAS_RESOLUTION = '1080';

/**
 * Resolve a stored preference key to the Konva cache pixelRatio base.
 * Returns `null` for the "full" option (render source directly, no cache).
 * Unknown keys fall back to the default (1080p → 1x).
 */
export function canvasResolutionToPixelRatio(key: string): number | null {
  const opt =
    CANVAS_RESOLUTIONS.find((o) => o.key === key) ??
    CANVAS_RESOLUTIONS.find((o) => o.key === DEFAULT_CANVAS_RESOLUTION)!;
  if (opt.height == null) return null;
  return opt.height / DESIGN_HEIGHT;
}
