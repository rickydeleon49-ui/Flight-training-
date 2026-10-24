/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation VIII (Basic Instrument Maneuvers), Task E (Recovery from Unusual Flight Attitudes).
 *
 * Source: FAA-S-ACS-6C, printed pages 49–50 / PDF pages 57–58.
 *
 * This is an explicit partial slice limited to PA.VIII.E, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_AREA_VIII_TASK_E_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPages: "49–50",
  pdfPages: "57–58",
  areaOfOperation: "Area of Operation VIII: Basic Instrument Maneuvers",
  task: "Task E. Recovery from Unusual Flight Attitudes",
  coverageLabel: "PA.VIII.E",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentAreaVIIITaskEAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "VIII";
  task: "E";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_AREA_VIII_TASK_E_SOURCE;
}

const currentAreaVIIITaskEEntries = [
  [
    "PA.VIII.E.K1",
    "Prevention of unusual attitudes, including flight causal, physiological, and environmental factors, and system and equipment failures.",
  ],
  ["PA.VIII.E.K2", "Procedures for recovery from unusual attitudes in flight."],
  [
    "PA.VIII.E.K3",
    "Procedures available to safely regain visual meteorological conditions (VMC) after flight into inadvertent instrument meteorological conditions or unintended instrument meteorological conditions (IIMC)/(UIMC).",
  ],
  ["PA.VIII.E.K4", "Appropriate use of automation, if applicable."],
  [
    "PA.VIII.E.R1",
    "Situations that could lead to loss of control in-flight (LOC-I) or unusual attitudes in-flight (e.g., stress, task saturation, inadequate instrument scan distractions, and spatial disorientation).",
  ],
  ["PA.VIII.E.R3", "Collision hazards."],
  [
    "PA.VIII.E.R4",
    "Distractions, task prioritization, loss of situational awareness, or disorientation.",
  ],
  ["PA.VIII.E.R5", "Interpreting flight instruments."],
  ["PA.VIII.E.R7", "Operating envelope considerations."],
  ["PA.VIII.E.R8", "Control input errors, inducing undesired aircraft attitudes."],
  ["PA.VIII.E.R9", "Assessment of the unusual attitude."],
  ["PA.VIII.E.R10", "Control application solely by reference to instruments."],
  [
    "PA.VIII.E.S1",
    "Use proper instrument cross-check and interpretation to identify an unusual attitude (including both nose-high and nose-low) in flight, and apply the appropriate flight control, power input, and aircraft configuration in the correct sequence, to return to a stabilized level flight attitude.",
  ],
  [
    "PA.VIII.E.S2",
    "Use single-pilot resource management (SRM) or crew resource management (CRM), as appropriate.",
  ],
] as const;

/** All 14 current PA.VIII.E codes from FAA-S-ACS-6C pages 49–50. */
export const CURRENT_PRIVATE_AIRPLANE_AREA_VIII_TASK_E_CODES: readonly CurrentAreaVIIITaskEAktrCode[] =
  currentAreaVIIITaskEEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "VIII",
    task: "E",
    source: PRIVATE_AIRPLANE_ACS_6C_AREA_VIII_TASK_E_SOURCE,
  }));

export type CurrentAreaVIIITaskECodeResolution =
  | { status: "current"; entry: CurrentAreaVIIITaskEAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.VIII.E slice.
 * Anything outside these 14 current entries remains unresolved.
 */
export function resolveCurrentAreaVIIITaskEAktrCode(
  code: string,
): CurrentAreaVIIITaskECodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_AREA_VIII_TASK_E_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry ? { status: "current", entry } : { status: "unresolved", code: normalized };
}
