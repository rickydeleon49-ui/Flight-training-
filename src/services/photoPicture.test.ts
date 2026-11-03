import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { deviceCan } from "./platform";
import { fitPictureLimits, photoToPng, savePhotoPicture, type PhotoDeps } from "./photoPicture";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("./platform", () => ({ deviceCan: vi.fn() }));
afterEach(() => vi.resetAllMocks());

/** A header-valid PNG of the given size (enough for inspectPng), padded to `bytes`. */
function fakePng(width: number, height: number, bytes = 0): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set([...type].map((c) => c.charCodeAt(0)), 4);
    out.set(data, 8);
    return out;
  };
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, width);
  new DataView(ihdr.buffer).setUint32(4, height);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", new Uint8Array(bytes)), chunk("IEND", new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

function mockDeps(width: number, height: number, encode: (w: number, h: number, attempt: number) => Uint8Array) {
  const drawn: Array<[number, number]> = [];
  const release = vi.fn();
  let attempt = 0;
  const deps: PhotoDeps = {
    decode: vi.fn(async () => ({ width, height, source: {} as CanvasImageSource, release })),
    canvas: (w, h) => {
      const canvas = {
        width: w,
        height: h,
        getContext: () => ({ drawImage: (_: unknown, _x: number, _y: number, dw: number, dh: number) => drawn.push([dw, dh]) }),
        toBlob: (done: (blob: Blob | null) => void, type: string) => {
          expect(type).toBe("image/png");
          done(new Blob([encode(w, h, attempt++) as BlobPart], { type: "image/png" }));
        },
      };
      return canvas as unknown as HTMLCanvasElement;
    },
  };
  return { deps, drawn, release };
}

const jpeg = (size = 3_000_000) => new Blob([new Uint8Array(size)], { type: "image/jpeg" });

it("converts a JPEG photo to a PNG inside the picture-card limits, keeping its shape", async () => {
  const { deps, drawn, release } = mockDeps(4032, 3024, (w, h) => fakePng(w, h));
  const png = await photoToPng(jpeg(), deps);
  const view = new DataView(png.buffer, png.byteOffset);
  const [w, h] = [view.getUint32(16), view.getUint32(20)];
  expect(drawn).toEqual([[w, h]]);
  expect(w * h).toBeLessThanOrEqual(4_000_000);
  expect(Math.max(w, h)).toBeLessThanOrEqual(4096);
  expect(w / h).toBeCloseTo(4032 / 3024, 2);
  expect(release).toHaveBeenCalledOnce();
});

it("keeps a small screenshot at its own size", async () => {
  const { deps, drawn } = mockDeps(1170, 2532, (w, h) => fakePng(w, h));
  await photoToPng(new Blob([new Uint8Array(10)], { type: "image/png" }), deps);
  expect(drawn).toEqual([[1170, 2532]]);
});

it("shrinks and retries when the PNG would be over 10 MiB", async () => {
  const { deps, drawn } = mockDeps(2000, 2000, (w, h, attempt) => fakePng(w, h, attempt === 0 ? 11 * 1024 * 1024 : 0));
  await photoToPng(jpeg(), deps);
  expect(drawn).toEqual([[2000, 2000], [1600, 1600]]);
});

it("refuses non-images and oversized photos before decoding", async () => {
  const { deps } = mockDeps(10, 10, (w, h) => fakePng(w, h));
  await expect(photoToPng(new Blob(["x"], { type: "text/plain" }), deps)).rejects.toThrow("photo or screenshot");
  await expect(photoToPng(jpeg(41 * 1024 * 1024), deps)).rejects.toThrow("too large");
  expect(deps.decode).not.toHaveBeenCalled();
});

it("refuses when the canvas does not give back a real PNG of the drawn size", async () => {
  const { deps, release } = mockDeps(100, 100, () => fakePng(50, 50));
  await expect(photoToPng(jpeg(), deps)).rejects.toThrow("couldn't be opened");
  expect(release).toHaveBeenCalledOnce();
});

it("fits the limits on edge and total pixels", () => {
  expect(fitPictureLimits(8000, 1000)).toEqual({ width: 4096, height: 512 });
  const big = fitPictureLimits(4032, 3024);
  expect(big.width * big.height).toBeLessThanOrEqual(4_000_000);
});

it("saves the checked PNG through the native command on the iPhone only", async () => {
  const png = fakePng(10, 10);
  vi.mocked(deviceCan).mockReturnValue({ pictureFromPhoto: true } as ReturnType<typeof deviceCan>);
  const saved = { materialId: "m1", imageSha256: "a".repeat(64), imageWidth: 10, imageHeight: 10 };
  vi.mocked(invoke).mockResolvedValue(saved);
  expect(await savePhotoPicture(png)).toBe(saved);
  expect(invoke).toHaveBeenCalledWith("save_photo_picture", png);

  vi.mocked(invoke).mockClear();
  vi.mocked(deviceCan).mockReturnValue({ pictureFromPhoto: false } as ReturnType<typeof deviceCan>);
  await expect(savePhotoPicture(png)).rejects.toThrow("Only on the iPhone");
  expect(invoke).not.toHaveBeenCalled();
});
