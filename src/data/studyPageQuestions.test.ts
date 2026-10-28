/**
 * PDF-STUDY-01d: a practice question made from a page note. Synthetic
 * databases only; no PDF, reader, provider or network.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({ default: `${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm` }));
import { createNodeSqliteDatabase, type TestDatabase } from "./testing/nodeSqliteDb";
import { createSqlJsDatabase } from "./sqlJsDb";
import { documentRepository } from "./repositories/documentRepository";
import { practiceSessionRepository } from "./repositories/practiceSessionRepository";
import { validateApplicationDatabase } from "./practiceStateValidation";
import { bindNoteQuestion, buildPracticeEditOperation, draftFromSnapshot, draftWithNoteQuestion, type NoteQuestionSeed, type PracticeDraftQuestion } from "./practiceAuthoringDraft";
import type { SqlDatabase, SqlValue } from "./db";
import type { PracticeSaveOperation } from "@/domain/types";

const id = () => crypto.randomUUID();
const hash = "a".repeat(64);
let opened: TestDatabase[] = [];
afterEach(() => { opened.forEach((d) => d.close()); opened = []; vi.unstubAllGlobals(); });

async function setup(engine: string) {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  const db: SqlDatabase = engine === "node" ? await createNodeSqliteDatabase() : await createSqlJsDatabase();
  if (engine === "node") opened.push(db as TestDatabase);
  const docs = documentRepository(db);
  const sessions = practiceSessionRepository(db);
  await docs.create({ id: "m", title: "Synthetic book" });
  const bid = id();
  await db.execute("INSERT INTO material_bookmarks (id,material_id,page_index,page_label,originating_content_sha256,title,notes,status,created_at,updated_at) VALUES (?,?,3,'iv',?,'Exact title','Exact notes','verified','x','x')", [bid, "m", hash]);
  const seed: NoteQuestionSeed = {
    identity: id(),
    source: { id: id(), materialId: "m", materialTitle: "Synthetic book", contentSha256: hash, physicalPage: 3, printedLabel: "iv" },
    bookmark: { id: bid, materialId: "m", physicalPage: 3, pageLabel: "iv", originatingContentSha256: hash, title: "Exact title", notes: "Exact notes", status: "verified", createdAt: "x", updatedAt: "x" },
    preview: null,
  };
  const query = (sql: string, p: SqlValue[]) => db.select<Record<string, unknown>>(sql, p);
  /** What she fills in before Save: two options and the answer. */
  const answered = (draft: PracticeDraftQuestion[]) => draft.map((q) => q.identity === seed.identity ? { ...q, options: ["Yes", "No"], correctIndex: 0 } : q);
  /** Only the save from "Make a question" carries the page source. */
  const opFor = async (draft: PracticeDraftQuestion[]) => {
    const expected = await docs.readPracticeSnapshot("m");
    const op = await buildPracticeEditOperation({ operationId: id(), materialId: "m", expected, title: "Synthetic book", draft });
    return expected?.questions.some((q) => q.identity === seed.identity) ? op : bindNoteQuestion(op, seed);
  };
  const activeItems = async () => {
    const [v] = await db.select<{ id: string }>("SELECT id FROM practice_test_versions WHERE source_material_id='m' AND is_active=1");
    return sessions.getItems(v!.id);
  };
  const counts = async () => Promise.all(["practice_tests", "practice_test_versions", "practice_save_operations", "study_page_sources", "study_page_source_bindings", "study_set_history"].map((t) => db.select(`SELECT * FROM ${t}`)));
  return { db, docs, sessions, seed, query, answered, opFor, activeItems, counts };
}

