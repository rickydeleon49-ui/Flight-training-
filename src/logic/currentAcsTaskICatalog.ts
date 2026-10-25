/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation I (Preflight Preparation), Task I (Water and Seaplane Characteristics, Seaplane Bases, Maritime Rules, and Aids to Marine Navigation; ASES/AMES).
 *
 * Source: FAA-S-ACS-6C, printed pages 9–10 / PDF pages 17–18.
 *
 * This is an explicit partial slice limited to PA.I.I, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_TASK_I_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPages: "9–10",
  pdfPages: "17–18",
  areaOfOperation: "Area of Operation I: Preflight Preparation",
  task: "Task I. Water and Seaplane Characteristics, Seaplane Bases, Maritime Rules, and Aids to Marine Navigation",
  coverageLabel: "PA.I.I",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentTaskIAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "I";
  task: "I";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_TASK_I_SOURCE;
}

const currentTaskIEntries = [
  [
    "PA.I.I.K1",
    "The characteristics of a water surface as affected by features, such as:",
  ],
  ["PA.I.I.K1a", "Size and location"],
  ["PA.I.I.K1b", "Protected and unprotected areas"],
  ["PA.I.I.K1c", "Surface wind"],
  ["PA.I.I.K1d", "Direction and strength of water current"],
  ["PA.I.I.K1e", "Floating and partially submerged debris"],
  ["PA.I.I.K1f", "Sandbars, islands, and shoals"],
  ["PA.I.I.K1g", "Vessel traffic and wakes"],
  ["PA.I.I.K1h", "Other characteristics specific to the area"],
  ["PA.I.I.K1i", "Direction and height of waves"],
  [
    "PA.I.I.K2",
    "Float and hull construction, and its effect on seaplane performance.",
  ],
  [
    "PA.I.I.K3",
    "Causes of porpoising and skipping, and the pilot action needed to prevent or correct these occurrences.",
  ],
  [
    "PA.I.I.K4",
    "How to locate and identify seaplane bases on charts or in directories.",
  ],
  ["PA.I.I.K5", "Operating restrictions at various bases."],
  [
    "PA.I.I.K6",
    "Right-of-way, steering, and sailing rules pertinent to seaplane operation.",
  ],
  [
    "PA.I.I.K7",
    "Marine navigation aids, such as buoys, beacons, lights, sound signals, and range markers.",
  ],
  ["PA.I.I.K8", "Naval vessel protection zones."],
  ["PA.I.I.K9", "No wake zones."],
  ["PA.I.I.R1", "Local conditions."],
  ["PA.I.I.R2", "Impact of marine traffic."],
  [
    "PA.I.I.R3",
    "Right-of-way and sailing rules pertinent to seaplane operations.",
  ],
  [
    "PA.I.I.R4",
    "Limited services and assistance available at seaplane bases.",
  ],
  [
    "PA.I.I.S1",
    "Assess the water surface characteristics for the proposed flight.",
  ],
  ["PA.I.I.S2", "Identify restrictions at local seaplane bases."],
  ["PA.I.I.S3", "Identify marine navigation aids."],
  [
    "PA.I.I.S4",
    "Describe correct right-of-way, steering, and sailing operations.",
  ],
  [
    "PA.I.I.S5",
    "Explain how float and hull construction can affect seaplane performance.",
  ],
  ["PA.I.I.S6", "Describe how to correct for porpoising and skipping."],
] as const;

/** All 28 current PA.I.I codes from FAA-S-ACS-6C pages 9–10. */
export const CURRENT_PRIVATE_AIRPLANE_TASK_I_CODES: readonly CurrentTaskIAktrCode[] =
  currentTaskIEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "I",
    task: "I",
    source: PRIVATE_AIRPLANE_ACS_6C_TASK_I_SOURCE,
  }));

export type CurrentTaskICodeResolution =
  | { status: "current"; entry: CurrentTaskIAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.I.I slice.
 * Anything outside these 28 current entries remains unresolved.
 */
export function resolveCurrentTaskIAktrCode(code: string): CurrentTaskICodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_TASK_I_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry ? { status: "current", entry } : { status: "unresolved", code: normalized };
}
