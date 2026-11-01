/**
 * References listed in the FAA ACS: FAA-S-ACS-6C (November 2023, effective May 31, 2024).
 * Source: https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf
 * Data last checked 2026-10-31 against the local ACS PDF at/adjacent to catalog PDF pages.
 * Check the current FAA version. These are whole documents, not chapter guidance.
 * Handbook URLs follow the plan; no live URL check (this round prohibits network).
 * POH/Flight Manual (PA.VIII.E) is the same document category as POH/AFM.
 */
export interface AcsReferenceDocument {
  id: string;
  label: string;
  name: string;
  url: string | null;
  kind: "regulation" | "handbook" | "ac" | "aim" | "other";
}

export const ACS_REFERENCE_DOCUMENTS: readonly AcsReferenceDocument[] = [
  { id: "14 CFR part 39", label: "14 CFR part 39", name: "Airworthiness directives", url: "https://www.ecfr.gov/current/title-14/chapter-I/subchapter-C/part-39", kind: "regulation" },
  { id: "14 CFR part 43", label: "14 CFR part 43", name: "Aircraft maintenance and alterations", url: "https://www.ecfr.gov/current/title-14/chapter-I/subchapter-C/part-43", kind: "regulation" },
  { id: "14 CFR part 61", label: "14 CFR part 61", name: "Pilot certification", url: "https://www.ecfr.gov/current/title-14/chapter-I/subchapter-D/part-61", kind: "regulation" },
  { id: "14 CFR part 68", label: "14 CFR part 68", name: "BasicMed medical requirements", url: "https://www.ecfr.gov/current/title-14/chapter-I/subchapter-D/part-68", kind: "regulation" },
  { id: "14 CFR part 71", label: "14 CFR part 71", name: "Airspace designations", url: "https://www.ecfr.gov/current/title-14/chapter-I/subchapter-E/part-71", kind: "regulation" },
  { id: "14 CFR part 91", label: "14 CFR part 91", name: "General operating and flight rules", url: "https://www.ecfr.gov/current/title-14/chapter-I/subchapter-F/part-91", kind: "regulation" },
  { id: "14 CFR part 93", label: "14 CFR part 93", name: "Special air traffic rules", url: "https://www.ecfr.gov/current/title-14/chapter-I/subchapter-F/part-93", kind: "regulation" },
  { id: "AC 61-67", label: "AC 61-67", name: "Stall and Spin Awareness Training", url: "https://www.faa.gov/regulations_policies/advisory_circulars", kind: "ac" },
  { id: "AC 68-1", label: "AC 68-1", name: "BasicMed", url: "https://www.faa.gov/regulations_policies/advisory_circulars", kind: "ac" },
  { id: "AC 91-73", label: "AC 91-73", name: "Taxi procedures for pilots", url: "https://www.faa.gov/regulations_policies/advisory_circulars", kind: "ac" },
  { id: "AC 91-78", label: "AC 91-78", name: "Electronic flight bags", url: "https://www.faa.gov/regulations_policies/advisory_circulars", kind: "ac" },
  { id: "AC 91-92", label: "AC 91-92", name: "Pilot weather education and self-briefing", url: "https://www.faa.gov/regulations_policies/advisory_circulars", kind: "ac" },
  { id: "AC 120-71", label: "AC 120-71", name: "Standard operating procedures and pilot monitoring", url: "https://www.faa.gov/regulations_policies/advisory_circulars", kind: "ac" },
  { id: "AIM", label: "AIM", name: "Aeronautical Information Manual", url: "https://www.faa.gov/air_traffic/publications/atpubs/aim_html/", kind: "aim" },
  { id: "FAA-H-8083-1", label: "FAA-H-8083-1", name: "Aircraft Weight and Balance Handbook", url: "https://www.faa.gov/regulations_policies/handbooks_manuals/aviation/weight_and_balance_handbook", kind: "handbook" },
  { id: "FAA-H-8083-2", label: "FAA-H-8083-2", name: "Risk Management Handbook", url: "https://www.faa.gov/regulations_policies/handbooks_manuals/aviation/risk_management_handbook", kind: "handbook" },
  { id: "FAA-H-8083-3", label: "FAA-H-8083-3", name: "Airplane Flying Handbook", url: "https://www.faa.gov/regulations_policies/handbooks_manuals/aviation/airplane_handbook", kind: "handbook" },
  { id: "FAA-H-8083-15", label: "FAA-H-8083-15", name: "Instrument Flying Handbook", url: "https://www.faa.gov/regulations_policies/handbooks_manuals/aviation/instrument_flying_handbook", kind: "handbook" },
  { id: "FAA-H-8083-23", label: "FAA-H-8083-23", name: "Seaplane, Skiplane, and Float/Ski Equipped Helicopter Operations Handbook", url: "https://www.faa.gov/regulations_policies/handbooks_manuals/aviation/seaplane_handbook", kind: "handbook" },
  { id: "FAA-H-8083-25", label: "FAA-H-8083-25", name: "Pilot’s Handbook of Aeronautical Knowledge", url: "https://www.faa.gov/regulations_policies/handbooks_manuals/aviation/phak", kind: "handbook" },
  { id: "FAA-H-8083-28", label: "FAA-H-8083-28", name: "Aviation Weather Handbook", url: "https://www.faa.gov/regulations_policies/handbooks_manuals/aviation/aviation_weather_handbook", kind: "handbook" },
  { id: "FAA-P-8740-66", label: "FAA-P-8740-66", name: "Flying Light Twins Safely", url: null, kind: "other" },
  { id: "POH/AFM", label: "POH/AFM", name: "Use your airplane’s operating handbook or flight manual.", url: null, kind: "other" },
  { id: "Chart Supplements", label: "Chart Supplements", name: "Use current Chart Supplements for your flight.", url: null, kind: "other" },
  { id: "NOTAMs", label: "NOTAMs", name: "Check current notices to air missions (NOTAMs) for your flight.", url: null, kind: "other" },
  { id: "VFR Navigation Charts", label: "VFR Navigation Charts", name: "Use current visual flight rules (VFR) navigation charts.", url: null, kind: "other" },
  { id: "USCG Navigation Rules", label: "USCG Navigation Rules", name: "Navigation Rules (Inland and International)", url: "https://www.navcen.uscg.gov/navigation-rules-amalgamated", kind: "other" },
];

