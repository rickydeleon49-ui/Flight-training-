/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation I (Preflight Preparation), Task H (Human Factors).
 *
 * Source: FAA-S-ACS-6C, printed page 8 / PDF page 16.
 *
 * This is an explicit partial slice limited to PA.I.H, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_TASK_H_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPages: "8",
  pdfPages: "16",
  areaOfOperation: "Area of Operation I: Preflight Preparation",
  task: "Task H. Human Factors",
  coverageLabel: "PA.I.H",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentTaskHAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "I";
  task: "H";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_TASK_H_SOURCE;
}

const currentTaskHEntries = [
  [
    "PA.I.H.K1",
    "Symptoms, recognition, causes, effects, and corrective actions associated with aeromedical and physiological issues, including:",
  ],
  ["PA.I.H.K1a", "Hypoxia"],
  ["PA.I.H.K1b", "Hyperventilation"],
  ["PA.I.H.K1c", "Middle ear and sinus problems"],
  ["PA.I.H.K1d", "Spatial disorientation"],
  ["PA.I.H.K1e", "Motion sickness"],
  ["PA.I.H.K1f", "Carbon monoxide poisoning"],
  ["PA.I.H.K1g", "Stress"],
  ["PA.I.H.K1h", "Fatigue"],
  ["PA.I.H.K1i", "Dehydration and nutrition"],
  ["PA.I.H.K1j", "Hypothermia"],
  ["PA.I.H.K1k", "Optical illusions"],
  ["PA.I.H.K1l", "Dissolved nitrogen in the bloodstream after scuba dives"],
  ["PA.I.H.K2", "Regulations regarding use of alcohol and drugs."],
  ["PA.I.H.K3", "Effects of alcohol, drugs, and over-the-counter medications."],
  [
    "PA.I.H.K4",
    "Aeronautical Decision-Making (ADM) to include using Crew Resource Management (CRM) or Single-Pilot Resource Management (SRM), as appropriate.",
  ],
  ["PA.I.H.R1", "Aeromedical and physiological issues."],
  ["PA.I.H.R2", "Hazardous attitudes."],
  ["PA.I.H.R3", "Distractions, task prioritization, loss of situational awareness, or disorientation."],
  ["PA.I.H.R4", "Confirmation and expectation bias."],
  [
    "PA.I.H.S1",
    "Associate the symptoms and effects for at least three of the conditions listed in K1a through K1l with the cause(s) and corrective action(s).",
  ],
  [
    "PA.I.H.S2",
    "Perform self-assessment, including fitness for flight and personal minimums, for actual flight or a scenario given by the evaluator.",
  ],
] as const;

/** All 22 current PA.I.H codes from FAA-S-ACS-6C page 8. */
export const CURRENT_PRIVATE_AIRPLANE_TASK_H_CODES: readonly CurrentTaskHAktrCode[] =
  currentTaskHEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "I",
    task: "H",
    source: PRIVATE_AIRPLANE_ACS_6C_TASK_H_SOURCE,
  }));

export type CurrentTaskHCodeResolution =
  | { status: "current"; entry: CurrentTaskHAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.I.H slice.
 * Anything outside these 22 current entries remains unresolved.
 */
export function resolveCurrentTaskHAktrCode(code: string): CurrentTaskHCodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_TASK_H_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry ? { status: "current", entry } : { status: "unresolved", code: normalized };
}
