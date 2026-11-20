/** BL-117: ruler maths for figures that print their own distance scale. Points are in the image's own pixels. */
export const SM_PER_NM = 1.1508;

export type RulerPoint = { x: number; y: number };

export function distancePx(a: RulerPoint, b: RulerPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Nautical miles for a pixel distance; 0 when the scale is missing or not positive. */
export function pxToNm(px: number, pxPerNm: number | undefined): number {
  return pxPerNm && pxPerNm > 0 ? px / pxPerNm : 0;
}

export function nmToSm(nm: number): number {
  return nm * SM_PER_NM;
}

export function rulerDistance(a: RulerPoint, b: RulerPoint, pxPerNm: number | undefined): { nm: number; sm: number } {
  const nm = pxToNm(distancePx(a, b), pxPerNm);
  return { nm, sm: nmToSm(nm) };
}

/** "12.3 NM (14.2 SM)". */
export function formatRuler(nm: number): string {
  return `${nm.toFixed(1)} NM (${nmToSm(nm).toFixed(1)} SM)`;
}

export function clampPoint(p: RulerPoint, width: number, height: number): RulerPoint {
  return { x: Math.min(width, Math.max(0, p.x)), y: Math.min(height, Math.max(0, p.y)) };
}

/** Arrow-key nudge in image pixels (Shift = 5x); null for other keys. */
export function nudge(p: RulerPoint, key: string, shift: boolean, width: number, height: number, step = 6): RulerPoint | null {
  const d = shift ? step * 5 : step;
  const move: Record<string, [number, number]> = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] };
  const m = move[key];
  return m ? clampPoint({ x: p.x + m[0], y: p.y + m[1] }, width, height) : null;
}

/** Start positions: a horizontal line across the middle third of the figure. */
export function defaultRuler(width: number, height: number): [RulerPoint, RulerPoint] {
  return [{ x: width / 3, y: height / 2 }, { x: (2 * width) / 3, y: height / 2 }];
}
