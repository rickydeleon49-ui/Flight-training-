/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation II (Preflight Procedures), Task B (Flight Deck Management).
 *
 * Source: FAA-S-ACS-6C, printed page 12 / PDF page 20.
 *
 * This is an explicit partial slice limited to PA.II.B, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_AREA_II_TASK_B_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPage: 12,
  pdfPage: 20,
  areaOfOperation: "Area of Operation II: Preflight Procedures",
  task: "Task B. Flight Deck Management",
  coverageLabel: "PA.II.B",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentAreaIITaskBAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "II";
  task: "B";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_AREA_II_TASK_B_SOURCE;
}

const currentAreaIITaskBEntries = [
  ["PA.II.B.K1", "Passenger briefing requirements, including operation and required use of safety restraint systems."],
  ["PA.II.B.K2", "Use of appropriate checklists."],
  ["PA.II.B.K3", "Requirements for current and appropriate navigation data."],
  ["PA.II.B.K4", "Securing items and cargo."],
  ["PA.II.B.R1", "Use of systems or equipment, including automation and portable electronic devices."],
  ["PA.II.B.R2", "Inoperative equipment."],
  ["PA.II.B.R3", "Passenger distractions."],
  ["PA.II.B.S1", "Secure all items in the aircraft."],
  ["PA.II.B.S2", "Conduct an appropriate passenger briefing, including identifying the pilot-in-command (PIC), use of safety belts, shoulder harnesses, doors, passenger conduct, sterile aircraft, propeller blade avoidance, and emergency procedures."],
  ["PA.II.B.S3", "Properly program and manage the aircraft’s automation, as applicable."],
  ["PA.II.B.S4", "Appropriately manage risks by utilizing ADM, including SRM/CRM."],
] as const;

/** All 11 current PA.II.B codes from FAA-S-ACS-6C page 12. */
export const CURRENT_PRIVATE_AIRPLANE_AREA_II_TASK_B_CODES: readonly CurrentAreaIITaskBAktrCode[] =
  currentAreaIITaskBEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "II",
    task: "B",
    source: PRIVATE_AIRPLANE_ACS_6C_AREA_II_TASK_B_SOURCE,
  }));

export type CurrentAreaIITaskBCodeResolution =
  | { status: "current"; entry: CurrentAreaIITaskBAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.II.B slice.
 * Anything outside these 11 current entries remains unresolved.
 */
export function resolveCurrentAreaIITaskBAktrCode(code: string): CurrentAreaIITaskBCodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_AREA_II_TASK_B_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry ? { status: "current", entry } : { status: "unresolved", code: normalized };
}
