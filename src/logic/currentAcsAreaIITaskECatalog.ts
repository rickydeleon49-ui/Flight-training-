/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation II (Preflight Procedures), Task E (Taxiing and Sailing, ASES/AMES).
 *
 * Source: FAA-S-ACS-6C, printed page 14 / PDF page 22.
 *
 * This is an explicit partial slice limited to PA.II.E, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_AREA_II_TASK_E_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPage: 14,
  pdfPage: 22,
  areaOfOperation: "Area of Operation II: Preflight Procedures",
  task: "Task E. Taxiing and Sailing (ASES, AMES)",
  coverageLabel: "PA.II.E",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentAreaIITaskEAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "II";
  task: "E";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_AREA_II_TASK_E_SOURCE;
}

const currentAreaIITaskEEntries = [
  [
    "PA.II.E.K1",
    "Airport information resources, including Chart Supplements, airport diagram, and appropriate references.",
  ],
  ["PA.II.E.K2", "Taxi instructions/clearances."],
  ["PA.II.E.K3", "Airport/seaplane base markings, signs, and lights."],
  ["PA.II.E.K4", "Visual indicators for wind."],
  ["PA.II.E.K5", "Airplane lighting."],
  ["PA.II.E.K6", "Procedures for:"],
  [
    "PA.II.E.K6a",
    "Appropriate flight deck activities during taxiing or sailing",
  ],
  [
    "PA.II.E.K6b",
    "Radio communications at towered and nontowered seaplane bases",
  ],
  ["PA.II.E.R1", "Activities and distractions."],
  ["PA.II.E.R2", "Porpoising and skipping."],
  ["PA.II.E.R3", "Low visibility taxi and sailing operations."],
  ["PA.II.E.R4", "Other aircraft, vessels, and hazards."],
  [
    "PA.II.E.R5",
    "Confirmation or expectation bias as related to taxi instructions.",
  ],
  [
    "PA.II.E.S1",
    "Receive and correctly read back clearances/instructions, if applicable.",
  ],
  [
    "PA.II.E.S2",
    "Use an appropriate airport diagram or taxi chart, if published.",
  ],
  [
    "PA.II.E.S3",
    "Comply with seaplane base/airport/taxiway markings, signals, and signs.",
  ],
  [
    "PA.II.E.S4",
    "Depart the dock/mooring buoy or beach/ramp in a safe manner, considering wind, current, traffic, and hazards.",
  ],
  ["PA.II.E.S5", "Complete the appropriate checklist(s)."],
  [
    "PA.II.E.S6",
    "Position the flight controls, flaps, doors, water rudders, and power correctly for the existing conditions to follow the desired course while sailing and to prevent or correct for porpoising and skipping during step taxi.",
  ],
  [
    "PA.II.E.S7",
    "Exhibit procedures for steering and maneuvering while maintaining proper situational awareness and desired orientation, path, and position while taxiing using idle, plow, or step taxi technique, as appropriate.",
  ],
  [
    "PA.II.E.S8",
    "Plan and follow the most favorable taxi or sailing course for current conditions.",
  ],
] as const;

/** All 21 current PA.II.E codes from FAA-S-ACS-6C page 14. */
export const CURRENT_PRIVATE_AIRPLANE_AREA_II_TASK_E_CODES: readonly CurrentAreaIITaskEAktrCode[] =
  currentAreaIITaskEEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "II",
    task: "E",
    source: PRIVATE_AIRPLANE_ACS_6C_AREA_II_TASK_E_SOURCE,
  }));

export type CurrentAreaIITaskECodeResolution =
  | { status: "current"; entry: CurrentAreaIITaskEAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.II.E slice.
 * Anything outside these 21 current entries remains unresolved.
 */
export function resolveCurrentAreaIITaskEAktrCode(code: string): CurrentAreaIITaskECodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_AREA_II_TASK_E_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry ? { status: "current", entry } : { status: "unresolved", code: normalized };
}
