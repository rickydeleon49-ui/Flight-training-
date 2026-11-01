import { describe, expect, it } from "vitest";
import { ACS_TASK_CATALOG } from "./acsTaskCatalog";
import { ACS_REFERENCE_DOCUMENTS, ACS_TASK_REFERENCES, referencesForTask } from "./acsTaskReferences";

// Whole documents in FAA-S-ACS-6C (November 2023, effective May 31, 2024).
const expectedIds = [
  ...[39, 43, 61, 68, 71, 91, 93].map(part => `14 CFR part ${part}`),
  ...["61-67", "68-1", "91-73", "91-78", "91-92", "120-71"].map(ac => `AC ${ac}`),
  "AIM",
  ...[1, 2, 3, 15, 23, 25, 28].map(handbook => `FAA-H-8083-${handbook}`),
  "FAA-P-8740-66", "POH/AFM", "Chart Supplements", "NOTAMs", "VFR Navigation Charts", "USCG Navigation Rules",
];

const samples: [string, string[]][] = [
  ["PA.I.A", ["14 CFR part 61", "14 CFR part 68", "14 CFR part 91", "AC 68-1", "FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-25"]],
  ["PA.I.C", ["14 CFR part 91", "AC 91-92", "AIM", "FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-25", "FAA-H-8083-28"]],
  ["PA.IV.A", ["AIM", "FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-23", "FAA-H-8083-25", "POH/AFM"]],
];

describe("References listed in the FAA ACS", () => {
  it("uses exactly the source documents, with unique IDs and plain names", () => {
    const ids = ACS_REFERENCE_DOCUMENTS.map(document => document.id);
    expect(ids.slice().sort()).toEqual(expectedIds.slice().sort());
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(Object.values(ACS_TASK_REFERENCES).flat())).toEqual(new Set(ids));
    for (const document of ACS_REFERENCE_DOCUMENTS) {
      expect(document.label.trim()).not.toBe("");
      expect(document.name.trim()).not.toBe("");
      expect(["regulation", "handbook", "ac", "aim", "other"]).toContain(document.kind);
    }
  });

  it("covers all 61 catalog tasks", () => {
    expect(ACS_TASK_CATALOG).toHaveLength(61);
    expect(Object.keys(ACS_TASK_REFERENCES).sort()).toEqual(ACS_TASK_CATALOG.map(task => task.code).sort());
  });

  it.each(ACS_TASK_CATALOG)("resolves $code in order with a substantive source", ({ code }) => {
    const ids = ACS_TASK_REFERENCES[code]!;
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    const documents = referencesForTask(code);
    expect(documents).toHaveLength(ids.length);
    expect(documents.every(Boolean)).toBe(true);
    expect(documents.map(document => document.id)).toEqual(ids);
    expect(documents.some(document => document.id === "FAA-H-8083-25"
      || document.id === "FAA-H-8083-3" || document.kind === "regulation")).toBe(true);
  });

  it("matches PA.I.I on PDF p. 17, including USCG Navigation Rules in ACS order", () => {
    expect(referencesForTask("PA.I.I").map(document => document.id)).toEqual([
      "AIM", "Chart Supplements", "FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-23", "FAA-H-8083-25", "POH/AFM", "USCG Navigation Rules",
    ]);
    expect(ACS_REFERENCE_DOCUMENTS.find(document => document.id === "USCG Navigation Rules")).toEqual({
      id: "USCG Navigation Rules",
      label: "USCG Navigation Rules",
      name: "Navigation Rules (Inland and International)",
      url: "https://www.navcen.uscg.gov/navigation-rules-amalgamated",
      kind: "other",
    });
  });

  it("links only to official HTTPS sources, with exact eCFR part links", () => {
    for (const document of ACS_REFERENCE_DOCUMENTS) {
      if (document.url === null) continue;
      const url = new URL(document.url);
      expect(url.protocol).toBe("https:");
      expect(["www.faa.gov", "www.ecfr.gov", "www.navcen.uscg.gov"]).toContain(url.host);
      expect(url.username).toBe("");
      expect(url.password).toBe("");
      if (document.kind === "regulation") {
        expect(url.host).toBe("www.ecfr.gov");
        expect(url.pathname.endsWith(`/part-${document.id.split(" ").at(-1)}`)).toBe(true);
      }
    }
  });

  it("keeps airplane-specific and current flight information unlinked", () => {
    for (const id of ["POH/AFM", "Chart Supplements", "NOTAMs", "VFR Navigation Charts"]) {
      expect(ACS_REFERENCE_DOCUMENTS.find(document => document.id === id)?.url).toBeNull();
    }
  });

  it.each(samples)("matches the printed sample %s exactly", (code, ids) => {
    expect(ACS_TASK_REFERENCES[code]).toEqual(ids);
    expect(referencesForTask(code).map(document => document.id)).toEqual(ids);
  });

  it("fills Diversion from PDF p. 47 rather than guessing from neighbouring tasks", () => {
    expect(ACS_TASK_REFERENCES["PA.VI.C"]).toEqual([
      "AIM", "FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-25", "VFR Navigation Charts",
    ]);
  });

  // Six additional source spot-checks, at the actual reference heading PDF pages.
  it.each<[string, string[]]>([
    ["PA.I.E", ["14 CFR part 71", "14 CFR part 91", "14 CFR part 93", "AIM", "FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-25", "VFR Navigation Charts"]], // p. 13
    ["PA.II.E", ["AC 91-73", "AIM", "Chart Supplements", "FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-23", "FAA-H-8083-25", "POH/AFM"]], // p. 22
    ["PA.IV.K", ["AIM", "FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-23", "FAA-H-8083-25", "POH/AFM"]], // p. 39
    ["PA.VI.B", ["AC 91-78", "AIM", "FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-25"]], // p. 47
    ["PA.VII.D", ["AC 61-67", "FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-25", "POH/AFM"]], // p. 53
    ["PA.X.C", ["FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-15", "FAA-H-8083-25", "FAA-P-8740-66", "POH/AFM"]], // p. 68
  ])("preserves the source reference order for %s", (code, ids) => {
    expect(referencesForTask(code).map(document => document.id)).toEqual(ids);
  });

  it("normalizes the source's POH/Flight Manual alias without adding a document", () => {
    expect(ACS_TASK_REFERENCES["PA.VIII.E"]).toEqual([
      "FAA-H-8083-2", "FAA-H-8083-3", "FAA-H-8083-15", "FAA-H-8083-25", "POH/AFM",
    ]);
  });

  it("returns no references for unknown, element, or prototype-property codes", () => {
    for (const code of ["", "PA.I.Z", "PA.I.A.K1", "pa.i.a", " PA.I.A ", "toString", "constructor", "__proto__"]) {
      expect(referencesForTask(code)).toEqual([]);
    }
  });
});
