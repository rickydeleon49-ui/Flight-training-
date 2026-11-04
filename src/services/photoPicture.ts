/**
 * iPhone: turn a photo or screenshot into a picture-card PNG.
 *
 * iOS hands web file inputs a JPEG (it converts HEIC itself). The webview
 * draws it on a canvas and re-encodes it as PNG, so no image decoder is added
 * to the app. The PNG then goes through the same checks as every picture
 * card (inspectPng here, inspect_png in Rust) before it is saved.
 */
import { invoke } from "@tauri-apps/api/core";
import { inspectPng, PNG_MAX_BYTES } from "@/logic/visualPng";
import { deviceCan } from "./platform";

/** A phone photo larger than this is refused before decoding. */
export const PHOTO_MAX_BYTES = 40 * 1024 * 1024;
const MAX_EDGE = 4096;
const MAX_PIXELS = 4_000_000;

export interface SavedPhoto {
  materialId: string;
  imageSha256: string;
  imageWidth: number;
  imageHeight: number;
}

export interface DecodedPhoto {
  width: number;
  height: number;
  source: CanvasImageSource;
  release: () => void;
}

export interface PhotoDeps {
  decode: (file: Blob) => Promise<DecodedPhoto>;
  canvas: (width: number, height: number) => HTMLCanvasElement;
}

/** The largest size inside the picture-card limits, keeping the shape. */
export function fitPictureLimits(width: number, height: number, shrink = 1): { width: number; height: number } {
  const scale = Math.min(1, MAX_EDGE / width, MAX_EDGE / height, Math.sqrt(MAX_PIXELS / (width * height))) * shrink;
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}

const unreadable = () => new Error("This photo couldn't be opened. Try another photo or screenshot.");

function decodeWithImage(file: Blob): Promise<DecodedPhoto> {
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const image = new Image();
    const release = () => {
      image.src = "";
      URL.revokeObjectURL(url);
    };
    // WebKit applies the photo's EXIF orientation when drawing, so the copy is upright.
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight, source: image, release });
    image.onerror = () => {
      release();
      reject(unreadable());
    };
    image.src = url;
  });
}

const browserDeps: PhotoDeps = {
  decode: decodeWithImage,
  canvas: (width, height) => Object.assign(document.createElement("canvas"), { width, height }),
};

function encodePng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob || blob.type !== "image/png") return reject(unreadable());
      blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), () => reject(unreadable()));
    }, "image/png");
  });
}

/** Photo (JPEG/PNG/anything the webview can draw) to a PNG inside the 01c limits. */
export async function photoToPng(file: Blob, deps: PhotoDeps = browserDeps): Promise<Uint8Array> {
  if (!file.type.startsWith("image/")) throw new Error("Please choose a photo or screenshot.");
  if (file.size > PHOTO_MAX_BYTES) throw new Error("This photo is too large. Try a screenshot of the part you need.");
  const photo = await deps.decode(file);
  try {
    if (!photo.width || !photo.height) throw unreadable();
    // Photos with fine detail can make a big PNG; shrink a little and retry.
    for (const shrink of [1, 0.8, 0.6, 0.45]) {
      const size = fitPictureLimits(photo.width, photo.height, shrink);
      const canvas = deps.canvas(size.width, size.height);
      const context = canvas.getContext("2d");
      if (!context) throw unreadable();
      context.drawImage(photo.source, 0, 0, size.width, size.height);
      const png = await encodePng(canvas);
      canvas.width = canvas.height = 0;
      if (png.length > PNG_MAX_BYTES) continue;
      const checked = inspectPng(png);
      if (checked.width !== size.width || checked.height !== size.height) throw unreadable();
      return png;
    }
    throw new Error("This photo is too detailed to save. Try a screenshot of the part you need.");
  } finally {
    photo.release();
  }
}

/** Save a checked PNG as a new picture in the student's library (iPhone only). */
export async function savePhotoPicture(png: Uint8Array): Promise<SavedPhoto> {
  if (!deviceCan().pictureFromPhoto) throw new Error("Only on the iPhone");
  inspectPng(png);
  const saved = await invoke<SavedPhoto>("save_photo_picture", png);
  if (!saved || typeof saved.materialId !== "string" || !saved.materialId || !/^[a-f0-9]{64}$/.test(saved.imageSha256)) {
    throw new Error("Couldn't save this picture. Please try again.");
  }
  return saved;
}
