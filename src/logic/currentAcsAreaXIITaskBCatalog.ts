/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation XII (Postflight Procedures), Task B (Seaplane Post-Landing Procedures).
 *
 * Source: FAA-S-ACS-6C, printed pages 64–65 / PDF pages 72–73.
 *
 * This is an explicit partial slice limited to PA.XII.B, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_AREA_XII_TASK_B_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPages: "64–65",
  pdfPages: "72–73",
  areaOfOperation: "Area of Operation XII: Postflight Procedures",
  task: "Task B. Seaplane Post-Landing Procedures",
  coverageLabel: "PA.XII.B",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentAreaXIITaskBAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "XII";
  task: "B";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_AREA_XII_TASK_B_SOURCE;
}

const currentAreaXIITaskBEntries = [
  [
    "PA.XII.B.K1",
    "Mooring.",
  ],
  [
    "PA.XII.B.K2",
    "Docking.",
  ],
  [
    "PA.XII.B.K3",
    "Anchoring.",
  ],
  [
    "PA.XII.B.K4",
    "Beaching/ramping.",
  ],
  [
    "PA.XII.B.K5",
    "Postflight inspection, recording of in-flight/postflight discrepancies.",
  ],
  [
    "PA.XII.B.R1",
    "Activities and distractions.",
  ],
  [
    "PA.XII.B.R3",
    "Seaplane base specific security procedures, if applicable.",
  ],
  [
    "PA.XII.B.R4",
    "Disembarking passengers safely on the ramp and monitoring passenger movement while on the ramp.",
  ],
  [
    "PA.XII.B.S1",
    "If anchoring, select a suitable area considering seaplane movement, water depth, tide, wind, and weather changes. Use an adequate number of anchors and lines of sufficient strength and length to ensure the seaplane’s security.",
  ],
  [
    "PA.XII.B.S2",
    "If not anchoring, approach the dock/mooring buoy or beach/ramp in the proper direction and at a safe speed, considering water depth, tide, current, and wind.",
  ],
  [
    "PA.XII.B.S3",
    "Complete the appropriate checklist(s).",
  ],
  [
    "PA.XII.B.S4",
    "Conduct a postflight inspection and document discrepancies and servicing requirements, if any.",
  ],
  [
    "PA.XII.B.S5",
    "Secure the seaplane considering the effect of wind, waves, and changes in water level, or comply with applicable after landing, parking, and securing procedures if operating an amphibious airplane on land.",
  ],
] as const;

/** All 13 current PA.XII.B codes from FAA-S-ACS-6C pages 64–65. */
export const CURRENT_PRIVATE_AIRPLANE_AREA_XII_TASK_B_CODES: readonly CurrentAreaXIITaskBAktrCode[] =
  currentAreaXIITaskBEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "XII",
    task: "B",
    source: PRIVATE_AIRPLANE_ACS_6C_AREA_XII_TASK_B_SOURCE,
  }));

export type CurrentAreaXIITaskBCodeResolution =
  | { status: "current"; entry: CurrentAreaXIITaskBAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.XII.B slice.
 * Anything outside these 13 current entries remains unresolved.
 */
export function resolveCurrentAreaXIITaskBAktrCode(
  code: string,
): CurrentAreaXIITaskBCodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_AREA_XII_TASK_B_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry ? { status: "current", entry } : { status: "unresolved", code: normalized };
}
