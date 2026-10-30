/**
 * A quiet study aid for the flight log: when a flight's date and airport are
 * known, when did the sun set there, when did night begin (end of evening
 * civil twilight, 14 CFR 1.1) and from when do landings count toward night
 * currency (one hour after sunset, 14 CFR 61.57(b))?
 *
 * Pure apart from `loadAirportIndex`, which fetches the airport table with a
 * dynamic import so it stays out of the main bundle. Nothing here reads or
 * writes her data.
 */
import { getTimes } from "suncalc";

export interface Airport {
  lat: number;
  lon: number;
}

/** Codes (uppercase) to airports. Several codes can point at one airport (KPAO, PAO). */
export type AirportIndex = ReadonlyMap<string, Airport>;

export interface NightHint {
  /** The code as she typed it, trimmed and uppercased. */
  code: string;
  sunset: Date;
  /** End of evening civil twilight: night begins (14 CFR 1.1). */
  nightBegins: Date;
  /** Sunset + 1 hour: night landings for currency count from here (14 CFR 61.57(b)). */
  currencyLandingsFrom: Date;
}

interface AirportCoordsFile {
  rows: string[];
}

/** Parses the compact rows of src/data/airportCoords.json ("CODES|lat|lon"). */
export function buildAirportIndex(file: AirportCoordsFile): AirportIndex {
  const index = new Map<string, Airport>();
  for (const row of file.rows) {
    const [codes, lat, lon] = row.split("|");
    const airport = { lat: Number(lat), lon: Number(lon) };
    if (!Number.isFinite(airport.lat) || !Number.isFinite(airport.lon)) continue;
    for (const code of (codes ?? "").split(" ")) {
      if (code && !index.has(code)) index.set(code, airport);
    }
  }
  return index;
}

let loading: Promise<AirportIndex> | null = null;

/** Loads the airport table once, on first use. */
export function loadAirportIndex(): Promise<AirportIndex> {
  loading ??= import("@/data/airportCoords.json")
    .then((module) => buildAirportIndex(module.default as AirportCoordsFile))
    .catch((error: unknown) => {
      loading = null;
      throw error;
    });
  return loading;
}

const HOUR_MS = 60 * 60 * 1000;

function parseIsoDate(value: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return { y, m, d };
}

/**
 * Sun times at `code` on `date` (YYYY-MM-DD), or null when the date or airport
 * is unknown, or when the sun doesn't set or twilight doesn't end that day
 * (far north in summer or winter): better no hint than a wrong one.
 */
export function nightHint(date: string, code: string, airports: AirportIndex): NightHint | null {
  const day = parseIsoDate(date);
  const key = code.trim().toUpperCase();
  const airport = key ? airports.get(key) : undefined;
  if (!day || !airport) return null;
  // Anchor on local solar noon at the airport, so the evening belongs to the
  // flight's own date wherever the Mac happens to be.
  const solarNoon = Date.UTC(day.y, day.m - 1, day.d, 12) - (airport.lon / 15) * HOUR_MS;
  const times = getTimes(new Date(solarNoon), airport.lat, airport.lon);
  const sunset = times.sunset;
  const nightBegins = times.dusk;
  if (!sunset || !nightBegins || Number.isNaN(sunset.getTime()) || Number.isNaN(nightBegins.getTime())) {
    return null;
  }
  if (nightBegins.getTime() <= sunset.getTime()) return null;
  return {
    code: key,
    sunset,
    nightBegins,
    currencyLandingsFrom: new Date(sunset.getTime() + HOUR_MS),
  };
}

/** "4:58 PM" in the Mac's time zone (or `timeZone`, for tests). */
export function formatHintTime(value: Date, timeZone?: string): string {
  return value.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone });
}

/** The one quiet line shown under Night flight time. */
export function nightHintText(hint: NightHint, date: string, timeZone?: string): string {
  const day = parseIsoDate(date);
  const label = day
    ? new Date(Date.UTC(day.y, day.m - 1, day.d)).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      })
    : date;
  const t = (value: Date) => formatHintTime(value, timeZone);
  return (
    `${hint.code}, ${label}: sunset ${t(hint.sunset)}. ` +
    `Night from ${t(hint.nightBegins)}; night landings count from ${t(hint.currencyLandingsFrom)} (your Mac's time).`
  );
}
