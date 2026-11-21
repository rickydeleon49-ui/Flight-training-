/**
 * BL-80: FAA knowledge test figures bundled with the app as cropped WebP files in
 * `src/assets/figures/`. This file is only the list; every figure carries its credit.
 */
export const FAA_EDITION = "FAA-CT-8080-2H (2018)";

export type FaaFigure = {
  /** "faa-49", stable. */
  id: string;
  /** The real figure number in the FAA supplement. */
  faaNumber: number;
  title: string;
  /** One plain sentence saying what the figure shows. */
  alt: string;
  /** File name inside src/assets/figures. */
  file: string;
  edition: "FAA-CT-8080-2H (2018)";
  width: number;
  height: number;
  /** Image pixels per nautical mile, measured from the scale bar printed on this figure. Only set when measured; the ruler needs it. */
  pxPerNm?: number;
};

function f(faaNumber: number, title: string, alt: string, width: number, height: number): FaaFigure {
  return { id: `faa-${faaNumber}`, faaNumber, title, alt, file: `faa-${faaNumber}.webp`, edition: FAA_EDITION, width, height };
}

export const FAA_FIGURES: FaaFigure[] = [
  f(2, "Load factor chart", "Table and graph showing how the load factor grows as the bank angle increases", 1341, 1033),
  f(4, "Airspeed indicator", "Airspeed indicator in knots with white, green, yellow and red markings around the dial", 1345, 1062),
  f(5, "Turn coordinator", "Turn coordinator dial with a small airplane symbol, left and right turn marks, a ball in a curved tube and the label 2 MIN", 1346, 1057),
  f(6, "Heading indicator", "Heading indicator dial showing compass headings around the circle with a small airplane symbol in the center", 1345, 1058),
  f(8, "Density altitude chart", "Chart for finding density altitude from pressure altitude and temperature", 1334, 1361),
  f(12, "METAR reports", "Five coded METAR and SPECI weather reports for airports, one per row", 1334, 360),
  f(15, "Terminal aerodrome forecasts (TAF)", "Coded terminal aerodrome forecasts for several airports", 1344, 555),
  f(17, "Winds and temperatures aloft forecast", "Table of forecast winds and temperatures aloft at several altitudes and stations", 1334, 403),
  f(28, "VOR indicators", "Nine VOR indicator faces, numbered 1 to 9, each showing the selected course and the needle, most with a TO or FROM flag", 1304, 1251),
  f(34, "Airplane weight and balance graphs", "Loading graph of weight against moment, and a graph of the loaded airplane's weight and moment limits", 1334, 1766),
  f(36, "Crosswind component graph", "Graph for finding the crosswind and headwind parts of a wind from its angle and speed", 1334, 1165),
  f(37, "Airplane landing distance graph", "Graph for finding landing distance from altitude, temperature, weight and wind", 1093, 1794),
  f(40, "Airplane takeoff distance graph", "Graph for finding takeoff distance from temperature, altitude, weight, wind and obstacle height, with a worked example and a speed table", 1795, 1044),
  f(47, "VASI illustrations", "Visual approach slope indicator light patterns for too high, on glidepath and too low", 1334, 1489),
  f(48, "Airport diagram", "Airport diagram with runways, taxiways and the control tower", 1332, 1534),
  f(49, "Airport diagram", "Airport diagram with two crossing runways, taxiways and the control tower", 1335, 1198),
  f(50, "Wind sock airport landing indicator", "Drawing of a wind sock on a pole in the middle of a dashed segmented circle, with four L-shaped markers around it, a north arrow and the wind cone labeled", 1336, 1198),
  f(58, "Compass card", "Compass card showing headings around the circle", 1354, 342),
  f(64, "Airport markings", "Runway and taxiway pavement markings, with their names", 1334, 1431),
  f(65, "U.S. airport signs", "Airport signs and their meanings, such as mandatory, direction and location signs", 1244, 1756),
  f(68, "Wind triangle", "Wind triangle with an airplane flying from point A to point B in a wind", 957, 1785),
];

export function getFigure(id: string): FaaFigure | undefined {
  return FAA_FIGURES.find((x) => x.id === id);
}

export function figureCredit(fig: FaaFigure): string {
  return `${fig.edition}, Figure ${fig.faaNumber}`;
}

export function figureUrl(fig: FaaFigure): string {
  return new URL(`../assets/figures/${fig.file}`, import.meta.url).href;
}
