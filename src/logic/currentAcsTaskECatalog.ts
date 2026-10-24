/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation I (Preflight Preparation), Task E (National Airspace System).
 *
 * Source: FAA-S-ACS-6C, printed page 6 / PDF page 14.
 *
 * This is an explicit partial slice limited to PA.I.E, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_TASK_E_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPages: "6",
  pdfPages: "14",
  areaOfOperation: "Area of Operation I: Preflight Preparation",
  task: "Task E. National Airspace System",
  coverageLabel: "PA.I.E",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentTaskEAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "I";
  task: "E";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_TASK_E_SOURCE;
}

const currentTaskEEntries = [
  ["PA.I.E.K1", "Airspace classes and associated requirements and limitations."],
  ["PA.I.E.K2", "Chart symbols."],
  ["PA.I.E.K3", "Special use airspace (SUA), special flight rules areas (SFRA), temporary flight restrictions (TFR), and other airspace areas."],
  ["PA.I.E.K4", "Special visual flight rules (VFR) requirements."],
  ["PA.I.E.R1", "Various classes and types of airspace."],
  ["PA.I.E.S1", "Identify and comply with the requirements for basic VFR weather minimums and flying in particular classes of airspace."],
  ["PA.I.E.S2", "Correctly identify airspace and operate in accordance with associated communication and equipment requirements."],
  ["PA.I.E.S3", "Identify the requirements for operating in SUA or within a TFR. Identify and comply with special air traffic rules (SATR) and SFRA operations, if applicable."],
] as const;

/** All 8 current PA.I.E codes from FAA-S-ACS-6C page 6. */
export const CURRENT_PRIVATE_AIRPLANE_TASK_E_CODES: readonly CurrentTaskEAktrCode[] =
  currentTaskEEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "I",
    task: "E",
    source: PRIVATE_AIRPLANE_ACS_6C_TASK_E_SOURCE,
  }));

export type CurrentTaskECodeResolution =
  | { status: "current"; entry: CurrentTaskEAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.I.E slice.
 * Anything outside these 8 current entries remains unresolved.
 */
export function resolveCurrentTaskEAktrCode(code: string): CurrentTaskECodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_TASK_E_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry ? { status: "current", entry } : { status: "unresolved", code: normalized };
}
