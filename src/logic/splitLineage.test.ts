import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { SplitLineage, StudyMaterial } from "@/domain/types";

import {
  composeNestedRange,
  describePages,
  immediateSource,
  isDirectSplit,
  lineageFilesToCheck,
  lineageVerdicts,
  originalSource,
  relatedParts,
  sourceVerdict,
} from "./splitLineage";

const H1 = "1".repeat(64);
const H2 = "2".repeat(64);
const HA = "a".repeat(64);

function material(id: string, filePath: string | null, lineage: SplitLineage | null = null): StudyMaterial {
  return {
    id, title: `Title ${id}`, materialType: "study_guide", topic: "general", reviewStatus: "needs_review",
    priority: "later", goalId: null, eventId: null, notes: "", filePath, originalFileName: null, fileSize: null,
    createdAt: "2026-10-08T12:00:00.000Z", updatedAt: "2026-10-08T12:00:00.000Z", lastReviewedAt: null,
    tags: [], lineage,
  };
}

function direct(id: string, start: number, end: number, rootHash: string | null = H1, root = "R"): SplitLineage {
  return {
    materialId: id, parentMaterialId: null, rootMaterialId: root, sourcePageStart: start, sourcePageEnd: end,
    parentPageStart: null, parentPageEnd: null, childPageCount: end - start + 1, sourceFileName: "root.pdf",
    sourceTitle: "Root Handbook", sourceContentSha256: rootHash, sourceTotalPages: 400, parentFileName: null,
    parentTitle: null, parentContentSha256: null, parentTotalPages: null, nestedLevel: 1,
    createdAt: "2026-10-08T12:00:00.000Z",
  };
}

function nested(id: string, start: number, end: number, parentHash: string | null = HA, parent = "A"): SplitLineage {
  return {
    ...direct(id, 100 + start, 100 + end),
    parentMaterialId: parent,
    parentPageStart: start,
    parentPageEnd: end,
    parentFileName: "a.pdf",
    parentTitle: "Part A",
    parentContentSha256: parentHash,
    parentTotalPages: 200,
    nestedLevel: 2,
  };
}

const byId = (...items: StudyMaterial[]) => new Map(items.map((item) => [item.id, item]));

describe("page arithmetic", () => {
  const fixture = JSON.parse(
    readFileSync(join(__dirname, "../../src-tauri/fixtures/split-lineage/compose.json"), "utf8"),
  ) as {
    cases: Array<{
      name: string;
      parent: { start: number; end: number };
      selection: { start: number; end: number };
      expected: { start: number; end: number; childPageCount: number } | null;
    }>;
  };

  it.each(fixture.cases.map((c) => [c.name, c] as const))("matches the native splitter: %s", (_, c) => {
    if (c.expected) expect(composeNestedRange(c.parent, c.selection)).toEqual(c.expected);
    else expect(() => composeNestedRange(c.parent, c.selection)).toThrow(RangeError);
  });

  it("classifies tiers by structure, never by which fingerprints are missing", () => {
    expect(isDirectSplit(direct("p", 1, 10))).toBe(true);
    expect(isDirectSplit(direct("p", 1, 10, null))).toBe(true);
    expect(isDirectSplit(nested("q", 20, 40))).toBe(false);
    expect(isDirectSplit(nested("q", 20, 40, null))).toBe(false);
  });

  it("describes pages in the original and in the immediate parent", () => {
    const lineage = nested("B", 20, 40);
    expect(describePages(originalSource(lineage))).toBe("pages 120–140 of 400");
    expect(describePages(immediateSource(lineage))).toBe("pages 20–40 of 200");
    expect(describePages({ firstPage: 7, lastPage: 7, totalPages: null })).toBe("page 7");
    expect(immediateSource(direct("p", 101, 300))).toEqual(originalSource(direct("p", 101, 300)));
  });
});

describe("source verdicts", () => {
  const root = material("R", "root.pdf");
  const a = material("A", "a.pdf", direct("A", 101, 300));

  it("covers matching, changed, missing, removed, unknown and not-yet-checked", () => {
    const materials = byId(root);
    expect(sourceVerdict(H1, "R", materials, new Map([["root.pdf", H1]]))).toBe("matching");
    expect(sourceVerdict(H1, "R", materials, new Map([["root.pdf", H2]]))).toBe("changed");
    expect(sourceVerdict(H1, "R", materials, new Map([["root.pdf", null]]))).toBe("missing");
    expect(sourceVerdict(H1, "R", new Map(), new Map([["root.pdf", H1]]))).toBe("deleted");
    expect(sourceVerdict(H1, null, materials, new Map([["root.pdf", H1]]))).toBe("deleted");
    expect(sourceVerdict(null, "R", materials, new Map([["root.pdf", H1]]))).toBe("unknown");
    expect(sourceVerdict(H1, "R", materials, null)).toBe("unknown");
    expect(sourceVerdict(H1, "R", byId(material("R", null)), new Map())).toBe("unknown");
  });

  it("a matching original never vouches for a parent whose fingerprint is unknown", () => {
    const b = material("B", "b.pdf", nested("B", 20, 40, null));
    const prints = new Map([["root.pdf", H1], ["a.pdf", HA]]);
    expect(lineageVerdicts(b.lineage!, byId(root, a, b), prints)).toEqual({ parent: "unknown", root: "matching" });
  });

  it("judges each tier against its own file", () => {
    const b = material("B", "b.pdf", nested("B", 20, 40));
    expect(lineageVerdicts(b.lineage!, byId(root, a, b), new Map([["root.pdf", H2], ["a.pdf", HA]]))).toEqual({
      parent: "matching",
      root: "changed",
    });
    expect(lineageFilesToCheck(b.lineage!, byId(root, a, b)).sort()).toEqual(["a.pdf", "root.pdf"]);
    const first = material("P", "p.pdf", direct("P", 1, 10));
    expect(lineageVerdicts(first.lineage!, byId(root, first), new Map([["root.pdf", H1]]))).toEqual({
      parent: "matching",
      root: "matching",
    });
  });
});

describe("related parts", () => {
  it("groups only parts from the same known edition of the same source, in page order", () => {
    const one = material("one", "1.pdf", direct("one", 1, 100));
    const two = material("two", "2.pdf", direct("two", 101, 200));
    const otherEdition = material("old", "3.pdf", direct("old", 1, 100, H2));
    const otherImport = material("copy", "4.pdf", direct("copy", 1, 100, H1, "R2"));
    const unknown = material("u", "5.pdf", direct("u", 201, 300, null));
    const all = [two, otherEdition, otherImport, unknown, one];
    expect(relatedParts(one, all).map((m) => m.id)).toEqual(["two"]);
    expect(relatedParts(otherEdition, all)).toEqual([]);
    expect(relatedParts(otherImport, all)).toEqual([]);
    expect(relatedParts(unknown, all)).toEqual([]);
    expect(relatedParts(material("plain", "x.pdf"), all)).toEqual([]);
  });

  it("never groups parts of a part through the original when their parent edition is unknown", () => {
    const b1 = material("B1", "b1.pdf", nested("B1", 20, 40, null));
    const b2 = material("B2", "b2.pdf", nested("B2", 41, 60, null));
    expect(relatedParts(b1, [b1, b2])).toEqual([]);
    const c1 = material("C1", "c1.pdf", nested("C1", 41, 60));
    const c2 = material("C2", "c2.pdf", nested("C2", 20, 40));
    const firstLevel = material("D", "d.pdf", direct("D", 1, 10));
    expect(relatedParts(c1, [c1, c2, firstLevel]).map((m) => m.id)).toEqual(["C2"]);
  });
});
