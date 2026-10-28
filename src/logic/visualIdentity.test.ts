import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { cardVersion, canonicalJson, sha256Hex } from "./cardIdentity";
import { cardSourceFingerprint } from "@/data/studyPageSources";
import { buildFlashcardCsv } from "./flashcardCsv";
import { buildExportPacket } from "./studyExport";
import { buildHandoutHtml } from "./studyHandout";
import type { ExportSource } from "./studyExport";
it("keeps existing legacy text golden hashes, item identities and source fingerprints byte-identical", async () => {
  const base = "docs/evidence/m2-card-review-scope-2026-10-06/proof/fixtures/";
  const material = JSON.parse(readFileSync(`${base}synthetic-material.json`, "utf8"));
  const golden = JSON.parse(readFileSync(`${base}identity-golden.json`, "utf8"));
  const v = await cardVersion(material.materialId, material.flashcards);
  expect(v.contentHash).toBe(golden.contentHash);
  expect(v.versionId).toBe(golden.versionId);
  expect(v.items.map((c) => c.itemId)).toEqual(golden.itemIds);
  for (const c of material.flashcards) {
    expect(await cardSourceFingerprint(c)).toBe(
      await sha256Hex(canonicalJson([c.front, c.back, c.sourcePage, c.origin ?? null])),
    );
  }
});
it("omits visual cards at all portable boundaries and keeps text cards", () => {
  const source: ExportSource = {
    material: { title: "Synthetic" },
    practiceTest: null,
    studySet: {
      sourceMaterialId: "m",
      title: "Synthetic",
      summary: "Guide",
      sections: [],
      sourceNotes: "",
      provider: "manual",
      model: "",
      generatedAt: "2026-10-28",
      updatedAt: "2026-10-28",
      flashcards: [
        { front: "SECRET PICTURE QUESTION", back: "SECRET PICTURE ANSWER", sourcePage: null, visualRegionId: "a".repeat(64) },
        { front: "Text Q", back: "Text A", sourcePage: null },
      ],
    },
  };
  const selection = { guide: true, flashcards: true, questions: false };
  const outputs = [
    buildFlashcardCsv([{ source, selection }]),
    JSON.stringify(buildExportPacket(source, selection, new Date("2026-10-28"))),
    buildHandoutHtml(source, selection, { answerKey: true }, new Date("2026-10-28")),
  ];
  for (const output of outputs) {
    expect(output).not.toContain("SECRET PICTURE");
    expect(output).not.toContain("visualRegionId");
    expect(output).toContain("Text Q");
  }
  expect(source.studySet!.flashcards).toHaveLength(2);
});
it("matches the independent visual descriptor golden vector shared with Rust", async () => {
  const r = JSON.parse(readFileSync("src/testing/fixtures/visual/region-identity.json", "utf8"));
  const { visualRegionHash } = await import("@/data/visualCards");
  expect(await visualRegionHash(r)).toBe(r.id);
  const { pdfKitContentHash } = await import("@/data/pdfKitSources");
  const c = { front: "Q", back: "A", sourcePage: null };
  expect(await pdfKitContentHash("card", c)).toBe(await sha256Hex(canonicalJson(c)));
  expect(await pdfKitContentHash("card", { ...c, visualRegionId: r.id })).not.toBe(await pdfKitContentHash("card", c));
});
