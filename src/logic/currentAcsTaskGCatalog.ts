/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation I (Preflight Preparation), Task G (Operation of Systems).
 *
 * Source: FAA-S-ACS-6C, printed page 7 / PDF page 15.
 *
 * This is an explicit partial slice limited to PA.I.G, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_TASK_G_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPages: "7",
  pdfPages: "15",
  areaOfOperation: "Area of Operation I: Preflight Preparation",
  task: "Task G. Operation of Systems",
  coverageLabel: "PA.I.G",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentTaskGAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "I";
  task: "G";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_TASK_G_SOURCE;
}

const currentTaskGEntries = [
  ["PA.I.G.K1", "Airplane systems, including:"],
  ["PA.I.G.K1a", "Primary flight controls"],
  ["PA.I.G.K1b", "Secondary flight controls"],
  ["PA.I.G.K1c", "Powerplant and propeller"],
  ["PA.I.G.K1d", "Landing gear"],
  ["PA.I.G.K1e", "Fuel, oil, and hydraulic"],
  ["PA.I.G.K1f", "Electrical"],
  ["PA.I.G.K1g", "Avionics"],
  ["PA.I.G.K1h", "Pitot-static, vacuum/pressure, and associated flight instruments"],
  ["PA.I.G.K1i", "Environmental"],
  ["PA.I.G.K1j", "Deicing and anti-icing"],
  ["PA.I.G.K1k", "Water rudders (ASES, AMES)"],
  ["PA.I.G.K1l", "Oxygen system"],
  ["PA.I.G.K2", "Indications of and procedures for managing system abnormalities or failures."],
  ["PA.I.G.R1", "Detection of system malfunctions or failures."],
  ["PA.I.G.R2", "Management of a system failure."],
  ["PA.I.G.R3", "Monitoring and management of automated systems."],
  ["PA.I.G.S1", "Operate at least three of the systems listed in K1a through K1l appropriately."],
  ["PA.I.G.S2", "Complete the appropriate checklist(s)."],
] as const;

/** All 19 current PA.I.G codes from FAA-S-ACS-6C page 7. */
export const CURRENT_PRIVATE_AIRPLANE_TASK_G_CODES: readonly CurrentTaskGAktrCode[] =
  currentTaskGEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "I",
    task: "G",
    source: PRIVATE_AIRPLANE_ACS_6C_TASK_G_SOURCE,
  }));

export type CurrentTaskGCodeResolution =
  | { status: "current"; entry: CurrentTaskGAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.I.G slice.
 * Anything outside these 19 current entries remains unresolved.
 */
export function resolveCurrentTaskGAktrCode(code: string): CurrentTaskGCodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_TASK_G_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry ? { status: "current", entry } : { status: "unresolved", code: normalized };
}
