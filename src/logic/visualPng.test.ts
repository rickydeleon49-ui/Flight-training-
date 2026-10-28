import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { inspectPng, PNG_MAX_BYTES } from "./visualPng";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../testing/fixtures/visual/${name}`, import.meta.url)));

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
function chunk(type: string, data: Uint8Array): number[] {
  const len = data.length;
  // CRC is not checked by the header guard; the decoder checks it later.
  return [len >>> 24, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...[...type].map((c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0];
}
function png(width: number, height: number, extra: number[] = []): Uint8Array {
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, width);
  new DataView(ihdr.buffer).setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return new Uint8Array([...SIG, ...chunk("IHDR", ihdr), ...extra, ...chunk("IDAT", deflateSync(new Uint8Array(4))), ...chunk("IEND", new Uint8Array())]);
}

describe("PNG header guard", () => {
  it("accepts the synthetic practice panel and reads its intrinsic size", () => {
    expect(inspectPng(fixture("practice-panel.png"))).toEqual({ width: 480, height: 240 });
  });

  it("refuses a header bomb before decoding", () => {
    expect(() => inspectPng(fixture("bad-header-bomb.png"))).toThrow(/smaller picture/);
  });

  it("refuses a truncated file", () => {
    expect(() => inspectPng(fixture("bad-truncated.png"))).toThrow(/complete, still PNG/);
  });

  it("refuses an animated PNG", () => {
    expect(() => inspectPng(fixture("bad-animated.png"))).toThrow(/still PNG instead of an animated/);
  });

  it("refuses a JPEG saved with a .png name", () => {
    expect(() => inspectPng(fixture("bad-jpeg-renamed.png"))).toThrow(/complete, still PNG/);
  });

  it("allows exactly 4,000,000 pixels and 4,096 pixels per side", () => {
    expect(inspectPng(png(2000, 2000))).toEqual({ width: 2000, height: 2000 });
    expect(inspectPng(png(4096, 976))).toEqual({ width: 4096, height: 976 });
  });

  it("refuses one pixel more on any limit", () => {
    expect(() => inspectPng(png(2001, 2000))).toThrow(/smaller picture/);
    expect(() => inspectPng(png(4097, 1))).toThrow(/smaller picture/);
    expect(() => inspectPng(png(1, 4097))).toThrow(/smaller picture/);
    expect(() => inspectPng(png(0, 10))).toThrow(/smaller picture/);
  });

  it("refuses a file over 10 MiB before reading its chunks", () => {
    const big = new Uint8Array(PNG_MAX_BYTES + 1);
    big.set(png(10, 10));
    expect(() => inspectPng(big)).toThrow(/smaller than 10 MiB/);
  });

  it("refuses an animation control chunk placed after the image data too", () => {
    const actl = new Uint8Array(8);
    const bytes = png(10, 10);
    const iendAt = bytes.length - 12;
    const animatedLate = new Uint8Array([...bytes.subarray(0, iendAt), ...chunk("acTL", actl), ...bytes.subarray(iendAt)]);
    expect(() => inspectPng(animatedLate)).toThrow(/animated/);
  });

  it("refuses a chunk length that runs past the end of the file", () => {
    const bytes = png(10, 10);
    new DataView(bytes.buffer).setUint32(33, 0x7fffffff);
    expect(() => inspectPng(bytes)).toThrow(/complete, still PNG/);
  });

  it("refuses bytes after IEND and a missing IEND", () => {
    expect(() => inspectPng(new Uint8Array([...png(10, 10), 0]))).toThrow(/complete, still PNG/);
    expect(() => inspectPng(png(10, 10).subarray(0, -12))).toThrow(/complete, still PNG/);
  });

  it("uses kind, plain refusal wording", () => {
    for (const name of ["bad-header-bomb.png", "bad-truncated.png", "bad-animated.png", "bad-jpeg-renamed.png"]) {
      try {
        inspectPng(fixture(name));
      } catch (error) {
        expect((error as Error).message).toMatch(/^Please choose /);
      }
    }
  });
});
