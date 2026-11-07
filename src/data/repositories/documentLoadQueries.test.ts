/**
 * Query counts for the Study Library load and one material page, with a
 * 500-card library, plus parity: the batched source reads must give exactly
 * what the one-item-at-a-time reads give on a mixed fixture.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { SqlDatabase, SqlValue } from "@/data/db";
import type { AiStudySet, PracticeTest } from "@/domain/types";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { pdfKitContentHash, readPdfItemProvenance } from "../pdfKitSources";
import { cardSourceFingerprint, readCardPageSource } from "../studyPageSources";
import { createRepositories } from "./index";

const MATERIALS = 10;
const CARDS_PER_MATERIAL = 50;
const PRACTICE_MATERIALS = 3;
const HEX = (n: number) => n.toString(16).padStart(64, "0");
const UUID = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const RUN_AT = "2026-01-01T00:00:00.000Z";

let db: TestDatabase;
let selects = 0;
let counted: SqlDatabase;

beforeEach(async () => {
  db = await createNodeSqliteDatabase();
  selects = 0;
  // Every database call goes through the real test driver; selects are counted.
  counted = new Proxy(db, {
    get(target, key, receiver) {
      if (key === "select") {
        return (sql: string, params?: SqlValue[]) => {
          selects += 1;
          return target.select(sql, params);
        };
      }
      const value = Reflect.get(target, key, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as SqlDatabase;
});

afterEach(() => db.close());

const materialId = (m: number) => `material-${m}`;

async function seedLibrary() {
  const documents = createRepositories(db).documents;
  for (let m = 0; m < MATERIALS; m++) {
    await documents.create({ id: materialId(m), title: `Synthetic handbook ${m}` });
    await documents.saveAiStudySet({
      sourceMaterialId: materialId(m),
      title: `Set ${m}`,
      summary: `Summary ${m}`,
      sections: [{ heading: `Heading ${m}a`, body: "Body a" }, { heading: `Heading ${m}b`, body: "Body b" }],
      flashcards: Array.from({ length: CARDS_PER_MATERIAL }, (_, c) => ({ front: `Front ${m}-${c}`, back: `Back ${m}-${c}`, sourcePage: (c % 9) + 1 })),
      sourceNotes: "",
      model: "synthetic",
    });
    // Edited sets carry item identities; those are the items whose sources are read.
    const [row] = await db.select<{ sections_json: string; flashcards_json: string }>("SELECT sections_json, flashcards_json FROM ai_study_sets WHERE source_material_id = ?", [materialId(m)]);
    const sections = JSON.parse(row!.sections_json).map((s: object, i: number) => ({ ...s, itemId: `s-${m}-${i}` }));
    const cards = JSON.parse(row!.flashcards_json).map((c: object, i: number) => ({ ...c, itemId: `c-${m}-${i}` }));
    await db.execute("UPDATE ai_study_sets SET sections_json = ?, flashcards_json = ? WHERE source_material_id = ?", [JSON.stringify(sections), JSON.stringify(cards), materialId(m)]);
  }
  for (let m = 0; m < PRACTICE_MATERIALS; m++) {
    await documents.savePracticeTest({
      provider: "gemini",
      sourceMaterialId: materialId(m),
      title: `Practice ${m}`,
      questions: Array.from({ length: 5 }, (_, q) => ({
        question: `Question ${m}-${q}?`, options: ["Yes", "No"], correctIndex: q % 2, explanation: "Synthetic.", sourcePage: q + 1,
      })),
      model: "synthetic",
    });
  }
}

/** Page sources and PDF evidence: valid, ambiguous, stale, invalid and orphaned rows. */
async function seedSources() {
  const documents = createRepositories(db).documents;
  const sets = await documents.listAiStudySets();
  const set = (m: number) => sets.find((s) => s.sourceMaterialId === materialId(m))!;
  let n = 1;
  const pageSource = async (owner: string, itemId: string, fingerprint: string, sha: string) => {
    const id = UUID(n++);
    await db.execute("INSERT INTO study_page_sources (id,source_material_id,material_title,content_sha256,physical_page,printed_label,bookmark_id,created_at) VALUES (?,?,?,?,?,?,?,?)",
      [id, owner, "Synthetic handbook", sha, 3, "iii", null, RUN_AT]);
    await db.execute("INSERT INTO study_page_source_bindings VALUES (?,?,?,?,?)", [id, owner, "authored_card", itemId, fingerprint]);
  };
  const s0 = set(0);
  for (let c = 0; c < 5; c++) await pageSource(materialId(0), s0.flashcards[c]!.itemId!, await cardSourceFingerprint(s0.flashcards[c]!), HEX(c + 1));
  // Two different snapshots for one card: the page stays, the content hash is dropped.
  const ambiguous = s0.flashcards[5]!;
  await pageSource(materialId(0), ambiguous.itemId!, await cardSourceFingerprint(ambiguous), HEX(10));
  await pageSource(materialId(0), ambiguous.itemId!, await cardSourceFingerprint(ambiguous), HEX(11));
  // A binding for older wording does not apply.
  await pageSource(materialId(0), s0.flashcards[6]!.itemId!, HEX(99), HEX(12));

  const run = async (runId: string, material: string) =>
    db.execute("INSERT INTO pdf_kit_runs (run_id, material_id, content_sha256, selected_pages_json, extractor_version, algorithm_version, created_at) VALUES (?,?,?,?,?,?,?)",
      [runId, material, HEX(500), "[1,2,3,4,5,6,7,8,9]", 1, 1, RUN_AT]);
  const item = async (runId: string, kind: string, logicalId: string, hash: string, page = 1) =>
    db.execute("INSERT INTO pdf_kit_item_sources (run_id, item_kind, logical_id, content_hash, page, start_offset, end_offset, quote) VALUES (?,?,?,?,?,?,?,?)",
      [runId, kind, logicalId, hash, page, 0, 5, "quote"]);
  const r1 = UUID(900), r2 = UUID(901);
  const s1 = set(1);
  await run(r1, materialId(1));
  await item(r1, "summary", `summary:${r1}`, await pdfKitContentHash("summary", s1.summary));
  await item(r1, "section", s1.sections[0]!.itemId!, await pdfKitContentHash("section", s1.sections[0]! as unknown as Record<string, unknown>));
  for (let c = 0; c < 4; c++) await item(r1, "card", s1.flashcards[c]!.itemId!, await pdfKitContentHash("card", s1.flashcards[c]! as unknown as Record<string, unknown>));
  await item(r1, "card", s1.flashcards[4]!.itemId!, HEX(77));
  // Material 2 has a run but no card evidence; one question has valid evidence.
  await run(r2, materialId(2));
  const snapshot = (await documents.readPracticeSnapshot(materialId(2)))!;
  const q0 = snapshot.questions[0]!;
  await item(r2, "question", q0.identity, await pdfKitContentHash("question", q0 as unknown as Record<string, unknown>));
  // Evidence whose run row is gone applies to no material.
  await db.execute("PRAGMA foreign_keys = OFF");
  await item(UUID(999), "summary", `summary:${UUID(999)}`, HEX(5));
  await db.execute("PRAGMA foreign_keys = ON");
}

