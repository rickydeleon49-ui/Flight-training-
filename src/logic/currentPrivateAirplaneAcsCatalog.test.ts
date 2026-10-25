import { describe, expect, it } from "vitest";
import {
  ARCHIVED_PRIVATE_AIRPLANE_CODES,
} from "./aktrCodeCatalog";
import {
  CURRENT_PRIVATE_AIRPLANE_ACS_6C_CODES,
  resolvePrivateAirplaneAcsCode,
} from "./currentPrivateAirplaneAcsCatalog";

describe("Complete Private Airplane ACS Catalog Index (ACS-READY-01)", () => {
  const expectedTaskKeyCounts: Record<string, number> = {
    "PA.III.A": 15,
    "PA.III.B": 13,
    "PA.II.A": 17,
    "PA.II.B": 11,
    "PA.II.C": 7,
    "PA.II.D": 23,
    "PA.II.E": 23,
    "PA.II.F": 13,
    "PA.IV.A": 33,
    "PA.IV.B": 28,
    "PA.IV.C": 29,
    "PA.IV.D": 29,
    "PA.IV.E": 31,
    "PA.IV.F": 29,
    "PA.IV.G": 34,
    "PA.IV.H": 27,
    "PA.IV.I": 26,
    "PA.IV.J": 20,
    "PA.IV.K": 32,
    "PA.IV.L": 27,
    "PA.IV.M": 29,
    "PA.IV.N": 21,
    "PA.IX.A": 16,
    "PA.IX.B": 21,
    "PA.IX.C": 17,
    "PA.IX.D": 14,
    "PA.IX.E": 8,
    "PA.IX.F": 21,
    "PA.IX.G": 21,
    "PA.VIII.A": 15,
    "PA.VIII.B": 16,
    "PA.VIII.C": 16,
    "PA.VIII.D": 14,
    "PA.VIII.E": 14,
    "PA.VIII.F": 7,
    "PA.VII.A": 12,
    "PA.VII.B": 23,
    "PA.VII.C": 23,
    "PA.VII.D": 9,
    "PA.VI.A": 24,
    "PA.VI.B": 16,
    "PA.VI.C": 13,
    "PA.VI.D": 11,
    "PA.V.A": 17,
    "PA.V.B": 19,
    "PA.XII.A": 9,
    "PA.XII.B": 13,
    "PA.XI.A": 15,
    "PA.X.A": 18,
    "PA.X.B": 22,
    "PA.X.C": 17,
    "PA.X.D": 20,
    "PA.I.A": 8,
    "PA.I.B": 17,
    "PA.I.C": 34,
    "PA.I.D": 22,
    "PA.I.E": 8,
    "PA.I.F": 14,
    "PA.I.G": 19,
    "PA.I.H": 22,
    "PA.I.I": 28,
  };

  it("contains exactly 61 task slices and 1,170 current entries", () => {
    expect(Object.keys(expectedTaskKeyCounts).length).toBe(61);
    expect(CURRENT_PRIVATE_AIRPLANE_ACS_6C_CODES.length).toBe(1170);

    const totalFromMatrix = Object.values(expectedTaskKeyCounts).reduce(
      (sum, count) => sum + count,
      0
    );
    expect(totalFromMatrix).toBe(1170);
  });

  it("matches the exact task-key code-count matrix", () => {
    const countsByTaskKey: Record<string, number> = {};

    for (const entry of CURRENT_PRIVATE_AIRPLANE_ACS_6C_CODES) {
      // Derive task key like PA.I.A from areaOfOperation and task
      const taskKey = `PA.${entry.areaOfOperation}.${entry.task}`;
      countsByTaskKey[taskKey] = (countsByTaskKey[taskKey] ?? 0) + 1;
    }

    expect(countsByTaskKey).toEqual(expectedTaskKeyCounts);
  });

  it("has no duplicate current codes, and every entry has valid metadata and status current", () => {
    const seenCodes = new Set<string>();

    for (const entry of CURRENT_PRIVATE_AIRPLANE_ACS_6C_CODES) {
      const codeUpper = entry.code.toUpperCase();
      expect(seenCodes.has(codeUpper)).toBe(false);
      seenCodes.add(codeUpper);

      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.source).toBeDefined();
      expect(entry.source.document).toBe("FAA-S-ACS-6C");
      expect(entry.areaOfOperation).toBeDefined();
      expect(entry.task).toBeDefined();
    }

    expect(seenCodes.size).toBe(1170);
  });

  it("ensures no archived entry appears in the current list, and all 18 archived entries resolve as archived", () => {
    const currentCodeSet = new Set(
      CURRENT_PRIVATE_AIRPLANE_ACS_6C_CODES.map((e) => e.code.toUpperCase())
    );

    expect(ARCHIVED_PRIVATE_AIRPLANE_CODES.length).toBe(18);

    for (const archived of ARCHIVED_PRIVATE_AIRPLANE_CODES) {
      expect(currentCodeSet.has(archived.code.toUpperCase())).toBe(false);

      const resolved = resolvePrivateAirplaneAcsCode(archived.code);
      expect(resolved.status).toBe("archived");
      if (resolved.status === "archived") {
        expect(resolved.entry).toEqual(archived);
      }

      // Also verify lowercase resolution delegates to archived
      const resolvedLower = resolvePrivateAirplaneAcsCode(archived.code.toLowerCase());
      expect(resolvedLower.status).toBe("archived");
      if (resolvedLower.status === "archived") {
        expect(resolvedLower.entry).toEqual(archived);
      }
    }
  });

  it("resolves representative current codes across Areas I, IV, VIII and XII (lowercase and uppercase examples)", () => {
    const representativeCases = [
      { code: "PA.I.A.K1", lower: "pa.i.a.k1" },
      { code: "PA.I.C.S3", lower: "pa.i.c.s3" },
      { code: "PA.IV.A.K1", lower: "pa.iv.a.k1" },
      { code: "PA.IV.M.S2", lower: "pa.iv.m.s2" },
      { code: "PA.VIII.A.R1", lower: "pa.viii.a.r1" },
      { code: "PA.VIII.F.S1", lower: "pa.viii.f.s1" },
      { code: "PA.XII.A.K1", lower: "pa.xii.a.k1" },
      { code: "PA.XII.B.S2", lower: "pa.xii.b.s2" },
    ];

    for (const { code, lower } of representativeCases) {
      const resUpper = resolvePrivateAirplaneAcsCode(code);
      expect(resUpper.status).toBe("current");
      if (resUpper.status === "current") {
        expect(resUpper.entry.code).toBe(code);
      }

      const resLower = resolvePrivateAirplaneAcsCode(lower);
      expect(resLower.status).toBe("current");
      if (resLower.status === "current") {
        expect(resLower.entry.code).toBe(code);
      }
    }
  });

  it("properly resolves known archived and unknown/out-of-slice codes", () => {
    // Known archived
    const resArchived = resolvePrivateAirplaneAcsCode("PA.III.A.R3");
    expect(resArchived.status).toBe("archived");

    // Out of slice / fake / non-existent codes
    const unknownCases = ["PA.I.A.K999", "PA.XIII.A.K1", "IR.I.A.K1", "CA.I.A.K1", "UNKNOWN-CODE"];
    for (const code of unknownCases) {
      const res = resolvePrivateAirplaneAcsCode(code);
      expect(res).toEqual({
        status: "unresolved",
        code: code.toUpperCase(),
      });
    }
  });

  it("leaves empty and non-code strings unresolved without trimming them", () => {
    expect(resolvePrivateAirplaneAcsCode("")).toEqual({
      status: "unresolved",
      code: "",
    });
    expect(resolvePrivateAirplaneAcsCode("   ")).toEqual({
      status: "unresolved",
      code: "   ",
    });
  });
});
