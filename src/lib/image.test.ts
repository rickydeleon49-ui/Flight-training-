// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { dataUrlBytes, fitWithin, loadImage, PHOTO_MAX_EDGE } from "./image";

describe("fitWithin", () => {
  it("scales a large landscape photo down by its longest edge", () => {
    expect(fitWithin(4032, 3024, 384)).toEqual({ width: 384, height: 288 });
  });

  it("scales a large portrait photo the same way", () => {
    expect(fitWithin(3024, 4032, 384)).toEqual({ width: 288, height: 384 });
  });

  it("leaves a small image alone rather than upscaling it", () => {
    expect(fitWithin(120, 90, 384)).toEqual({ width: 120, height: 90 });
  });

  it("never rounds an edge away to nothing", () => {
    const { width, height } = fitWithin(4000, 3, PHOTO_MAX_EDGE);
    expect(width).toBe(384);
    expect(height).toBeGreaterThanOrEqual(1);
  });

  it("handles degenerate input without throwing", () => {
    expect(fitWithin(0, 0, 384)).toEqual({ width: 0, height: 0 });
    expect(fitWithin(-10, 20, 384)).toEqual({ width: 0, height: 0 });
  });
});

describe("dataUrlBytes", () => {
  it("estimates the stored size of a data URL", () => {
    // 8 base64 characters encode 6 bytes.
    expect(dataUrlBytes("data:image/jpeg;base64,AAAAAAAA")).toBe(6);
  });

  it("returns zero for something that is not a data URL", () => {
    expect(dataUrlBytes("not-a-data-url")).toBe(0);
  });
});

describe("loadImage", () => {
  it("loads the picked file through a data: URL, which the app's CSP allows", async () => {
    const seen: string[] = [];
    const RealImage = globalThis.Image;
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(value: string) {
        seen.push(value);
        queueMicrotask(() => this.onload?.());
      }
    }
    globalThis.Image = FakeImage as unknown as typeof Image;
    try {
      const file = new File([new Uint8Array([1, 2, 3])], "me.png", { type: "image/png" });
      await loadImage(file);
    } finally {
      globalThis.Image = RealImage;
    }
    expect(seen).toHaveLength(1);
    expect(seen[0]?.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("matches the CSP: images may come from 'self' and data: only", () => {
    const conf = JSON.parse(readFileSync(resolve(__dirname, "../../src-tauri/tauri.conf.json"), "utf8"));
    const csp: string = conf.app.security.csp;
    const imgSrc = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("img-src"));
    expect(imgSrc).toBe("img-src 'self' data:");
    const scriptSrc = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src"));
    expect(scriptSrc).toBe("script-src 'self'");
  });
});