const strip = (set: AiStudySet): AiStudySet => {
  const { summaryPdfProvenance: _drop, ...rest } = set;
  return {
    ...rest,
    sections: set.sections.map(({ pdfProvenance: _p, ...s }) => s),
    flashcards: set.flashcards.map(({ pdfProvenance: _p, pageSource: _s, ...c }) => c),
  };
};

/** The reads exactly as they were made before batching, one item at a time. */
async function oneAtATime(set: AiStudySet): Promise<AiStudySet> {
  const query = (sql: string, params: SqlValue[]) => db.select<Record<string, unknown>>(sql, params);
  const summaryPdfProvenance = set.summary.trim() ? await readPdfItemProvenance(query, set.sourceMaterialId, "summary", "summary", set.summary, set.summaryOrigin ?? undefined) : undefined;
  const sections = [];
  for (const item of set.sections) {
    const pdfProvenance = item.itemId ? await readPdfItemProvenance(query, set.sourceMaterialId, "section", item.itemId, item as unknown as Record<string, unknown>, item.origin) : undefined;
    sections.push(pdfProvenance ? { ...item, pdfProvenance } : item);
  }
  const flashcards = [];
  for (const item of set.flashcards) {
    if (!item.itemId) { flashcards.push(item); continue; }
    const pageSource = await readCardPageSource(query, set.sourceMaterialId, "authored_card", item.itemId, item);
    if (pageSource) { flashcards.push({ ...item, pageSource }); continue; }
    const pdfProvenance = await readPdfItemProvenance(query, set.sourceMaterialId, "card", item.itemId, item as unknown as Record<string, unknown>, item.origin);
    flashcards.push(pdfProvenance ? { ...item, pdfProvenance } : item);
  }
  return { ...set, sections, flashcards, ...(summaryPdfProvenance ? { summaryPdfProvenance } : {}) };
}

