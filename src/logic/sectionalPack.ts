import { FAA_EDITION, type FaaFigure } from "./figures";

/**
 * BL-80: the optional sectional chart pack. The WebP files are not bundled; the app downloads
 * the zip from a GitHub Release (HTTPS) and checks it against the pinned SHA-256 below.
 */
function s(faaNumber: number, alt: string, width: number, height: number): FaaFigure {
  return { id: `faa-${faaNumber}`, faaNumber, title: "Sectional chart excerpt", alt, file: `faa-${faaNumber}.webp`, edition: FAA_EDITION, width, height };
}

export const SECTIONAL_PACK = {
  id: "sectionals-v1",
  url: "https://github.com/rickydeleon49-ui/Flight-training-/releases/download/sectional-pack-v1/sectionals-v1.zip",
  sha256: "266d704ffb199e80b96fadd842c26048d478c2a5e9bb69b2cc6ceb2a04d63637",
  bytes: 3656722,
  figures: [
    s(20, "Sectional chart excerpt of the Norfolk, Virginia area with a Class C airport, warning areas over the ocean and numbered red dots", 1414, 1974),
    s(21, "Sectional chart excerpt of north central North Dakota around Minot with small airports, a military operations area and numbered red dots", 1414, 1974),
    s(22, "Sectional chart excerpt of northern Idaho around Sandpoint and Coeur d'Alene with shaded terrain, airways and numbered red dots", 1414, 1981),
    s(26, "Sectional chart excerpt of eastern North Dakota around Jamestown with restricted areas, a military operations area and numbered red dots", 1414, 1980),
    s(59, "Sectional chart excerpt of northwest Ohio around Toledo with a Class C airport, VORs, many airports and numbered red dots", 1414, 1984),
    s(69, "Sectional chart excerpt of the Corpus Christi, Texas area with a Class C airport, an alert area, military operations areas and numbered red dots", 1414, 1971),
  ] as FaaFigure[],
} as const;

export function getSectionalFigure(id: string): FaaFigure | undefined {
  return SECTIONAL_PACK.figures.find((x) => x.id === id);
}
