import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/data";
import { inspectPng } from "@/logic/visualPng";
import type { VisualRegion } from "@/data/visualCards";

export interface VisualPicture {
  imageSha256: string;
  imageWidth: number;
  imageHeight: number;
  url: string;
}

const PNG_PREFIX = "data:image/png;base64,";

/** One bounded picture at a time; release callers' references on close/Next. */
let decodeQueue: Promise<void> = Promise.resolve();

export function readVisualPicture(materialId: string, region?: VisualRegion): Promise<VisualPicture> {
  const task = decodeQueue.then(() => readPicture(materialId, region));
  decodeQueue = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

async function readPicture(materialId: string, region?: VisualRegion): Promise<VisualPicture> {
  if (!isTauri()) throw Error("Open the desktop app to use a saved PNG picture.");
  const p = await invoke<VisualPicture>("read_visual_image", {
    materialId,
    regionId: region?.id ?? null,
    ownerMaterialId: region?.ownerMaterialId ?? null,
  });
  if (
    !p ||
    typeof p.url !== "string" ||
    !p.url.startsWith(PNG_PREFIX) ||
    p.url.length > 14 * 1024 * 1024 ||
    !/^[a-f0-9]{64}$/.test(p.imageSha256)
  ) {
    throw Error("This picture is unavailable.");
  }
  const bytes = Uint8Array.from(atob(p.url.slice(PNG_PREFIX.length)), (c) => c.charCodeAt(0));
  const size = inspectPng(bytes);
  if (
    size.width !== p.imageWidth ||
    size.height !== p.imageHeight ||
    (region &&
      (p.imageSha256 !== region.imageSha256 ||
        p.imageWidth !== region.imageWidth ||
        p.imageHeight !== region.imageHeight))
  ) {
    throw Error("This picture has changed.");
  }
  await new Promise<void>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const ok = img.naturalWidth === size.width && img.naturalHeight === size.height;
      img.src = "";
      if (ok) resolve();
      else reject(Error("This picture is unavailable."));
    };
    img.onerror = () => {
      img.src = "";
      reject(Error("This picture is unavailable."));
    };
    img.src = p.url;
  });
  return p;
}
