// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { readProofPng } from "./visualPng";

it("decodes and returns the picked PNG bytes as a data URL allowed by the installed CSP", async () => {
  const bytes = readFileSync("src/testing/fixtures/visual/practice-panel.png");
  const file = new File([bytes], "practice-panel.png", { type: "image/png" });
  // jsdom's File lacks arrayBuffer; supply the same picked-file bytes.
  Object.defineProperty(file, "arrayBuffer", { value: async () => Uint8Array.from(bytes).buffer });
  const seen: string[] = [];
  class CspImage {
    naturalWidth = 480;
    naturalHeight = 240;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(url: string) {
      if (!url) return;
      seen.push(url);
      queueMicrotask(() => url.startsWith("data:image/png;base64,") ? this.onload?.() : this.onerror?.());
    }
  }
  vi.stubGlobal("Image", CspImage);
  try {
    const picture = await readProofPng(file);
    expect(picture).toEqual({ width: 480, height: 240, url: `data:image/png;base64,${bytes.toString("base64")}` });
    expect(seen).toEqual([picture.url]);
  } finally { vi.unstubAllGlobals(); }
});
