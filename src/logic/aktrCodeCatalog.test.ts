import { describe, expect, it } from "vitest";
import {
  AKTR_ARCHIVED_CODE_SOURCE,
  ARCHIVED_PRIVATE_AIRPLANE_CODES,
  resolveArchivedAktrCode,
} from "./aktrCodeCatalog";

describe("Private Airplane archived AKTR code index", () => {
  it("contains exactly the 18 FAA Section 8 Private Airplane archived codes once each", () => {
    const expected = [
      "PA.III.A.R3", "PA.IV.A.S10", "PA.IV.I.S5", "PA.IV.K.S7",
      "PA.VIII.E.K1a", "PA.VIII.E.K1b", "PA.VIII.E.K1c", "PA.VIII.E.K1d",
      "PA.VIII.E.R2", "PA.VIII.E.R6", "PA.VIII.F.S3", "PA.IX.C.K1a",
      "PA.IX.C.K1b", "PA.IX.C.K1c", "PA.IX.C.K1d", "PA.XII.A.R2",
      "PA.XII.A.S1", "PA.XII.B.R2",
    ];
    const codes = ARCHIVED_PRIVATE_AIRPLANE_CODES.map(({ code }) => code);
    expect(codes).toEqual(expected);
    expect(new Set(codes).size).toBe(codes.length);
    expect(ARCHIVED_PRIVATE_AIRPLANE_CODES.every((entry) => entry.source === AKTR_ARCHIVED_CODE_SOURCE)).toBe(true);
  });

  it("returns the exact archived entry and source metadata for a known code", () => {
    expect(resolveArchivedAktrCode("PA.VIII.E.K1a")).toMatchObject({
      status: "archived",
      entry: {
        code: "PA.VIII.E.K1a",
        description: "Sensitivity, limitations, and potential errors in unusual attitudes",
        certificate: "Private Pilot",
        category: "Airplane",
        source: {
          document: "FAA-G-ACS-2",
          section: "Section 8: Knowledge Test Reports and Archived ACS Codes",
          changed: "2024-12-26",
        },
      },
    });
  });

  it("normalizes ASCII case but requires an exact code", () => {
    expect(resolveArchivedAktrCode("pa.viii.e.k1A")).toMatchObject({ status: "archived", entry: { code: "PA.VIII.E.K1a" } });
    expect(resolveArchivedAktrCode("PA.VIII.E.K1")).toEqual({ status: "unresolved", code: "PA.VIII.E.K1" });
  });

  it.each(["PA.I.A.K1", "PLT044", "CA.I.F.K2f", "not a code"])(
    "leaves non-archived or out-of-scope code %s unresolved",
    (code) => {
      expect(resolveArchivedAktrCode(code)).toEqual({
        status: "unresolved",
        code: code.replace(/[a-z]/g, (letter) => letter.toUpperCase()),
      });
    },
  );
});
