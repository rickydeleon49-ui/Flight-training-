import type { OralRating } from "@/domain/types";

/** Newest kept when over the cap (the list is oldest first). */
export const ORAL_RATING_CAP = 200;

const text = (v: unknown): v is string => typeof v === "string" && v.length > 0;

export function normalizeOralRatings(value: unknown): OralRating[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: OralRating[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (!text(r.scenarioId) || !text(r.title) || !text(r.area)) continue;
    if (r.rating !== "Satisfactory" && r.rating !== "Needs work") continue;
    if (typeof r.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) continue;
    out.push({ scenarioId: r.scenarioId, title: r.title, rating: r.rating, area: r.area, date: r.date });
  }
  return out.length ? out.slice(-ORAL_RATING_CAP) : undefined;
}