for (const engine of ["node", "sql.js"]) describe(`page-note questions ${engine}`, () => {
  it("prefills exactly with blank options and no answer, which cannot save", async () => {
    const { docs, seed, opFor, counts } = await setup(engine);
    const draft = draftWithNoteQuestion(null, seed);
    expect(draft).toEqual([{ identity: seed.identity, question: "Exact title", options: ["", ""], correctIndex: -1, explanation: "Exact notes", sourcePage: 3, instructor: false }]);
    const before = await counts();
    await expect(docs.savePracticeAuthoring(await opFor(draft))).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(docs.savePracticeAuthoring(await opFor(draft.map((q) => ({ ...q, correctIndex: 0 }))))).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(await counts()).toEqual(before);
  });

  it("creates a first manual test, retries exactly once, and keeps the bookmark", async () => {
    const { db, docs, seed, answered, opFor, activeItems } = await setup(engine);
    const bookmark = await db.select("SELECT * FROM material_bookmarks");
    const op = await opFor(answered(draftWithNoteQuestion(null, seed)));
    expect(op.reason).toBe("create");
    expect(op.pageSource?.itemId).toBe(seed.identity);
    expect(await docs.savePracticeAuthoring(op)).toEqual({ status: "saved" });
    expect(await docs.savePracticeAuthoring(op)).toEqual({ status: "already_saved" });
    const changed = structuredClone(op); changed.pageSource!.source.printedLabel = "v"; changed.pageSource!.bookmark.pageLabel = "v";
    await expect(docs.savePracticeAuthoring(changed)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await db.select("SELECT * FROM practice_save_operations")).toHaveLength(1);
    const [item] = await activeItems();
    expect(item).toMatchObject({ questionText: "Exact title", explanation: "Exact notes", sourcePage: 3, pageSource: { materialTitle: "Synthetic book", physicalPage: 3, printedLabel: "iv", contentSha256: hash } });
    expect(await db.select("SELECT * FROM material_bookmarks")).toEqual(bookmark);
  });

  it("appends to her current test, leaving other questions untouched, and refuses a stale snapshot", async () => {
    const { db, docs, seed, answered, opFor, activeItems, counts } = await setup(engine);
    await docs.savePracticeAuthoring(await opFor([{ identity: null, question: "Existing", options: ["A", "B"], correctIndex: 1, explanation: "", sourcePage: null, instructor: false }]));
    const existing = (await docs.readPracticeSnapshot("m"))!;
    const staleOp = await opFor(answered(draftWithNoteQuestion(existing, seed)));
    await docs.savePracticeAuthoring(await opFor([...draftFromSnapshot(existing), { identity: null, question: "Other", options: ["A", "B"], correctIndex: 0, explanation: "", sourcePage: null, instructor: false }]));
    const before = await counts();
    await expect(docs.savePracticeAuthoring(staleOp)).rejects.toMatchObject({ code: "STALE_CONTENT" });
    expect(await counts()).toEqual(before);
    const current = (await docs.readPracticeSnapshot("m"))!;
    await docs.savePracticeAuthoring(await opFor(answered(draftWithNoteQuestion(current, seed))));
    const after = (await docs.readPracticeSnapshot("m"))!;
    expect(after.questions.slice(0, 2)).toEqual(current.questions);
    expect(after.questions).toHaveLength(3);
    const items = await activeItems();
    expect(items.map((i) => Boolean(i.pageSource))).toEqual([false, false, true]);
    expect(await db.select("SELECT * FROM study_page_sources")).toHaveLength(1);
  });

  it("waits for an attempt in progress and writes nothing", async () => {
    const { db, docs, seed, answered, opFor, counts } = await setup(engine);
    await docs.savePracticeAuthoring(await opFor([{ identity: null, question: "Existing", options: ["A", "B"], correctIndex: 1, explanation: "", sourcePage: null, instructor: false }]));
    await db.execute("INSERT INTO practice_attempts (id,version_id,source_material_id,source_material_title,started_at,status,revision,total_questions) SELECT ?,id,'m','Synthetic book','2026-01-01T00:00:00.000Z','in_progress',0,1 FROM practice_test_versions WHERE is_active=1", [id()]);
    const op = await opFor(answered(draftWithNoteQuestion(await docs.readPracticeSnapshot("m"), seed)));
    const before = await counts();
    await expect(docs.savePracticeAuthoring(op)).rejects.toMatchObject({ code: "ATTEMPT_ACTIVE" });
    expect(await counts()).toEqual(before);
  });

  it("refuses a page note that changed before Save", async () => {
    const { db, docs, seed, answered, opFor, counts } = await setup(engine);
    const op = await opFor(answered(draftWithNoteQuestion(null, seed)));
    await db.execute("UPDATE material_bookmarks SET notes='Changed'");
    const before = await counts();
    await expect(docs.savePracticeAuthoring(op)).rejects.toMatchObject({ code: "SOURCE_CHANGED" });
    expect(await counts()).toEqual(before);
  });

  it("keeps a completed attempt's frozen source across correction, page change, delete, restore and material deletion", async () => {
    const { db, docs, sessions, seed, answered, opFor, activeItems, query } = await setup(engine);
    await docs.savePracticeAuthoring(await opFor(answered(draftWithNoteQuestion(null, seed))));
    const [first] = await activeItems();
    await db.execute("INSERT INTO practice_attempts (id,version_id,source_material_id,source_material_title,started_at,completed_at,status,revision,total_questions,answered_count,score_percent) VALUES (?,?,'m','Synthetic book','2026-01-01T00:00:00.000Z','2026-01-01T00:00:01.000Z','completed',1,1,0,0)", [id(), first!.versionId]);
    // A correction on the same page carries the source to the new wording.
    let snapshot = (await docs.readPracticeSnapshot("m"))!;
    await docs.savePracticeAuthoring(await opFor(draftFromSnapshot(snapshot).map((q) => ({ ...q, question: "Reworded", instructor: true }))));
    expect((await activeItems())[0]).toMatchObject({ questionText: "Reworded", origin: "instructor", pageSource: { physicalPage: 3 } });
    // Moving it to another page detaches the trusted reference.
    snapshot = (await docs.readPracticeSnapshot("m"))!;
    await docs.savePracticeAuthoring(await opFor(draftFromSnapshot(snapshot).map((q) => ({ ...q, sourcePage: 4 }))));
    expect((await activeItems())[0]?.pageSource).toBeUndefined();
    // Restoring the earlier version brings its own source back.
    const history = await db.select<{ previous_json: string }>("SELECT previous_json FROM study_set_history WHERE material_id='m' AND kind='practice' ORDER BY created_at, rowid");
    const restored = JSON.parse(history[1]!.previous_json);
    const current = (await docs.readPracticeSnapshot("m"))!;
    await docs.savePracticeAuthoring({ operationId: id(), sourceMaterialId: "m", reason: "restore", expected: current, next: { title: restored.title, provider: restored.provider, model: restored.model, questions: restored.questions, retired: current.retired } } as PracticeSaveOperation);
    expect((await activeItems())[0]).toMatchObject({ questionText: "Reworded", pageSource: { physicalPage: 3 } });
    await validateApplicationDatabase(query, query);
    // The completed attempt still shows the source against its own frozen wording.
    expect((await sessions.getItems(first!.versionId))[0]).toMatchObject({ questionText: "Exact title", pageSource: { printedLabel: "iv" } });
    // Opening/reading items writes no answer or score.
    const marks = async () => Promise.all(["practice_attempts", "practice_responses", "practice_session_operations"].map((t) => db.select(`SELECT * FROM ${t}`)));
    const beforeRead = await marks();
    await sessions.getItems(first!.versionId); await activeItems();
    expect(await marks()).toEqual(beforeRead);
    // Deleting the test prunes unattempted versions; the attempt keeps its source.
    await docs.removePracticeTest("m");
    expect(await db.select("SELECT * FROM study_page_source_bindings WHERE binding_kind='frozen_question'")).toEqual([expect.objectContaining({ item_key: first!.id })]);
    await validateApplicationDatabase(query, query);
    // Deleting the material collects her drafts and keeps the attempt's frozen source.
    await docs.remove("m");
    expect(await db.select("SELECT * FROM study_page_source_bindings WHERE binding_kind='authored_question'")).toEqual([]);
    expect((await sessions.getItems(first!.versionId))[0]?.pageSource).toMatchObject({ materialTitle: "Synthetic book", physicalPage: 3 });
    await validateApplicationDatabase(query, query);
    await db.execute("UPDATE study_page_source_bindings SET content_fingerprint=?", ["f".repeat(64)]);
    await expect(validateApplicationDatabase(query, query)).rejects.toThrow("Damaged frozen page source");
  });

  it("erasing history collects frozen sources of erased versions", async () => {
    const { db, docs, sessions, seed, answered, opFor, activeItems, query } = await setup(engine);
    await docs.savePracticeAuthoring(await opFor(answered(draftWithNoteQuestion(null, seed))));
    const snapshot = (await docs.readPracticeSnapshot("m"))!;
    await docs.savePracticeAuthoring(await opFor([...draftFromSnapshot(snapshot), { identity: null, question: "Other", options: ["A", "B"], correctIndex: 0, explanation: "", sourcePage: null, instructor: false }]));
    expect(await db.select("SELECT * FROM study_page_source_bindings WHERE binding_kind='frozen_question'")).toHaveLength(2);
    await sessions.eraseHistory({ action: "erase_history", operationId: id(), historyKey: "m" });
    const live = (await activeItems())[0]!;
    expect(await db.select("SELECT item_key FROM study_page_source_bindings WHERE binding_kind='frozen_question'")).toEqual([{ item_key: live.id }]);
    await validateApplicationDatabase(query, query);
  });
});
