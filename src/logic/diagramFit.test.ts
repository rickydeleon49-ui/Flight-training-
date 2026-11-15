import { describe, expect, it } from "vitest";
import { clampZoom, fitScale, normalizeZoom, stepZoom, zoomLabel } from "./diagramFit";

describe("diagram fit maths", () => {
  it("fit scale is limited by the tighter of width and height, at 900, 1200 and 1600 wide windows", () => {
    for (const [w, h] of [[852, 600], [1152, 700], [1552, 800]] as const) {
      const s = fitScale(w, h, 730, 430);
      expect(730 * s).toBeLessThanOrEqual(w + 1e-9);
      expect(430 * s).toBeLessThanOrEqual(h + 1e-9);
      expect(Math.abs(730 * s - w) < 1e-9 || Math.abs(430 * s - h) < 1e-9).toBe(true);
    }
    expect(fitScale(1460, 400, 730, 430)).toBeCloseTo(400 / 430);
  });
  it("fit scale falls back to 1 for empty or unmeasured sizes", () => {
    expect(fitScale(0, 500, 730, 430)).toBe(1);
    expect(fitScale(500, 500, 0, 430)).toBe(1);
  });
  it("zoom clamp keeps the scale between fit and 400%", () => {
    expect(clampZoom(0.1, 0.8)).toBe(0.8);
    expect(clampZoom(9, 0.8)).toBe(4);
    expect(clampZoom(2, 0.8)).toBe(2);
    expect(clampZoom(2, 5)).toBe(5);
  });
  it("steps on a 25% grid from Fit and returns to Fit", () => {
    expect(stepZoom(null, 0.8, 1)).toBe(1);
    expect(stepZoom(1, 0.8, 1)).toBe(1.25);
    expect(stepZoom(1.25, 0.8, -1)).toBe(1);
    expect(stepZoom(1, 0.8, -1)).toBeNull();
    expect(stepZoom(null, 0.8, -1)).toBeNull();
    expect(stepZoom(4, 0.8, 1)).toBe(4);
  });
  it("normalises near-fit values to Fit and labels them", () => {
    expect(normalizeZoom(0.801, 0.8)).toBeNull();
    expect(zoomLabel(null)).toBe("Fit");
    expect(zoomLabel(1.25)).toBe("125%");
  });
});
