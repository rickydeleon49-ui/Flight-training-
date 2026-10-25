/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation VIII (Basic Instrument Maneuvers), Task F (Radio Communications, Navigation Systems/Facilities, and Radar Services).
 *
 * Source: FAA-S-ACS-6C, printed pages 50–51 / PDF pages 57–58.
 *
 * This is an explicit partial slice limited to PA.VIII.F, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_AREA_VIII_TASK_F_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPages: "50–51",
  pdfPages: "57–58",
  areaOfOperation: "Area of Operation VIII: Basic Instrument Maneuvers",
  task: "Task F. Radio Communications, Navigation Systems/Facilities, and Radar Services",
  coverageLabel: "PA.VIII.F",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentAreaVIIITaskFAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "VIII";
  task: "F";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_AREA_VIII_TASK_F_SOURCE;
}

const currentAreaVIIITaskFEntries = [
  [
    "PA.VIII.F.K1",
    "Operating communications equipment, including identifying and selecting radio frequencies, requesting and following air traffic control (ATC) instructions.",
  ],
  [
    "PA.VIII.F.K2",
    "Operating navigation equipment, including functions and displays, and following bearings, radials, or courses.",
  ],
  ["PA.VIII.F.K3", "Air traffic control facilities and services."],
  [
    "PA.VIII.F.R1",
    "When to seek assistance or declare an emergency in a deteriorating situation.",
  ],
  [
    "PA.VIII.F.R2",
    "Using available resources (e.g., automation, ATC, and flight deck planning aids).",
  ],
  [
    "PA.VIII.F.S1",
    "Maintain airplane control while selecting proper communications frequencies, identifying the appropriate facility, and managing navigation equipment.",
  ],
  ["PA.VIII.F.S2", "Comply with ATC instructions."],
] as const;

/** All 7 current PA.VIII.F codes from FAA-S-ACS-6C pages 50–51. */
export const CURRENT_PRIVATE_AIRPLANE_AREA_VIII_TASK_F_CODES: readonly CurrentAreaVIIITaskFAktrCode[] =
  currentAreaVIIITaskFEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "VIII",
    task: "F",
    source: PRIVATE_AIRPLANE_ACS_6C_AREA_VIII_TASK_F_SOURCE,
  }));

export type CurrentAreaVIIITaskFCodeResolution =
  | { status: "current"; entry: CurrentAreaVIIITaskFAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.VIII.F slice.
 * Anything outside these 7 current entries remains unresolved.
 */
export function resolveCurrentAreaVIIITaskFAktrCode(
  code: string,
): CurrentAreaVIIITaskFCodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_AREA_VIII_TASK_F_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry ? { status: "current", entry } : { status: "unresolved", code: normalized };
}
