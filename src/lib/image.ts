/**
 * Preparing a profile photo for storage.
 *
 * Whatever she picks is downscaled and re-encoded before it is saved, so a
 * 6 MB phone photo becomes a few tens of kilobytes. That is what makes it
 * reasonable to keep in her database next to everything else about her,
 * rather than managing a separate file on disk.
 */

/** Longest edge of the stored photo, in pixels. Ample for a 96px display. */
export const PHOTO_MAX_EDGE = 384;

/** Anything larger than this is refused rather than silently ground through. */
export const PHOTO_MAX_INPUT_BYTES = 15 * 1024 * 1024;

export class PhotoError extends Error {}

/**
 * Scale dimensions to fit a square bound, preserving aspect ratio.
 * An image already inside the bound is left alone rather than upscaled.
 */
export function fitWithin(
  width: number,
  height: number,
  max: number,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const longest = Math.max(width, height);
  if (longest <= max) return { width: Math.round(width), height: Math.round(height) };
  const scale = max / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Load a File into an HTMLImageElement, revoking the object URL afterwards. */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new PhotoError("That file could not be read as an image."));
    };
    image.src = url;
  });
}

/**
 * Turn a picked file into a small, square-cropped data URL.
 *
 * Centre-cropped to a square because it is displayed as a circle; cropping
 * here rather than in CSS keeps the stored bytes down too.
 */
export async function readPhotoAsDataUrl(
  file: File,
  maxEdge: number = PHOTO_MAX_EDGE,
): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new PhotoError("Choose an image file.");
  }
  if (file.size > PHOTO_MAX_INPUT_BYTES) {
    throw new PhotoError("That image is very large. Try one under 15 MB.");
  }

  const image = await loadImage(file);
  const side = Math.min(image.naturalWidth, image.naturalHeight);
  if (side === 0) throw new PhotoError("That image appears to be empty.");

  const target = Math.min(side, maxEdge);
  const canvas = document.createElement("canvas");
  canvas.width = target;
  canvas.height = target;

  const context = canvas.getContext("2d");
  if (!context) throw new PhotoError("This device could not process that image.");

  // Centre crop, then draw at the target size in one step.
  context.drawImage(
    image,
    (image.naturalWidth - side) / 2,
    (image.naturalHeight - side) / 2,
    side,
    side,
    0,
    0,
    target,
    target,
  );

  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  if (!dataUrl.startsWith("data:image/")) {
    throw new PhotoError("That image could not be saved.");
  }
  return dataUrl;
}

/** Rough byte size of a data URL, for showing what is being stored. */
export const dataUrlBytes = (dataUrl: string): number => {
  const comma = dataUrl.indexOf(",");
  if (comma === -1) return 0;
  return Math.round(((dataUrl.length - comma - 1) * 3) / 4);
};
