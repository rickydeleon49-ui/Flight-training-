/** Study-aid arithmetic for crosswind and density altitude. Not for flight planning. */

export type WindComponents = {
  crosswind: number;
  headwind: number;
  side: "left" | "right" | "none";
};

const finite = (n: number) => typeof n === "number" && Number.isFinite(n);

function norm360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/**
 * Runway number 1-36 (x10 degrees) or degrees 37-360. Returns the heading in
 * degrees, or null when invalid.
 */
export function runwayHeading(value: number): number | null {
  if (!finite(value) || value <= 0 || value > 360) return null;
  return value <= 36 ? value * 10 : value;
}

/** Crosswind and headwind in knots, rounded to whole knots. A tailwind is a negative headwind. */
export function windComponents(
  runway: number,
  windDirection: number,
  windSpeed: number,
): WindComponents | null {
  const heading = runwayHeading(runway);
  if (heading === null) return null;
  if (!finite(windDirection) || windDirection < 0 || windDirection > 360) return null;
  if (!finite(windSpeed) || windSpeed < 0) return null;
  const angle = (norm360(windDirection - heading) * Math.PI) / 180;
  const rawCross = windSpeed * Math.sin(angle);
  const crosswind = Math.round(Math.abs(rawCross));
  const headwind = Math.round(windSpeed * Math.cos(angle)) + 0;
  // Positive sin: wind comes from the right of the runway heading.
  const side = crosswind === 0 ? "none" : rawCross > 0 ? "right" : "left";
  return { crosswind, headwind: headwind === 0 ? 0 : headwind, side };
}

export function pressureAltitude(elevationFt: number, altimeterInHg: number): number | null {
  if (!finite(elevationFt) || !finite(altimeterInHg)) return null;
  if (altimeterInHg < 25 || altimeterInHg > 32) return null;
  return Math.round(elevationFt + (29.92 - altimeterInHg) * 1000);
}

export function isaTemperatureC(pressureAltitudeFt: number): number {
  return 15 - 2 * (pressureAltitudeFt / 1000);
}

export type DensityResult = { pressureAltitude: number; isaTemp: number; densityAltitude: number };

/** Density altitude by the PHAK rule of thumb: PA + 120 x (OAT - ISA), rounded to 10 ft. */
export function densityAltitude(
  elevationFt: number,
  altimeterInHg: number,
  oatC: number,
): DensityResult | null {
  const pa = pressureAltitude(elevationFt, altimeterInHg);
  if (pa === null || !finite(oatC) || oatC < -80 || oatC > 70) return null;
  const isaTemp = isaTemperatureC(pa);
  const da = Math.round((pa + 120 * (oatC - isaTemp)) / 10) * 10;
  return { pressureAltitude: pa, isaTemp: Math.round(isaTemp * 10) / 10, densityAltitude: da };
}
