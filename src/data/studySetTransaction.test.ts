/**
 * OFFLINE-03a study-set saves on both test drivers, the repository paths
 * built on them, and origin-aware card snapshots. Every value is synthetic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({
  default: `${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`,
}));

import { readFileSync } from "node:fs";
import vectors from "@/testing/cardOriginVectors.json";
import { canonicalJson, cardVersion, parseSavedCards, versionOrigin } from "@/logic/cardIdentity";
import { prepareStudyEdit } from "@/logic/studyAuthoring";
import { authoringStateOf, frameOf, nextSetOf } from "@/logic/studySetEditing";
import type { SqlDatabase } from "./db";
import { StudySetSaveError, STUDY_SET_ERROR_MESSAGES } from "./persistenceErrors";
import { validateApplicationDatabase } from "./practiceStateValidation";
import { cardReviewRepository } from "./repositories/cardReviewRepository";
import { documentRepository } from "./repositories/documentRepository";
import { createSqlJsDatabase } from "./sqlJsDb";
import {
  decodeStudySetOperation,
  validateRetiredList,
  type NextStudySet,
  type StoredSetRow,
  type StudySetSaveOperation,
} from "./studySetTransaction";
import { createNodeSqliteDatabase, type TestDatabase } from "./testing/nodeSqliteDb";

const M = "mat-study";
const T0 = "2026-10-19T20:00:00.000Z";

const manualSet = (): NextStudySet => ({
  title: "My crosswind notes",
  summary: "Wing down into the wind.",
  summaryOrigin: "user",
  sections: [{ heading: "Crosswind", body: "Aileron into the wind.", itemId: "s-1", origin: "user" }],
  flashcards: [{ front: "Which wing is lowered?", back: "The upwind wing.", sourcePage: null, itemId: "c-1", origin: "user" }],
  sourceNotes: "",
  provider: "manual",
  model: "",
  retired: [],
});

let n = 0;
const opId = () => `5e700000-0000-4000-8000-${(++n).toString(16).padStart(12, "0")}`;

const op = (reason: StudySetSaveOperation["reason"], expected: StoredSetRow | null, next: NextStudySet | null, operationId = opId()): StudySetSaveOperation => ({
  operationId,
  materialId: M,
  reason,
  expected,
  next,
});

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(StudySetSaveError);
    const { code, message } = error as StudySetSaveError;
    expect(message).toBe(STUDY_SET_ERROR_MESSAGES[code]);
    return code;
  }
  throw new Error("Expected a refusal");
}

const opened: TestDatabase[] = [];
beforeEach(() => {
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
  });
});
afterEach(() => {
  while (opened.length) opened.pop()!.close();
  vi.unstubAllGlobals();
});

for (const engine of ["node:sqlite", "sql.js"] as const) {
  async function database(): Promise<SqlDatabase> {
    const db = engine === "sql.js" ? await createSqlJsDatabase() : await createNodeSqliteDatabase();
    if (engine === "node:sqlite") opened.push(db as TestDatabase);
    await db.execute("INSERT INTO study_materials (id, title, created_at, updated_at) VALUES (?, 'Synthetic', ?, ?)", [M, T0, T0]);
    return db;
  }
  const history = (db: SqlDatabase) =>
    db.select<{ id: string; reason: string; previous_json: string }>("SELECT id, reason, previous_json FROM study_set_history ORDER BY created_at, id");

  describe(`study-set saves (${engine})`, () => {

    it("CARDS-FIX-01: recovers exact cards atomically, keeps the guide, retries once and keeps backups valid", async () => {
      const db = await database();
      const docs = documentRepository(db);
      const original = { ...manualSet(), provider: "gemini" as const, summaryOrigin: null };
      await docs.saveStudySet(op("create", null, original));
      const before = (await docs.readStoredStudySet(M))!;
      const guide = { ...original, title: "New guide", summary: "New guide text", flashcards: [] };
      await docs.saveStudySet(op("regenerate", before, guide));
      const offer = (await docs.readGuideCardRecovery(M))!;
      expect(offer.next).toEqual({ ...guide, flashcards: original.flashcards });
      const restore = op("recover-cards", offer.stored, offer.next);
      expect(await docs.saveStudySet(restore)).toEqual({ status: "saved" });
      expect(await docs.saveStudySet(restore)).toEqual({ status: "already_saved" });
      expect(await docs.readGuideCardRecovery(M)).toBeNull();
      expect((await docs.listAiStudySets())[0]!.flashcards).toEqual(original.flashcards);
      expect(await history(db)).toHaveLength(2);
      expect((await docs.listStudySetHistory(M))[0]!.reason).toBe("restore");
      const reference = await createNodeSqliteDatabase();
      opened.push(reference);
      await validateApplicationDatabase((sql, params) => db.select(sql, params), (sql, params) => reference.select(sql, params));
      // The same JSON history survives the normal backup/restore validation contract.
      expect(JSON.parse((await history(db))[1]!.previous_json)).toEqual(offer.stored);
    });


    // Shared with src-tauri/src/study_sets_tests.rs: the Rust guard accepts this exact `recovered` set.
    const recoveryVector = () => JSON.parse(readFileSync(`${process.cwd()}/src-tauri/fixtures/cards-recovery/chain.json`, "utf8")) as {
      materialId: string; steps: { reason: StudySetSaveOperation["reason"]; next: NextStudySet }[]; recovered: NextStudySet;
    };
    const replayVector = async (docs: ReturnType<typeof documentRepository>) => {
      const vector = recoveryVector();
      expect(vector.materialId).toBe(M);
      for (const step of vector.steps) await docs.saveStudySet(op(step.reason, await docs.readStoredStudySet(M), step.next));
      return vector;
    };

    it("CARDS-FIX-01: shared vector — a wipe then further guide regenerations still offers the nearest generated cards", async () => {
      const db = await database();
      const docs = documentRepository(db);
      const vector = await replayVector(docs);
      const offer = (await docs.readGuideCardRecovery(M))!;
      expect(canonicalJson(offer.next)).toBe(canonicalJson(vector.recovered));
      expect(offer.next.flashcards.every(card => card.origin === undefined)).toBe(true);
      expect(await docs.saveStudySet(op("recover-cards", offer.stored, offer.next))).toEqual({ status: "saved" });
      const after = (await docs.listAiStudySets())[0]!;
      expect(after.summary).toBe("Fifth guide.");
      expect(after.flashcards.map(card => card.front)).toEqual(["What is Class B?", "Clearance needed?"]);
      expect(await docs.readGuideCardRecovery(M)).toBeNull();
    });

    it("CARDS-FIX-01: restoring cards whose picture region is gone fails safely with nothing changed", async () => {
      const db = await database();
      const docs = documentRepository(db);
      const vector = await replayVector(docs);
      const rows = await db.select<{ id: string; previous_json: string }>("SELECT id, previous_json FROM study_set_history WHERE previous_json LIKE '%What is Class B?%'");
      const previous = JSON.parse(rows[0]!.previous_json);
      const cards = vector.recovered.flashcards.map((card, i) => (i === 0 ? { ...card, visualRegionId: "ab".repeat(32) } : card));
      previous.flashcards_json = JSON.stringify(cards);
      await db.execute("UPDATE study_set_history SET previous_json = ? WHERE id = ?", [JSON.stringify(previous), rows[0]!.id]);
      const offer = (await docs.readGuideCardRecovery(M))!;
      expect(offer.next.flashcards[0]!.visualRegionId).toBe("ab".repeat(32));
      const before = await docs.readStoredStudySet(M);
      const historyBefore = await history(db);
      await expect(docs.saveStudySet(op("recover-cards", offer.stored, offer.next))).rejects.toBeInstanceOf(StudySetSaveError);
      expect(await docs.readStoredStudySet(M)).toEqual(before);
      expect(await history(db)).toEqual(historyBefore);
    });

    it("CARDS-FIX-01: later practice-test history does not hide a guide wipe", async () => {
      const db = await database(); const docs = documentRepository(db);
      const original = { ...manualSet(), provider: "gemini" as const };
      await docs.saveStudySet(op("create", null, original));
      await docs.saveStudySet(op("regenerate", (await docs.readStoredStudySet(M))!, { ...original, summary: "New guide", flashcards: [] }));
      const practice = { sourceMaterialId: M, title: "Practice", provider: "gemini" as const, model: "p",
        questions: [{ question: "Q?", options: ["A", "B"], correctIndex: 0, explanation: "Because", sourcePage: null }] };
      await docs.savePracticeTest(practice);
      await docs.savePracticeTest({ ...practice, title: "New practice" });
      const offer = await docs.readGuideCardRecovery(M);
      expect(offer?.next.flashcards).toEqual(original.flashcards);
      await docs.saveStudySet(op("recover-cards", offer!.stored, offer!.next));
      const reference = await createNodeSqliteDatabase(); opened.push(reference);
      await validateApplicationDatabase((sql, params) => db.select(sql, params), (sql, params) => reference.select(sql, params));
    });

    it.each(["delete", "edit", "restore"] as const)("CARDS-FIX-01: deliberate clear (%s) never offers recovery or accepts a forged restore", async reason => {
      const db = await database();
      const docs = documentRepository(db);
      const original = { ...manualSet(), provider: "gemini" as const };
      await docs.saveStudySet(op("create", null, original));
      const before = (await docs.readStoredStudySet(M))!;
      const cleared = { ...original, summary: "Changed deliberately", flashcards: [] };
      await docs.saveStudySet(op(reason, before, cleared));
      expect(await docs.readGuideCardRecovery(M)).toBeNull();
      const current = (await docs.readStoredStudySet(M))!;
      expect(await refusal(docs.saveStudySet(op("recover-cards", current, { ...cleared, flashcards: original.flashcards })))).toBe("STALE_CONTENT");
      expect(await docs.readStoredStudySet(M)).toEqual(current);
    });

    it("CARDS-FIX-01: recovery refuses new cards, a different guide, and another material's history", async () => {
      const db = await database(); const docs = documentRepository(db);
      const original = { ...manualSet(), provider: "gemini" as const };
      await docs.saveStudySet(op("create", null, original));
      await docs.saveStudySet(op("regenerate", (await docs.readStoredStudySet(M))!, { ...original, summary: "New guide", flashcards: [] }));
      const offer = (await docs.readGuideCardRecovery(M))!;
      expect(await refusal(docs.saveStudySet(op("recover-cards", offer.stored, { ...offer.next, summary: "Wrong guide" })))).toBe("STALE_CONTENT");
      await db.execute("INSERT INTO study_materials (id,title,created_at,updated_at) VALUES ('other','Other',?,?)", [T0,T0]);
      await docs.saveStudySet({ ...op("create", null, { ...original, summary: "New guide", flashcards: [] }), materialId: "other" });
      expect(await docs.readGuideCardRecovery("other")).toBeNull();
      const other = (await docs.readStoredStudySet("other"))!;
      expect(await refusal(docs.saveStudySet({ ...op("recover-cards", other, offer.next), materialId: "other" }))).toBe("STALE_CONTENT");
      await docs.saveStudySet(op("edit", offer.stored, { ...offer.next, flashcards: [{ front: "New", back: "Mine", sourcePage: null }] }));
      expect(await docs.readGuideCardRecovery(M)).toBeNull();
      expect(await refusal(docs.saveStudySet(op("recover-cards", offer.stored, offer.next)))).toBe("STALE_CONTENT");
    });

    it("creates her own set without history, then keeps the whole previous set before an edit", async () => {
      const db = await database();
      const docs = documentRepository(db);
      expect(await docs.saveStudySet(op("create", null, manualSet()))).toEqual({ status: "saved" });
      expect(await history(db)).toEqual([]);
      const [set] = await docs.listAiStudySets();
      expect(set).toMatchObject({ provider: "manual", summaryOrigin: "user", retired: [] });
      expect(set!.flashcards[0]).toMatchObject({ itemId: "c-1", origin: "user" });

      const before = (await docs.readStoredStudySet(M))!;
      const next = { ...manualSet(), title: "Renamed" };
      const edit = op("edit", before, next);
      await docs.saveStudySet(edit);
      const entries = await history(db);
      expect(entries.map((e) => [e.id, e.reason])).toEqual([[edit.operationId, "edit"]]);
      expect(JSON.parse(entries[0]!.previous_json)).toEqual(before);
      const after = (await docs.readStoredStudySet(M))!;
      expect(after.generated_at).toBe(before.generated_at);
      expect((await docs.listStudySetHistory(M))[0]!.previous).toEqual(before);
    });

    it("refuses a change made elsewhere, and recognises a retry", async () => {
      const db = await database();
      const docs = documentRepository(db);
      const create = op("create", null, manualSet());
      await docs.saveStudySet(create);
      expect(await docs.saveStudySet(create)).toEqual({ status: "already_saved" });
      const stale = { ...(await docs.readStoredStudySet(M))!, summary: "What another window replaced." };
      expect(await refusal(docs.saveStudySet(op("edit", stale, manualSet())))).toBe("STALE_CONTENT");
      expect(await refusal(docs.saveStudySet(op("create", null, { ...manualSet(), title: "Other" })))).toBe("STALE_CONTENT");
      const current = (await docs.readStoredStudySet(M))!;
      const edit = op("edit", current, { ...manualSet(), title: "Renamed" });
      await docs.saveStudySet(edit);
      expect(await docs.saveStudySet(edit)).toEqual({ status: "already_saved" });
      expect(await refusal(docs.saveStudySet({ ...edit, expected: (await docs.readStoredStudySet(M))!, next: { ...manualSet(), title: "Else" } }))).toBe("STALE_CONTENT");
      expect(await history(db)).toHaveLength(1);
      expect(await refusal(docs.saveStudySet({ ...op("create", null, manualSet()), materialId: "gone" }))).toBe("NOT_FOUND");
    });

    it("removing keeps the set in history until the material is deleted; restoring brings it back", async () => {
      const db = await database();
      const docs = documentRepository(db);
      await docs.saveStudySet(op("create", null, manualSet()));
      const before = (await docs.readStoredStudySet(M))!;
      await docs.removeAiStudySet(M);
      expect(await docs.readStoredStudySet(M)).toBeNull();
      const [entry] = await docs.listStudySetHistory(M);
      expect(entry).toMatchObject({ reason: "delete", provider: "manual", previous: before });
      await db.execute("DELETE FROM study_materials WHERE id = ?", [M]);
      expect(await history(db)).toEqual([]);
    });

    it("a Gemini regeneration of a generated set goes to history first and carries her retirements", async () => {
      const db = await database();
      const docs = documentRepository(db);
      const gemini = { sourceMaterialId: M, title: "Guide", summary: "S", sections: [{ heading: "H", body: "B" }], flashcards: [{ front: "F", back: "B", sourcePage: 3 }], sourceNotes: "", model: "gemini-3.5-flash" };
      await docs.saveAiStudySet(gemini);
      expect(await history(db)).toEqual([]);
      const first = (await docs.readStoredStudySet(M))!;
      await docs.saveAiStudySet({ ...gemini, summary: "S2" });
      const entries = await history(db);
      expect(entries.map((e) => e.reason)).toEqual(["regenerate"]);
      expect(JSON.parse(entries[0]!.previous_json)).toEqual(first);
      const [set] = await docs.listAiStudySets();
      expect(set).toMatchObject({ provider: "gemini", summary: "S2", summaryOrigin: null });
    });

    it("a failed write rolls back history too", async () => {
      if (engine !== "node:sqlite") return;
      const db = (await database()) as TestDatabase;
      const docs = documentRepository(db);
      await docs.saveStudySet(op("create", null, manualSet()));
      const before = (await docs.readStoredStudySet(M))!;
      db.beforeStatement = (sql) => {
        if (sql.includes("INSERT INTO ai_study_sets")) throw new Error("synthetic disk full");
      };
      expect(await refusal(docs.saveStudySet(op("edit", before, { ...manualSet(), title: "Never" })))).toBe("STORAGE_ERROR");
      db.beforeStatement = undefined;
      expect(await history(db)).toEqual([]);
      expect(await docs.readStoredStudySet(M)).toEqual(before);
    });

    it("an edited set passes whole-database validation; damaged provenance does not", async () => {
      const db = await database();
      const docs = documentRepository(db);
      await docs.saveStudySet(op("create", null, manualSet()));
      await docs.saveStudySet(op("edit", (await docs.readStoredStudySet(M))!, { ...manualSet(), title: "Renamed" }));
      const query = (sql: string, params: unknown[]) => db.select<Record<string, unknown>>(sql, params as never);
      const reference = await createNodeSqliteDatabase();
      opened.push(reference);
      const ref = (sql: string, params: unknown[]) => reference.select<Record<string, unknown>>(sql, params as never);
      await validateApplicationDatabase(query, ref);
      await db.execute("UPDATE ai_study_sets SET retired_json = '{}'");
      await expect(validateApplicationDatabase(query, ref)).rejects.toThrow(/deletion and correction history/);
      await db.execute("UPDATE ai_study_sets SET retired_json = '[]'");
      await db.execute(
        "INSERT INTO study_set_history (id, material_id, kind, reason, previous_json, provider, created_at) VALUES ('h', ?, 'study_set', 'edit', '{\"title\":\"half\"}', 'manual', ?)",
        [M, T0],
      );
      await expect(validateApplicationDatabase(query, ref)).rejects.toThrow(/history entry h/);
    });
  });
}

describe("operation validation (twin of the native refusals)", () => {
  const base = () => ({ operationId: opId(), materialId: M, reason: "create", expected: null, next: manualSet() as unknown as Record<string, unknown> });
  const code = (value: unknown) => {
    try {
      decodeStudySetOperation(value);
    } catch (error) {
      return (error as StudySetSaveError).code;
    }
    return "ok";
  };
  const withNext = (patch: Record<string, unknown>) => ({ ...base(), next: { ...manualSet(), ...patch } });
  const z = "0".repeat(64);

  it.each([
    ["uppercase id", { ...base(), operationId: "5E700000-0000-4000-8000-000000000001" }],
    ["unknown reason", { ...base(), reason: "overwrite" }],
    ["edit without expected", { ...base(), reason: "edit" }],
    ["unknown provider", withNext({ provider: "other" })],
    ["Gemini summary origin", withNext({ summaryOrigin: "gemini" })],
    ["long title", withNext({ title: "x".repeat(501) })],
    ["long summary", withNext({ summary: "x".repeat(20_001) })],
    ["blank card", withNext({ flashcards: [{ front: "", back: "B", sourcePage: null }] })],
    ["missing page", withNext({ flashcards: [{ front: "F", back: "B" }] })],
    ["page 0", withNext({ flashcards: [{ front: "F", back: "B", sourcePage: 0 }] })],
    ["Gemini origin", withNext({ flashcards: [{ front: "F", back: "B", sourcePage: null, origin: "gemini" }] })],
    ["replaces without origin", withNext({ flashcards: [{ front: "F", back: "B", sourcePage: null, replaces: "c-0" }] })],
    ["extra key", withNext({ flashcards: [{ front: "F", back: "B", sourcePage: null, extra: 1 }] })],
    ["summary id on a card", withNext({ flashcards: [{ front: "F", back: "B", sourcePage: null, itemId: "summary" }] })],
    ["duplicate id", withNext({ sections: [{ heading: "H", body: "B", itemId: "c-1" }] })],
    ["bad text key", withNext({ retired: [{ kind: "card", itemId: "c", reason: "deleted", textKey: "x", terms: [] }] })],
    ["unsorted terms", withNext({ retired: [{ kind: "card", itemId: "c", reason: "deleted", textKey: z, terms: ["b", "a"] }] })],
    ["summary kind mismatch", withNext({ retired: [{ kind: "card", itemId: "summary", reason: "deleted", textKey: z, terms: [] }] })],
    ["duplicate retirement", withNext({ retired: [1, 2].map(() => ({ kind: "card", itemId: "c", reason: "deleted", textKey: z, terms: [] })) })],
  ])("refuses %s", (_label, value) => {
    expect(code(value)).toBe("INVALID_ARGUMENT");
  });

  it("allows exactly 2,000 retirements and refuses 2,001 without evicting", () => {
    const list = (count: number) =>
      Array.from({ length: count }, (_, i) => ({ kind: "card", itemId: `r-${i}`, reason: "deleted", textKey: i.toString(16).padStart(64, "0"), terms: ["back", "front"] }));
    expect(validateRetiredList(list(2_000))).toHaveLength(2_000);
    expect(code(withNext({ retired: list(2_001) }))).toBe("RETIREMENT_LIMIT");
  });

  it("does not count surrounding whitespace, like card review and import", () => {
    expect(code(withNext({ flashcards: [{ front: ` ${"x".repeat(1_000)} \n`, back: "B", sourcePage: null }] }))).toBe("ok");
  });
});

describe("who wrote each card, in the review snapshot", () => {
  it("matches the independent vectors and keeps every legacy hash", async () => {
    for (const vector of vectors.vectors) {
      const parsed = parseSavedCards(JSON.stringify(vector.cards));
      if (parsed.status !== "ok") throw new Error("vector must parse");
      expect(canonicalJson(parsed.cards)).toBe(vector.canonical);
      const version = await cardVersion(vectors.materialId, parsed.cards);
      expect([version.contentHash, version.versionId, version.items[0]!.itemId]).toEqual([vector.contentHash, vector.versionId, vector.firstItemId]);
      expect(versionOrigin(parsed.cards)).toBe(vector.versionOrigin);
    }
  });

  it("treats an unknown origin as damaged cards", () => {
    for (const origin of ["gemini", null, 1, ""]) {
      expect(parseSavedCards(JSON.stringify([{ front: "F", back: "B", sourcePage: null, origin }]))).toEqual({ status: "malformed" });
    }
  });

  it("a snapshot of an edited set records origins beside the legacy provider, and restore refuses tampering", async () => {
    const db = await createNodeSqliteDatabase();
    opened.push(db);
    await db.execute("INSERT INTO study_materials (id, title, created_at, updated_at) VALUES (?, 'Synthetic', ?, ?)", [M, T0, T0]);
    const docs = documentRepository(db);
    await docs.saveAiStudySet({ sourceMaterialId: M, title: "G", summary: "", sections: [], flashcards: [{ front: "A?", back: "B", sourcePage: 1 }, { front: "C?", back: "D", sourcePage: null }], sourceNotes: "", model: "m" });
    const [set] = await docs.listAiStudySets();
    const state = authoringStateOf(set!);
    const edit = await prepareStudyEdit(state, { kind: "correct", itemId: state.items[2]!.itemId, fields: ["C?", "D, corrected"], origin: "instructor" });
    await docs.saveStudySet({ operationId: opId(), materialId: M, reason: "correct", expected: await docs.readStoredStudySet(M), next: nextSetOf(frameOf(set!), edit.next) });

    const reviews = cardReviewRepository(db);
    const snap = await reviews.getCardReviewSnapshot(M);
    if (snap.current.status !== "ok") throw new Error("cards must be reviewable");
    const item = snap.current.items[1]!;
    expect(item.origin).toBe("instructor");
    await reviews.saveAction({
      operationId: crypto.randomUUID(), materialId: M, versionContentHash: snap.current.contentHash, itemId: item.itemId,
      expectedGeneration: snap.generation, expectedRevision: 0, action: "rate", rating: "good",
    });
    expect(await db.select("SELECT provider FROM card_versions")).toEqual([{ provider: "gemini" }]);
    expect(await db.select("SELECT origin FROM card_item_origins")).toEqual([{ origin: "instructor" }]);
    expect(await db.select("SELECT origin FROM card_version_origins")).toEqual([{ origin: "mixed" }]);

    const query = (sql: string, params: unknown[]) => db.select<Record<string, unknown>>(sql, params as never);
    const reference = await createNodeSqliteDatabase();
    opened.push(reference);
    const ref = (sql: string, params: unknown[]) => reference.select<Record<string, unknown>>(sql, params as never);
    await validateApplicationDatabase(query, ref);
    await db.execute("UPDATE card_item_origins SET origin = 'user'");
    await expect(validateApplicationDatabase(query, ref)).rejects.toThrow(/content hash/);
    await db.execute("UPDATE card_item_origins SET origin = 'instructor'");
    await db.execute("UPDATE card_version_origins SET origin = 'manual'");
    await expect(validateApplicationDatabase(query, ref)).rejects.toThrow(/origin does not match/);
  });
});

it("a Gemini page reference outside the PDF range is saved as no page instead of refusing the guide", async () => {
  const db = await createNodeSqliteDatabase();
  opened.push(db);
  await db.execute("INSERT INTO study_materials (id, title, created_at, updated_at) VALUES (?, 'Synthetic', ?, ?)", [M, T0, T0]);
  const docs = documentRepository(db);
  await docs.saveAiStudySet({
    sourceMaterialId: M, title: "G", summary: "", sections: [], sourceNotes: "", model: "m",
    flashcards: [{ front: "A?", back: "B", sourcePage: 0 }, { front: "C?", back: "D", sourcePage: 1_200 }, { front: "E?", back: "F", sourcePage: 7 }],
  });
  expect((await docs.listAiStudySets())[0]!.flashcards.map((card) => card.sourcePage)).toEqual([null, null, 7]);
});

it("a plain Gemini save refuses to replace a set holding her items, whoever calls it", async () => {
  const db = await createNodeSqliteDatabase();
  opened.push(db);
  await db.execute("INSERT INTO study_materials (id, title, created_at, updated_at) VALUES (?, 'Synthetic', ?, ?)", [M, T0, T0]);
  const docs = documentRepository(db);
  await docs.saveStudySet(op("create", null, manualSet()));
  const before = await docs.readStoredStudySet(M);
  await expect(
    docs.saveAiStudySet({ sourceMaterialId: M, title: "G", summary: "S", sections: [], flashcards: [], sourceNotes: "", model: "m" }),
  ).rejects.toThrow(/only after you review it/);
  expect(await docs.readStoredStudySet(M)).toEqual(before);
});
