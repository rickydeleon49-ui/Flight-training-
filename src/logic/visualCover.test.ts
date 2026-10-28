import { describe, expect, it } from "vitest";

import {
  adjustCover,
  clampCover,
  defaultCover,
  displayToImage,
  displayTransform,
  drawnCover,
  rotatedSize,
  rotatePoint,
  rotationTransform,
  unrotatePoint,
  type Display,
  type Point,
  type Size,
  type Turn,
} from "./visualCover";

const TURNS: Turn[] = [0, 90, 180, 270];
const PANEL: Size = { width: 480, height: 240 };

/** Applies an SVG "translate(a b) rotate(r)" string the way a browser would. */
function applySvg(transform: string, p: Point): Point {
  let out = { ...p };
  const ops = [...transform.matchAll(/(translate|rotate)\(([^)]*)\)/g)].reverse();
  for (const [, op, args] of ops) {
    const n = args!.trim().split(/[\s,]+/).map(Number);
    if (op === "rotate") {
      const r = (n[0]! * Math.PI) / 180;
      out = { x: out.x * Math.cos(r) - out.y * Math.sin(r), y: out.x * Math.sin(r) + out.y * Math.cos(r) };
    } else {
      out = { x: out.x + n[0]!, y: out.y + (n[1] ?? 0) };
    }
  }
  return { x: Math.round(out.x * 1e9) / 1e9 + 0, y: Math.round(out.y * 1e9) / 1e9 + 0 };
}

/** Forward mapping image pixel → CSS pixel, built independently of displayToImage. */
function imageToDisplay(p: Point, s: Size, t: Turn, d: Display): Point {
  const a = displayTransform(s, t, d);
  const r = rotatePoint(p, s, t);
  return { x: d.left + a.x + r.x * a.scale, y: d.top + a.y + r.y * a.scale };
}

describe("quarter-turn view rotation", () => {
  it("maps (x,y) to (H-y,x) for 90 degrees clockwise, as the plan specifies", () => {
    expect(rotatePoint({ x: 10, y: 20 }, PANEL, 90)).toEqual({ x: 240 - 20, y: 10 });
  });

  it.each(TURNS)("the SVG transform for %i° matches rotatePoint and stays inside the rotated bounds", (t) => {
    const r = rotatedSize(PANEL, t);
    for (const p of [{ x: 0, y: 0 }, { x: 480, y: 0 }, { x: 0, y: 240 }, { x: 480, y: 240 }, { x: 37, y: 191 }]) {
      const q = applySvg(rotationTransform(PANEL, t), p);
      expect(q).toEqual(rotatePoint(p, PANEL, t));
      expect(q.x).toBeGreaterThanOrEqual(0);
      expect(q.y).toBeGreaterThanOrEqual(0);
      expect(q.x).toBeLessThanOrEqual(r.width);
      expect(q.y).toBeLessThanOrEqual(r.height);
    }
  });

  it.each(TURNS)("unrotatePoint inverts rotatePoint at %i°", (t) => {
    for (const p of [{ x: 0, y: 0 }, { x: 479, y: 239 }, { x: 12.5, y: 200.25 }]) {
      expect(unrotatePoint(rotatePoint(p, PANEL, t), PANEL, t)).toEqual(p);
    }
  });
});

