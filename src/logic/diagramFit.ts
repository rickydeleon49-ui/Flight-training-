/** Pure zoom maths for the enlarged diagram view (BL-56). A scale of 1 is the diagram's natural size (100%). */

export const ZOOM_STEP = 0.25;
export const ZOOM_MAX = 4;
/** Zoom values within this of the fit scale count as "Fit". */
const EPSILON = 0.005;

/** The scale at which the whole diagram fits the stage, both ways. Never negative or non-finite. */
export function fitScale(stageW: number, stageH: number, naturalW: number, naturalH: number): number {
  if (!(stageW > 0) || !(stageH > 0) || !(naturalW > 0) || !(naturalH > 0)) return 1;
  return Math.min(stageW / naturalW, stageH / naturalH);
}

/** Keep a requested zoom between the fit scale and 400% (or the fit scale when that is already larger). */
export function clampZoom(scale: number, fit: number): number {
  const max = Math.max(ZOOM_MAX, fit);
  if (!Number.isFinite(scale)) return fit;
  return Math.min(max, Math.max(fit, scale));
}

/**
 * One + or - press. `current` is null while showing Fit. Returns null for Fit,
 * otherwise the new absolute scale on a 25% grid.
 */
export function stepZoom(current: number | null, fit: number, direction: 1 | -1): number | null {
  const from = current ?? fit;
  const grid = Math.round(from / ZOOM_STEP);
  // Move to the next grid line in the direction pressed (not just +/-25% off an odd fit value).
  const next = direction === 1
    ? (grid * ZOOM_STEP > from + EPSILON ? grid : grid + 1) * ZOOM_STEP
    : (grid * ZOOM_STEP < from - EPSILON ? grid : grid - 1) * ZOOM_STEP;
  return normalizeZoom(next, fit);
}

/** Clamp, and report null when the result is the fit scale. */
export function normalizeZoom(scale: number, fit: number): number | null {
  const clamped = clampZoom(scale, fit);
  return clamped <= fit + EPSILON ? null : clamped;
}

/** "Fit" or a whole-number percentage. */
export function zoomLabel(current: number | null): string {
  return current === null ? "Fit" : `${Math.round(current * 100)}%`;
}
