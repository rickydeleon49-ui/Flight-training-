import type { SavedNavLeg, SavedNavLog } from "@/domain/types";

export const NAV_LOG_CAP = 10;
export const NAV_LEG_CAP = 12;

const NUMBER_KEYS = ["tc", "distanceNm", "tas", "windDir", "windSpeed", "variation", "deviation", "gph"] as const;

function normalizeLeg(value: unknown): SavedNavLeg | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  if (r.side !== "E" && r.side !== "W") return null;
  const leg: Record<string, unknown> = { side: r.side };
  for (const key of NUMBER_KEYS) {
    if (typeof r[key] !== "number" || !Number.isFinite(r[key])) return null;
    leg[key] = r[key];
  }
  return leg as unknown as SavedNavLeg;
}

export function normalizeNavLogs(value: unknown): SavedNavLog[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: SavedNavLog[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (typeof r.id !== "string" || !r.id || typeof r.name !== "string") continue;
    const reserve = Number(r.reserveMinutes);
    out.push({
      id: r.id,
      name: r.name,
      aircraft: typeof r.aircraft === "string" ? r.aircraft : "",
      reserveMinutes: Number.isFinite(reserve) ? Math.max(0, reserve) : 0,
      legs: (Array.isArray(r.legs) ? r.legs : [])
        .map(normalizeLeg)
        .filter((leg): leg is SavedNavLeg => leg !== null)
        .slice(0, NAV_LEG_CAP),
    });
    if (out.length >= NAV_LOG_CAP) break;
  }
  return out.length ? out : undefined;
}