async function questionsOneAtATime(test: PracticeTest): Promise<PracticeTest> {
  const query = (sql: string, params: SqlValue[]) => db.select<Record<string, unknown>>(sql, params);
  const snapshot = await createRepositories(db).documents.readPracticeSnapshot(test.sourceMaterialId);
  const questions = [];
  for (const [index, full] of test.questions.entries()) {
    const { pdfProvenance: _p, ...question } = full;
    const item = snapshot?.questions[index];
    const pdfProvenance = item ? await readPdfItemProvenance(query, test.sourceMaterialId, "question", item.identity, question as unknown as Record<string, unknown>, question.origin) : undefined;
    questions.push(pdfProvenance ? { ...question, pdfProvenance } : question);
  }
  return { ...test, questions };
}

describe("Study Library load queries", () => {
  it("reads a 500-card library and one material page with a fixed number of selects", async () => {
    await seedLibrary();
    await seedSources();
    const documents = createRepositories(counted).documents;

    selects = 0;
    const [materials, sets, tests] = await Promise.all([documents.list(), documents.listAiStudySets(), documents.listPracticeTests()]);
    const library = selects;
    expect(materials).toHaveLength(MATERIALS);
    expect(sets.reduce((sum, set) => sum + set.flashcards.length, 0)).toBe(MATERIALS * CARDS_PER_MATERIAL);
    expect(tests).toHaveLength(PRACTICE_MATERIALS);

    selects = 0;
    const page = await documents.readStudySetForEdit(materialId(0));
    await documents.readPracticeSnapshot(materialId(0));
    const materialPage = selects;
    expect(page?.set.flashcards).toHaveLength(CARDS_PER_MATERIAL);

    console.info(`[query-count] library=${library} materialPage=${materialPage}`);
    // No read per card: 5 material reads, 9 for all study sets and their
    // sources, 6 for practice sources, plus 2 per practice test (its snapshot).
    // Before batching this fixture took 2,161 and 199.
    expect(library).toBeLessThanOrEqual(20 + 2 * PRACTICE_MATERIALS);
    expect(materialPage).toBeLessThanOrEqual(12);
  });

  it("gives the same sources as reading one item at a time", async () => {
    await seedLibrary();
    await seedSources();
    const documents = createRepositories(db).documents;

    const sets = await documents.listAiStudySets();
    const expected = [];
    for (const set of sets) expected.push(await oneAtATime(strip(set)));
    expect(sets).toEqual(expected);
    // The fixture really covers each case.
    const s0 = sets.find((s) => s.sourceMaterialId === materialId(0))!;
    expect(s0.flashcards[0]!.pageSource?.contentSha256).toBe(HEX(1));
    expect(s0.flashcards[5]!.pageSource?.contentSha256).toBeNull();
    expect(s0.flashcards[6]!.pageSource).toBeUndefined();
    const s1 = sets.find((s) => s.sourceMaterialId === materialId(1))!;
    expect(s1.flashcards[0]!.pdfProvenance?.status).toBe("valid");
    expect(s1.flashcards[4]!.pdfProvenance?.status).toBe("invalid");
    expect(s1.sections[0]!.pdfProvenance?.status).toBe("valid");
    expect(sets.find((s) => s.sourceMaterialId === materialId(2))!.flashcards[0]!.pdfProvenance?.status).toBe("invalid");

    const edit = await documents.readStudySetForEdit(materialId(1));
    expect(edit!.set).toEqual(await oneAtATime(strip(edit!.set)));

    const tests = await documents.listPracticeTests();
    const expectedTests = [];
    for (const test of tests) expectedTests.push(await questionsOneAtATime(test));
    expect(tests).toEqual(expectedTests);
    expect(tests.find((t) => t.sourceMaterialId === materialId(2))!.questions[0]!.pdfProvenance?.status).toBe("valid");
  });
});
