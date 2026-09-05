import { describe, expect, it } from "vitest";

import { dataUrlBytes, fitWithin, PHOTO_MAX_EDGE } from "./image";

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
