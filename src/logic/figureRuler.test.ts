import { expect, it } from "vitest";
import { SECTIONAL_PACK } from "./sectionalPack";
import { SM_PER_NM, clampPoint, defaultRuler, distancePx, formatRuler, nmToSm, nudge, pxToNm, rulerDistance } from "./figureRuler";

it("measures pixel distance and converts to NM and SM", () => {
  expect(distancePx({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  expect(pxToNm(250, 25)).toBe(10);
  expect(pxToNm(250, undefined)).toBe(0);
  expect(pxToNm(250, 0)).toBe(0);
  expect(nmToSm(10)).toBeCloseTo(11.508, 5);
  const d = rulerDistance({ x: 100, y: 100 }, { x: 350, y: 100 }, 25);
  expect(d.nm).toBe(10);
  expect(d.sm).toBeCloseTo(10 * SM_PER_NM, 5);
  expect(formatRuler(10)).toBe("10.0 NM (11.5 SM)");
});

it("clamps and nudges within the image", () => {
  expect(clampPoint({ x: -5, y: 9999 }, 100, 200)).toEqual({ x: 0, y: 200 });
  expect(nudge({ x: 50, y: 50 }, "ArrowRight", false, 100, 100)).toEqual({ x: 56, y: 50 });
  expect(nudge({ x: 50, y: 50 }, "ArrowUp", true, 100, 100)).toEqual({ x: 50, y: 20 });
  expect(nudge({ x: 98, y: 50 }, "ArrowRight", true, 100, 100)).toEqual({ x: 100, y: 50 });
  expect(nudge({ x: 50, y: 50 }, "a", false, 100, 100)).toBeNull();
  const [a, b] = defaultRuler(300, 600);
  expect(a).toEqual({ x: 100, y: 300 });
  expect(b).toEqual({ x: 200, y: 300 });
});

// Calibration check: printed NM scale-bar ticks (0 and 30/40/50 NM) measured in each image, 1 NM tolerance.
const TICKS: Record<string, [number, number, number]> = {
  "faa-20": [254, 1296, 50],
  "faa-21": [315, 1132, 30],
  "faa-22": [327, 1135, 30],
  "faa-26": [305, 1066, 30],
  "faa-59": [283, 982, 30],
  "faa-69": [324.5, 1147, 30],
};
it("every pack figure is calibrated and its own scale bar measures its printed length within 1 NM", () => {
  for (const fig of SECTIONAL_PACK.figures) {
    const [x0, x1, nm] = TICKS[fig.id]!;
    const got = rulerDistance({ x: x0, y: 0 }, { x: x1, y: 0 }, fig.pxPerNm).nm;
    expect(Math.abs(got - nm), fig.id).toBeLessThanOrEqual(1);
  }
});
