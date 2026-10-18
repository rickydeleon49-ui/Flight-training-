/**
 * Page references and destinations (M4 Slice 1): production tests for the
 * domain behaviours of the accepted 104-case prototype (controls, M4-R9,
 * M4-R15–R18) under the approved OD-4–OD-7 defaults. Pure functions; every
 * value is synthetic.
 */
import { describe, expect, it } from "vitest";

import {
  canonicalContentHash,
  isResolvedDestination,
  parsePageReference,
  resolveDestination,
  savedPlaceNote,
  translateSplitCoordinates,
  validatePageIndex,
  type TranslationLineage,
} from "./navigation";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);
const identity = { contentSha256: A, totalPages: 40 };

const lineage = (overrides: Partial<TranslationLineage> = {}): TranslationLineage => ({
  materialId: "child",
  childPageCount: 10,
  childContentSha256: C,
  rootMaterialId: "root",
  rootContentSha256: A,
  sourcePageStart: 21,
  sourcePageEnd: 30,
  sourceTotalPages: 100,
  parentMaterialId: "parent",
  parentContentSha256: B,
  parentPageStart: 11,
  parentPageEnd: 20,
  parentTotalPages: 50,
  ...overrides,
});

describe("controls", () => {
  it("a bounded physical reference with a trusted identity resolves to one complete destination", () => {
    const record = resolveDestination({ materialId: "m", reference: 12, identity, provenance: "physical_index" });
    expect(isResolvedDestination(record)).toBe(true);
    expect(record).toEqual({
      status: "resolved",
      destination: {
        materialId: "m", coordinateSpace: "material_physical", contentSha256: A, physicalPage: 12, totalPages: 40,
        pageLabel: null, provenance: "physical_index",
      },
    });
  });

  it("a complete nested translation resolves child → parent and child → root", () => {
    const toParent = translateSplitCoordinates({ direction: "child_to_parent", page: 3 }, lineage());
    expect(toParent).toMatchObject({ success: true, translatedPage: 13, destination: { materialId: "parent", coordinateSpace: "parent_physical", contentSha256: B, totalPages: 50 } });
    const toRoot = translateSplitCoordinates({ direction: "child_to_root", page: 3 }, lineage());
    expect(toRoot).toMatchObject({ success: true, translatedPage: 23, destination: { materialId: "root", coordinateSpace: "root_physical", contentSha256: A } });
    const back = translateSplitCoordinates({ direction: "root_to_child", page: 23 }, lineage());
    expect(back).toMatchObject({ success: true, translatedPage: 3, destination: { materialId: "child", coordinateSpace: "child_physical" } });
  });
});

describe("OD-4 physical pages and OD-6 refusal (M4-R9, M4-R17)", () => {
  it("unknown and invalid totals cannot resolve a physical destination", () => {
    for (const totalPages of [null, undefined, 0, -1, 2.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1, "40" as unknown as number]) {
      expect(parsePageReference(3, { materialId: "m", provenance: "physical_index", contentSha256: A, totalPages }).status, String(totalPages)).toBe("unresolved");
    }
  });

  it("physical index validation rejects non-integers, zeros and out-of-bounds pages", () => {
    for (const page of [0, -3, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2, 41]) {
      expect(validatePageIndex(page, 40).valid, String(page)).toBe(false);
      expect(parsePageReference(page, { materialId: "m", provenance: "physical_index", contentSha256: A, totalPages: 40 }).status).toBe("unresolved");
    }
    expect(validatePageIndex(40, 40)).toEqual({ valid: true });
    expect(validatePageIndex(1, 40)).toEqual({ valid: true });
  });

  it("an out-of-range page is refused with an explanation, never clamped to a nearby page", () => {
    for (const reference of [41, "41", 999]) {
      const record = resolveDestination({ materialId: "m", reference, identity, provenance: "physical_index" });
      expect(record.status).toBe("unresolved");
      expect(record.destination).toBeNull();
      if (record.status === "unresolved") expect(record.guidance).toMatch(/has 40 pages/);
    }
    expect(resolveDestination({ materialId: "m", reference: "4a", identity, provenance: "physical_index" })).toMatchObject({ status: "unresolved", guidance: "Enter a whole page number." });
  });

  it("resolveDestination refuses any reference without a trusted identity", () => {
    for (const bad of [null, { contentSha256: "nope", totalPages: 40 }, { contentSha256: A, totalPages: 0 }, { contentSha256: A, totalPages: 1.5 }]) {
      expect(resolveDestination({ materialId: "m", reference: 3, identity: bad, provenance: "physical_index" }).status).toBe("unresolved");
    }
  });

  it("a caller cannot inflate the count: the identity's count is the only bound", () => {
    const record = resolveDestination({ materialId: "m", reference: 60, identity, provenance: "physical_index" });
    expect(record.status).toBe("unresolved");
    expect(isResolvedDestination({ status: "resolved", destination: { materialId: "m", coordinateSpace: "material_physical", contentSha256: A, physicalPage: 60, totalPages: 40, pageLabel: null, provenance: "physical_index" } })).toBe(false);
  });

  it("hashes are canonical lowercase and anything else is not an identity", () => {
    expect(canonicalContentHash(A.toUpperCase())).toBe(A);
    expect(canonicalContentHash("a".repeat(63))).toBeNull();
    expect(canonicalContentHash(42)).toBeNull();
  });
});

