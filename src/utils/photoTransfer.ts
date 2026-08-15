import type { Element } from '../types';
import { type CropWindow } from './contentRotation';
import { cropForFrame } from './photoFraming';

/**
 * Moving a photo into a frame — swap, replace, fill, and media-pool drop all
 * end up here.
 *
 * These paths kept drifting apart because each one re-decided the same three
 * questions independently, and a fix to one never reached the others (the
 * straighten angle was preserved by swap but silently dropped by replace for
 * exactly this reason). The answers, now in one place:
 *
 *  • the FRAME keeps its geometry — position, size, canvas rotation, z-order.
 *    Dropping a photo somewhere never moves or reshapes the frame;
 *  • the PHOTO keeps its own edits — straighten angle and flips travel with
 *    the image, because they are properties of the picture, not the slot;
 *  • the CROP is re-derived for the destination frame so nothing stretches
 *    (see `cropForFrame`).
 */

/** The element fields that describe "which photo, framed how". */
export interface PhotoPayload {
  type: 'photo';
  mediaId: string;
  assetPath: string | undefined;
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
  contentRotation: number;
  flipX: boolean;
  flipY: boolean;
  /**
   * The remembered crop aspect ratio belongs to a crop session on the
   * previous frame; carrying it over would re-open crop mode locked to a
   * ratio the user never chose here.
   */
  lastCropRatio: null;
}

export interface BuildPhotoPayloadArgs {
  mediaId: string;
  assetPath: string | undefined;
  /** Natural pixel size of the source image. */
  mediaWidth: number;
  mediaHeight: number;
  /** Destination frame size in design pixels. */
  frameWidth: number;
  frameHeight: number;
  contentRotation?: number;
  flipX?: boolean;
  flipY?: boolean;
  /**
   * The photo's existing crop, to preserve the user's framing and zoom.
   * Omit to compute a fresh centred cover crop — correct when the image is
   * arriving from the media pool, where there is no prior framing.
   */
  carry?: CropWindow;
}

/** Photo fields for a source image sitting in a frame of the given size. */
export function buildPhotoPayload({
  mediaId,
  assetPath,
  mediaWidth,
  mediaHeight,
  frameWidth,
  frameHeight,
  contentRotation = 0,
  flipX = false,
  flipY = false,
  carry,
}: BuildPhotoPayloadArgs): PhotoPayload {
  const crop = cropForFrame({
    mediaWidth,
    mediaHeight,
    frameWidth,
    frameHeight,
    contentRotation,
    carry,
  });

  return {
    type: 'photo',
    mediaId,
    assetPath,
    cropX: crop.cropX,
    cropY: crop.cropY,
    cropWidth: crop.cropWidth,
    cropHeight: crop.cropHeight,
    contentRotation,
    flipX,
    flipY,
    lastCropRatio: null,
  };
}

/**
 * Fields that turn a frame back into an empty placeholder, clearing every
 * property that described the photo that used to be there. A fresh object
 * each call so callers can never share (and mutate) one instance.
 */
export function emptyFramePayload(): Pick<
  Element,
  | 'type'
  | 'mediaId'
  | 'assetPath'
  | 'cropX'
  | 'cropY'
  | 'cropWidth'
  | 'cropHeight'
  | 'contentRotation'
  | 'flipX'
  | 'flipY'
  | 'lastCropRatio'
> {
  return {
    type: 'placeholder',
    mediaId: undefined,
    assetPath: undefined,
    cropX: 0,
    cropY: 0,
    cropWidth: 1,
    cropHeight: 1,
    contentRotation: 0,
    flipX: false,
    flipY: false,
    lastCropRatio: null,
  };
}
