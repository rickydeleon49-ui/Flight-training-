/** Intrinsic image pixels only. Display bounds are CSS pixels, independent of DPR. */
export interface Size { width: number; height: number }
export interface Point { x: number; y: number }
export interface Cover { x: number; y: number; w: number; h: number }
export type Turn = 0 | 90 | 180 | 270;
export function clampCover(c: Cover, s: Size): Cover {
  const x = Math.max(0, Math.min(s.width - 1, Math.floor(c.x)));
  const y = Math.max(0, Math.min(s.height - 1, Math.floor(c.y)));
  return { x, y, w: Math.max(1, Math.min(s.width - x, Math.ceil(c.w))), h: Math.max(1, Math.min(s.height - y, Math.ceil(c.h))) };
}
export function rotatedSize(s: Size, turn: Turn): Size {
  return turn === 90 || turn === 270 ? { width: s.height, height: s.width } : s;
}
export function rotatePoint(p: Point, s: Size, t: Turn): Point {
  switch (t) {
    case 90: return { x: s.height - p.y, y: p.x };
    case 180: return { x: s.width - p.x, y: s.height - p.y };
    case 270: return { x: p.y, y: s.width - p.x };
    default: return p;
  }
}
export function unrotatePoint(p: Point, s: Size, t: Turn): Point {
  switch (t) {
    case 90: return { x: p.y, y: s.height - p.x };
    case 180: return { x: s.width - p.x, y: s.height - p.y };
    case 270: return { x: s.width - p.y, y: p.x };
    default: return p;
  }
}
export function rotationTransform(s: Size, t: Turn): string {
  switch (t) {
    case 90: return `translate(${s.height} 0) rotate(90)`;
    case 180: return `translate(${s.width} ${s.height}) rotate(180)`;
    case 270: return `translate(0 ${s.width}) rotate(270)`;
    default: return '';
  }
}
export interface Display { left: number; top: number; width: number; height: number; zoom: number }
export function displayTransform(s: Size, t: Turn, d: Display) {
  const r = rotatedSize(s, t);
  const scale = Math.min(d.width / r.width, d.height / r.height) * d.zoom;
  return { scale, x: (d.width - r.width * scale) / 2, y: (d.height - r.height * scale) / 2 };
}
export function displayToImage(p: Point, s: Size, t: Turn, d: Display): Point {
  const a = displayTransform(s, t, d);
  return unrotatePoint({ x: (p.x - d.left - a.x) / a.scale, y: (p.y - d.top - a.y) / a.scale }, s, t);
}
export function drawnCover(a: Point, b: Point, s: Size, t: Turn, d: Display): Cover {
  const corners = [a, b, { x: a.x, y: b.y }, { x: b.x, y: a.y }].map(p => displayToImage(p, s, t, d));
  const x = Math.max(0, Math.min(s.width - 1, Math.floor(Math.min(...corners.map(p => p.x)))));
  const y = Math.max(0, Math.min(s.height - 1, Math.floor(Math.min(...corners.map(p => p.y)))));
  const right = Math.max(x + 1, Math.min(s.width, Math.ceil(Math.max(...corners.map(p => p.x)))));
  const bottom = Math.max(y + 1, Math.min(s.height, Math.ceil(Math.max(...corners.map(p => p.y)))));
  return { x, y, w: right - x, h: bottom - y };
}
export function adjustCover(c: Cover, s: Size, key: string, shift: boolean, resize: boolean): Cover {
  const n = shift ? 10 : 1;
  const dx = key === 'ArrowRight' ? n : key === 'ArrowLeft' ? -n : 0;
  const dy = key === 'ArrowDown' ? n : key === 'ArrowUp' ? -n : 0;
  if (resize) return clampCover({ ...c, w: c.w + dx, h: c.h + dy }, s);
  return { ...c, x: Math.max(0, Math.min(s.width - c.w, c.x + dx)), y: Math.max(0, Math.min(s.height - c.h, c.y + dy)) };
}
/** A starting cover in the middle of the picture, small enough to see around. */
export function defaultCover(s: Size): Cover {
  const w = Math.max(1, Math.round(s.width / 4)), h = Math.max(1, Math.round(s.height / 6));
  return clampCover({ x: Math.floor((s.width - w) / 2), y: Math.floor((s.height - h) / 2), w, h }, s);
}