describe("unknown provenance stays unresolved (Gemini/source pages)", () => {
  it("a number of unknown provenance is guidance only, even when it is in range", () => {
    for (const provenance of [undefined, "unknown", "printed_label"] as const) {
      const record = parsePageReference(12, { materialId: "m", provenance, contentSha256: A, totalPages: 40 });
      expect(record.status).toBe("unresolved");
      if (record.status === "unresolved") expect(record.guidance).toMatch(/Look for page 12/);
    }
  });

  it("a printed label with no verified map is guidance only", () => {
    expect(parsePageReference("iv", { materialId: "m", contentSha256: A, totalPages: 40 })).toMatchObject({ status: "unresolved", guidance: expect.stringMatching(/hasn't been matched/) });
  });
});

describe("OD-5 printed labels bound to content (M4-R9, M4-R16)", () => {
  it("a label map that declares no identity cannot resolve", () => {
    const record = parsePageReference("iv", { materialId: "m", contentSha256: A, totalPages: 40, labelMap: { map: { iv: 4 }, contentSha256: "" } });
    expect(record.status).toBe("unresolved");
  });

  it("a label map built for different content is stale and cannot resolve", () => {
    const record = parsePageReference("iv", { materialId: "m", contentSha256: A, totalPages: 40, labelMap: { map: { iv: 4 }, contentSha256: B } });
    expect(record).toMatchObject({ status: "unresolved", reason: expect.stringMatching(/stale/) });
  });

  it("a bound map still cannot resolve a mapped page outside the trusted count", () => {
    expect(parsePageReference("xx", { materialId: "m", contentSha256: A, totalPages: 40, labelMap: { map: { xx: 41 }, contentSha256: A } }).status).toBe("unresolved");
  });

  it("a bound map resolves the label to its physical page and keeps the label separate", () => {
    const record = resolveDestination({ materialId: "m", reference: "3-12", identity, labelMap: { map: { "3-12": 33 }, contentSha256: A } });
    expect(record).toMatchObject({ status: "resolved", destination: { physicalPage: 33, pageLabel: "3-12", provenance: "verified_label_map" } });
  });
});

describe("OD-7 split parts (M4-R9, M4-R15, M4-R18)", () => {
  it("genuine first-level nullable parent fields still permit root navigation", () => {
    const firstLevel = lineage({ parentMaterialId: null, parentContentSha256: null, parentPageStart: null, parentPageEnd: null, parentTotalPages: null });
    expect(translateSplitCoordinates({ direction: "child_to_root", page: 1 }, firstLevel)).toMatchObject({ success: true, translatedPage: 21 });
  });

  it("live root translation requires complete range metadata", () => {
    for (const broken of [{ sourcePageStart: 0 }, { sourcePageEnd: 19 }, { sourcePageEnd: 31 }, { sourcePageStart: 1.5 }] as Partial<TranslationLineage>[]) {
      expect(translateSplitCoordinates({ direction: "child_to_root", page: 1 }, lineage(broken)).success, JSON.stringify(broken)).toBe(false);
    }
  });

  it("an unknown or malformed destination count cannot produce a verified destination", () => {
    for (const sourceTotalPages of [null, 0, 2.5]) {
      expect(translateSplitCoordinates({ direction: "child_to_root", page: 1 }, lineage({ sourceTotalPages }))).toMatchObject({ success: false, code: "DESTINATION_COUNT_UNKNOWN" });
    }
    expect(translateSplitCoordinates({ direction: "child_to_root", page: 1 }, lineage({ sourceTotalPages: 25 })).success).toBe(false);
  });

  it("reverse translation cannot succeed without the destination identity", () => {
    expect(translateSplitCoordinates({ direction: "root_to_child", page: 22 }, lineage({ childContentSha256: null }))).toMatchObject({ success: false, code: "DESTINATION_IDENTITY_MISSING" });
    expect(translateSplitCoordinates({ direction: "root_to_child", page: 22 }, lineage({ materialId: "" })).success).toBe(false);
    expect(translateSplitCoordinates({ direction: "root_to_child", page: 31 }, lineage()).success).toBe(false);
  });

  it("a deleted root or parent returns guidance instead of a destination in another document", () => {
    expect(translateSplitCoordinates({ direction: "child_to_root", page: 2 }, lineage({ rootMaterialId: null }))).toMatchObject({ success: false, code: "ROOT_DELETED", destination: null });
    expect(translateSplitCoordinates({ direction: "child_to_parent", page: 2 }, lineage({ parentMaterialId: null }))).toMatchObject({ success: false, code: "PARENT_DELETED", destination: null });
  });

  it("translated pages stay inside the bounded range, so arithmetic cannot overflow", () => {
    const huge = Number.MAX_SAFE_INTEGER;
    const record = translateSplitCoordinates(
      { direction: "child_to_root", page: 1 },
      lineage({ sourcePageStart: huge - 9, sourcePageEnd: huge, sourceTotalPages: huge }),
    );
    expect(record).toMatchObject({ success: true, translatedPage: huge - 9 });
    expect(translateSplitCoordinates({ direction: "child_to_root", page: 11 }, lineage()).success).toBe(false);
  });
});

describe("saved place notes (OD-8)", () => {
  it("say plainly when a saved place may have moved or was never checked", () => {
    expect(savedPlaceNote("drifted")).toMatch(/earlier version/);
    expect(savedPlaceNote("unverified")).toMatch(/before this file's pages were checked/);
    expect(savedPlaceNote("active")).toBeNull();
    expect(savedPlaceNote("verified")).toBeNull();
  });
});
