/**
 * Small offline index of Private Pilot Airplane ACS codes explicitly archived
 * in FAA-G-ACS-2, Changes 1 & 2. This is not a complete ACS catalog.
 */

export const AKTR_ARCHIVED_CODE_SOURCE = {
  document: "FAA-G-ACS-2",
  title: "ACS Companion Guide for Pilots, Changes 1 & 2",
  section: "Section 8: Knowledge Test Reports and Archived ACS Codes",
  changed: "2024-12-26",
  url: "https://www.faa.gov/training_testing/testing/acs/acs_companion_guide_pilots.pdf",
} as const;

export interface ArchivedAktrCode {
  code: string;
  description: string;
  status: "archived";
  certificate: "Private Pilot";
  category: "Airplane";
  source: typeof AKTR_ARCHIVED_CODE_SOURCE;
}

const archivedPrivateAirplaneEntries = [
  ["PA.III.A.R3", "Confirmation or expectation bias."],
  ["PA.IV.A.S10", "Retract the water rudders, as appropriate, establish and maintain the most efficient planing/liftoff attitude, and correct for porpoising and skipping (ASES, AMES)."],
  ["PA.IV.I.S5", "Retract the water rudders as appropriate; advance the throttle smoothly to takeoff power."],
  ["PA.IV.K.S7", "Retract the water rudders as appropriate; advance the throttle smoothly to takeoff power."],
  ["PA.VIII.E.K1a", "Sensitivity, limitations, and potential errors in unusual attitudes"],
  ["PA.VIII.E.K1b", "Correlation (pitch instruments/bank instruments)"],
  ["PA.VIII.E.K1c", "Function and operation"],
  ["PA.VIII.E.K1d", "Proper instrument cross-check techniques"],
  ["PA.VIII.E.R2", "Failure to seek assistance or declare an emergency in a deteriorating situation."],
  ["PA.VIII.E.R6", "Failure to unload the wings in recovering from high G situations."],
  ["PA.VIII.F.S3", "Maintain altitude ±200 feet, heading ±20°, and airspeed ±10 knots."],
  ["PA.IX.C.K1a", "Maintain altitude ±200 feet, heading ±20°, and airspeed ±10 knots"],
  ["PA.IX.C.K1b", "Engine roughness or overheat"],
  ["PA.IX.C.K1c", "Loss of oil pressure"],
  ["PA.IX.C.K1d", "Fuel starvation"],
  ["PA.XII.A.R2", "Confirmation or expectation bias as related to taxi instructions."],
  ["PA.XII.A.S1", "Demonstrate runway incursion avoidance procedures."],
  ["PA.XII.B.R2", "Confirmation or expectation bias as related to taxi instructions."],
] as const;

/** All and only the PA.* archived entries published in Companion Guide Section 8. */
export const ARCHIVED_PRIVATE_AIRPLANE_CODES: readonly ArchivedAktrCode[] =
  archivedPrivateAirplaneEntries.map(([code, description]) => ({
    code,
    description,
    status: "archived",
    certificate: "Private Pilot",
    category: "Airplane",
    source: AKTR_ARCHIVED_CODE_SOURCE,
  }));

export type AktrCodeResolution =
  | { status: "archived"; entry: ArchivedAktrCode }
  | { status: "unresolved"; code: string };

/** Exact code lookup. This archive-only index deliberately leaves all other codes unresolved. */
export function resolveArchivedAktrCode(code: string): AktrCodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  // FAA sub-element suffixes are printed in lowercase (for example K1a), but
  // user-entered tokens are ASCII-uppercased by the preceding tokenizer.
  const entry = ARCHIVED_PRIVATE_AIRPLANE_CODES.find(
    (candidate) => candidate.code.replace(/[a-z]/g, (letter) => letter.toUpperCase()) === normalized,
  );
  return entry ? { status: "archived", entry } : { status: "unresolved", code: normalized };
}