describe("display transform and pointer inversion", () => {
  // A wide box: a 480x240 picture letterboxes left/right; turned 90° it is 240x480.
  const box: Display = { left: 100, top: 50, width: 600, height: 360, zoom: 1 };

  it("letterboxes and centres the picture", () => {
    const flat = displayTransform(PANEL, 0, box);
    expect(flat.scale).toBeCloseTo(1.25);
    expect(flat.x).toBeCloseTo(0);
    expect(flat.y).toBeCloseTo(30);
    const turned = displayTransform(PANEL, 90, box);
    expect(turned.scale).toBeCloseTo(0.75);
    expect(turned.x).toBeCloseTo((600 - 240 * 0.75) / 2);
    expect(turned.y).toBeCloseTo(0);
  });

  it.each(TURNS)("inverts the complete display transform at %i° for zooms 0.75–2", (t) => {
    for (const zoom of [0.75, 1, 1.5, 2]) {
      for (const p of [{ x: 0, y: 0 }, { x: 480, y: 240 }, { x: 101, y: 17 }]) {
        const d = { ...box, zoom };
        const back = displayToImage(imageToDisplay(p, PANEL, t, d), PANEL, t, d);
        expect(back.x).toBeCloseTo(p.x, 6);
        expect(back.y).toBeCloseTo(p.y, 6);
      }
    }
  });

  it("works in CSS pixels, so high device-pixel ratios and fractional rects change nothing", () => {
    // At DPR 2 or 3 the browser still reports CSS pixels, often fractional.
    const fractional: Display = { left: 100.333, top: 50.5, width: 600.667, height: 360.5, zoom: 1 };
    for (const t of TURNS) {
      const p = { x: 200, y: 120 };
      const back = displayToImage(imageToDisplay(p, PANEL, t, fractional), PANEL, t, fractional);
      expect(back.x).toBeCloseTo(200, 6);
      expect(back.y).toBeCloseTo(120, 6);
    }
  });

  it.each(TURNS)("a drawn cover at %i° lands on the same image pixels and rounds outward", (t) => {
    const target = { x: 30, y: 175, w: 100, h: 30 }; // around the ALPHA label
    const a = imageToDisplay({ x: target.x + 0.4, y: target.y + 0.4 }, PANEL, t, box);
    const b = imageToDisplay({ x: target.x + target.w - 0.4, y: target.y + target.h - 0.4 }, PANEL, t, box);
    expect(drawnCover(a, b, PANEL, t, box)).toEqual(target);
    // Dragging the other way gives the same cover.
    expect(drawnCover(b, a, PANEL, t, box)).toEqual(target);
  });

  it.each(TURNS)("clamps a drag past the picture's edges at %i°", (t) => {
    const c = drawnCover({ x: -500, y: -500 }, { x: 5000, y: 5000 }, PANEL, t, box);
    expect(c).toEqual({ x: 0, y: 0, w: 480, h: 240 });
  });

  it("keeps a click in the letterbox margin as a tiny cover inside the picture", () => {
    const c = drawnCover({ x: 101, y: 51 }, { x: 101, y: 51 }, PANEL, 0, box);
    expect(c.x).toBe(0);
    expect(c.y).toBe(0);
    expect(c.w).toBeGreaterThanOrEqual(1);
    expect(c.h).toBeGreaterThanOrEqual(1);
  });
});

describe("cover bounds", () => {
  it("clamps to integers inside the picture with positive size", () => {
    expect(clampCover({ x: -3.2, y: 239.9, w: 0, h: 50 }, PANEL)).toEqual({ x: 0, y: 239, w: 1, h: 1 });
    expect(clampCover({ x: 470, y: 0, w: 99, h: 999 }, PANEL)).toEqual({ x: 470, y: 0, w: 10, h: 240 });
  });

  it("moves by 1 pixel with an arrow and 10 with Shift, stopping at the edges", () => {
    const c = { x: 5, y: 5, w: 20, h: 10 };
    expect(adjustCover(c, PANEL, "ArrowRight", false, false)).toEqual({ ...c, x: 6 });
    expect(adjustCover(c, PANEL, "ArrowDown", true, false)).toEqual({ ...c, y: 15 });
    expect(adjustCover(c, PANEL, "ArrowLeft", true, false)).toEqual({ ...c, x: 0 });
    expect(adjustCover({ ...c, x: 455 }, PANEL, "ArrowRight", true, false)).toEqual({ ...c, x: 460 });
  });

  it("resizes in Resize mode without shrinking below 1 pixel or past the edge", () => {
    const c = { x: 5, y: 5, w: 2, h: 10 };
    expect(adjustCover(c, PANEL, "ArrowRight", true, true)).toEqual({ ...c, w: 12 });
    expect(adjustCover(c, PANEL, "ArrowLeft", true, true)).toEqual({ ...c, w: 1 });
    expect(adjustCover({ x: 470, y: 230, w: 10, h: 10 }, PANEL, "ArrowDown", true, true)).toEqual({ x: 470, y: 230, w: 10, h: 10 });
  });

  it("starts with a small centred cover she can see around", () => {
    expect(defaultCover(PANEL)).toEqual({ x: 180, y: 100, w: 120, h: 40 });
    expect(defaultCover({ width: 1, height: 1 })).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });
});
