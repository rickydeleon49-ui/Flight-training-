import { describe, expect, it } from "vitest";
import config from "../../../src-tauri/tauri.conf.json";

describe("portrait desktop window", () => {
  it("can fit a 644 pt portrait screen while keeping the default desktop size", () => {
    const window = config.app.windows[0]!;
    expect(window.minWidth).toBeGreaterThan(0);
    expect(window.minWidth).toBeLessThanOrEqual(644);
    expect(window.resizable).toBe(true);
    expect([window.width, window.height, window.minHeight]).toEqual([1320, 880, 700]);
  });
});
