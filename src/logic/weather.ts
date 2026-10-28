/** Deterministic, deliberately partial weather formatting. No aviation decisions. */
export type WeatherProduct = "metar" | "taf";
export type Conditions = Record<string, unknown>;
export interface WeatherReport {
  station: string; name: string | null; raw: string; reportTime: number | null;
  validFrom: number | null; validTo: number | null; unavailable: boolean;
  conditions: Conditions; periods: Conditions[];
}
export const WEATHER_NOTE = "For lesson preparation. Check official sources and your instructor.";
export const WEATHER_SOURCE = "NOAA/NWS Aviation Weather Center";
export const WEATHER_SOURCE_URL = "https://aviationweather.gov/data/api/";
export const PARTIAL = "Some details are only in the original report.";
export function normalizeIcao(input: string): string | null {
  const code = input.trim().toUpperCase();
  return !/[\u0000-\u001f\u007f-\u009f]/.test(input) && /^[A-Za-z]{4}$/.test(input.trim()) && /^[A-Z]{4}$/.test(code) ? code : null;
}
const number = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
export function conditionsSummary(c: Conditions): string {
  const parts: string[] = [];
  if (number(c.wspd, 0, 300)) {
    if (c.wspd === 0 && c.wdir === 0) parts.push("Wind calm.");
    else if (c.wdir === "VRB") parts.push(`Wind direction variable at ${c.wspd} knots${number(c.wgst, c.wspd, 400) ? `, gusting to ${c.wgst}` : ""}.`);
    else if (number(c.wdir, 0, 360)) parts.push(`Wind from ${c.wdir}° at ${c.wspd} knots${number(c.wgst, c.wspd, 400) ? `, gusting to ${c.wgst}` : ""}.`);
    else parts.push("Wind direction not reported.");
  } else parts.push("Wind not reported.");
  const visibility = c.visib;
  if (number(visibility, 0, 100)) parts.push(`Visibility ${visibility} statute miles.`);
  else if (typeof visibility === "string" && /^(?:\d+(?:\.\d+)?|\d+\/\d+|\d+ \d+\/\d+)\+?$/.test(visibility)) {
    const numeric = visibility.replace(/\+$/, "");
    if (!numeric.includes("/0")) parts.push(`Visibility ${visibility.endsWith("+") ? "greater than " : ""}${numeric} statute miles.`);
  } else parts.push("Visibility not reported in the summary.");
  const cloudNames: Record<string, string> = { FEW: "Few clouds", SCT: "Scattered clouds", BKN: "Broken clouds", OVC: "Overcast" };
  if (Array.isArray(c.clouds)) for (const layer of c.clouds) {
    if (layer && typeof layer === "object") {
      const { cover, base } = layer as Conditions;
      if (typeof cover === "string" && cloudNames[cover]) parts.push(`${cloudNames[cover]}${number(base, 0, 100000) ? ` at ${base} feet` : "; base not reported"}.`);
    }
  }
  if (number(c.vertVis, 0, 100000)) parts.push(`Vertical visibility ${c.vertVis} feet.`);
  if (number(c.temp, -100, 70)) parts.push(`Temperature ${c.temp}°C.`);
  if (number(c.altim, 800, 1100)) parts.push(`Altimeter ${c.altim} hPa.`);
  return [...parts, PARTIAL].join(" ");
}
export function periodLabel(c: Conditions): string {
  const labels: Record<string, string> = { FM: "From (FM)", TEMPO: "Temporary (TEMPO)", BECMG: "Becoming (BECMG)", PROB: "Probability (PROB)", PROB30: "30% probability (PROB30)", PROB40: "40% probability (PROB40)" };
  const change = c.fcstChange;
  const probability = c.probability;
  const label = change == null || change === "" ? "Forecast period" : typeof change === "string" ? labels[change] : undefined;
  if (!label) return "Period details are only in the original report.";
  return `${label}${probability === 30 || probability === 40 ? ` · ${probability}% probability` : ""}`;
}
export function timeText(value: number | null, zone?: string): string {
  if (value === null) return "Time not reported";
  if (!Number.isFinite(value) || Math.abs(value) > 8.64e15) return "Time couldn't be checked";
  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23", timeZone: zone ?? "UTC", timeZoneName: "short",
  }).format(value);
}
export function localTimeText(value: number | null, zone?: string): string {
  return `Local: ${timeText(value, zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone)}`;
}
export function elapsedText(ms: number): string {
  if (ms < 60_000) return "less than a minute";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}
export function weatherAges(report: WeatherReport, product: WeatherProduct, fetchedAt: number, now: number, confident: boolean): string[] {
  const labels: string[] = [];
  const reportAge = report.reportTime === null ? null : now - report.reportTime;
  if (!confident || reportAge === null || reportAge < 0) labels.push("Report time couldn't be checked");
  else {
    labels.push(`${product === "metar" ? "Observation" : "Issue"} age: ${elapsedText(reportAge)}`);
    if (reportAge > (product === "metar" ? 90 * 60_000 : 6 * 3600_000)) labels.push(product === "metar" ? "Older observation" : "Older forecast");
  }
  const fetchAge = now - fetchedAt;
  if (!confident || fetchAge < 0) labels.push("Last check time couldn't be checked");
  else {
    labels.push(`Last checked ${elapsedText(fetchAge)} ago`);
    if (fetchAge > 15 * 60_000) labels.push("Last check is old");
  }
  if (product === "taf" && confident && report.validFrom !== null && report.validTo !== null) {
    if (now < report.validFrom) labels.push(`Forecast starts ${timeText(report.validFrom)}`);
    else if (now >= report.validTo) labels.push("Forecast has ended");
  }
  return labels;
}
export function clockIsConsistent(wall: number, mono: number, beforeWall: number, beforeMono: number): boolean {
  return mono >= beforeMono && Math.abs((wall - beforeWall) - (mono - beforeMono)) <= 5000;
}