/** Whole-document references, preserving the order printed under each ACS task. */
export const ACS_TASK_REFERENCES: Record<string, string[]> = {
  "PA.I.A": ["14 CFR part 61", "14 CFR part 68", "14 CFR part 91", "AC 68-1", "FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-25"],
  "PA.I.B": ["14 CFR part 39", "14 CFR part 43", "14 CFR part 91", "FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-25"],
  "PA.I.C": ["14 CFR part 91", "AC 91-92", "AIM", "FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-25", "FAA-H-8083-28"],
  "PA.I.D": ["14 CFR part 91", "AIM", "Chart Supplements", "FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-25", "NOTAMs", "VFR Navigation Charts"],
  "PA.I.E": ["14 CFR part 71", "14 CFR part 91", "14 CFR part 93", "AIM", "FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-25", "VFR Navigation Charts"],
  "PA.I.F": ["FAA-H-8083-1", "FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-25", "POH/AFM"],
  "PA.I.G": ["FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-23", "FAA-H-8083-25", "POH/AFM"],
  "PA.I.H": ["AIM", "FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-25"],
  "PA.I.I": ["AIM", "Chart Supplements", "FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-23", "FAA-H-8083-25", "POH/AFM", "USCG Navigation Rules"],
  "PA.II.A": ["FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-23", "FAA-H-8083-25", "FAA-H-8083-28", "POH/AFM"],
  "PA.II.B": ["14 CFR part 91", "AC 120-71", "FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-25", "POH/AFM"],
  "PA.II.C": ["FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-25", "POH/AFM"],
  "PA.II.D": ["AC 91-73", "AIM", "Chart Supplements", "FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-25", "POH/AFM"],
  "PA.II.E": ["AC 91-73", "AIM", "Chart Supplements", "FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-23", "FAA-H-8083-25", "POH/AFM"],
  "PA.II.F": ["FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-23", "FAA-H-8083-25", "POH/AFM"],
  "PA.III.A": ["14 CFR part 91", "AIM", "FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-25"],
  "PA.III.B": ["14 CFR part 91", "AIM", "FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-25"],
  "PA.IV.A": ["AIM", "FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-23", "FAA-H-8083-25", "POH/AFM"],
  "PA.IV.B": ["AIM", "FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-23", "FAA-H-8083-25", "POH/AFM"],
  "PA.IV.C": ["AIM", "FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-25", "POH/AFM"],
  "PA.IV.D": ["AIM", "FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-25", "POH/AFM"],
  "PA.IV.E": ["AIM", "FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-25", "POH/AFM"],
  "PA.IV.F": ["AIM", "FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-25", "POH/AFM"],
  "PA.IV.G": ["AIM", "FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-23", "FAA-H-8083-25", "POH/AFM"],
  "PA.IV.H": ["AIM", "FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-23", "FAA-H-8083-25", "POH/AFM"],
  "PA.IV.I": ["AIM", "FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-23", "FAA-H-8083-25", "POH/AFM"],
  "PA.IV.J": ["AIM", "FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-23", "FAA-H-8083-25", "POH/AFM"],
  "PA.IV.K": ["AIM", "FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-23", "FAA-H-8083-25", "POH/AFM"],
  "PA.IV.L": ["AIM", "FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-23", "FAA-H-8083-25", "POH/AFM"],
  "PA.IV.M": ["AIM", "FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-25", "POH/AFM"],
  "PA.IV.N": ["AIM", "FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-23", "FAA-H-8083-25", "POH/AFM"],
  "PA.V.A": ["FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-25", "POH/AFM"],
  "PA.V.B": ["14 CFR part 61", "FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-25"],
  "PA.VI.A": ["FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-25", "VFR Navigation Charts"],
  "PA.VI.B": ["AC 91-78", "AIM", "FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-25"],
  // Diversion references start on PDF p. 47, before the catalog span (48–49).
  "PA.VI.C": ["AIM", "FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-25", "VFR Navigation Charts"],
  "PA.VI.D": ["AIM", "FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-25", "VFR Navigation Charts"],
  "PA.VII.A": ["FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-25", "POH/AFM"],
  "PA.VII.B": ["AC 61-67", "FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-25", "POH/AFM"],
  "PA.VII.C": ["AC 61-67", "FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-25", "POH/AFM"],
  "PA.VII.D": ["AC 61-67", "FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-25", "POH/AFM"],
  "PA.VIII.A": ["FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-15", "FAA-H-8083-25"],
  "PA.VIII.B": ["FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-15", "FAA-H-8083-25"],
  "PA.VIII.C": ["FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-15", "FAA-H-8083-25"],
  "PA.VIII.D": ["FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-15", "FAA-H-8083-25"],
  "PA.VIII.E": ["FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-15", "FAA-H-8083-25", "POH/AFM"],
  "PA.VIII.F": ["FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-15", "FAA-H-8083-25"],
  "PA.IX.A": ["FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-25", "POH/AFM"],
  "PA.IX.B": ["FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-25", "POH/AFM"],
  "PA.IX.C": ["FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-25", "POH/AFM"],
  "PA.IX.D": ["FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-25", "POH/AFM"],
  "PA.IX.E": ["FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-25", "FAA-P-8740-66", "POH/AFM"],
  "PA.IX.F": ["FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-25", "FAA-P-8740-66", "POH/AFM"],
  "PA.IX.G": ["FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-25", "FAA-P-8740-66", "POH/AFM"],
  "PA.X.A": ["FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-25", "FAA-P-8740-66", "POH/AFM"],
  "PA.X.B": ["FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-25", "FAA-P-8740-66", "POH/AFM"],
  "PA.X.C": ["FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-15", "FAA-H-8083-25", "FAA-P-8740-66", "POH/AFM"],
  "PA.X.D": ["FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-15", "FAA-H-8083-25", "FAA-P-8740-66", "POH/AFM"],
  "PA.XI.A": ["AIM", "FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-25", "POH/AFM"],
  "PA.XII.A": ["FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-25", "POH/AFM"],
  "PA.XII.B": ["FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-23", "FAA-H-8083-25", "POH/AFM"],
};

/** Unknown task codes have no sources; codes are matched exactly as catalogued. */
export function referencesForTask(code: string): AcsReferenceDocument[] {
  if (!Object.hasOwn(ACS_TASK_REFERENCES, code)) return [];
  return ACS_TASK_REFERENCES[code]!.map(id => ACS_REFERENCE_DOCUMENTS.find(document => document.id === id)!);
}
