import { afterEach, expect, it } from "vitest";
import vectors from "@/testing/practiceAuthoringVectors.json";
import type { PracticeSaveOperation } from "@/domain/types";
import { createNodeSqliteDatabase, type TestDatabase } from "./testing/nodeSqliteDb";
import { practiceRetirementRecord, readCurrentSnapshot } from "./practiceAuthoring";
import { pdfKitContentHash, readPdfItemProvenance } from "./pdfKitSources";
let db: TestDatabase;
afterEach(() => db?.close());
async function rig() {
  db = await createNodeSqliteDatabase();
  await db.execute("INSERT INTO study_materials (id,title,created_at,updated_at) VALUES ('mat-a','Synthetic','now','now')");
  const op = structuredClone(vectors.scenarios.find(s => s.name === "pdf-kit-receipt-and-edit-lineage")!.steps[0]!.operation) as unknown as PracticeSaveOperation;
  return op;
}
it("provenance_atomic_with_save_injected_failure_rolls_back_all", async () => {
  const op=await rig();
  await db.execute("CREATE TRIGGER inject_kit BEFORE INSERT ON practice_tests BEGIN SELECT RAISE(FAIL,'synthetic'); END");
  await expect(db.savePracticeAuthoringAtomically!(op)).rejects.toMatchObject({code:"STORAGE_ERROR"});
  for (const table of ["practice_tests","practice_test_versions","practice_save_operations","pdf_kit_runs","pdf_kit_item_sources"]) {
    expect(await db.select(`SELECT COUNT(*) AS n FROM ${table}`)).toEqual([{n:0}]);
  }
});
it("content_hash_mismatch_refused_before_write", async () => {
  const op=await rig(); op.pdfKitSources!.items[0]!.contentHash="b".repeat(64);
  await expect(db.savePracticeAuthoringAtomically!(op)).rejects.toMatchObject({code:"INVALID_ARGUMENT"});
  expect(await db.select("SELECT COUNT(*) AS n FROM pdf_kit_runs")).toEqual([{n:0}]);
});
it("edited_kit_item_keeps_sources_and_shows_edit_origin", async () => {
  const op=await rig();await db.savePracticeAuthoringAtomically!(op);
  const expected=await readCurrentSnapshot((s,p)=>db.select(s,p),"mat-a");
  const next=structuredClone(op.next!);next.questions[0]!.origin="instructor";
  next.questions[0]!.question="Edited synthetic question";
  next.retired=[await practiceRetirementRecord(op.next!.questions[0]!,"corrected")];
  await db.savePracticeAuthoringAtomically!({operationId:"001c0001-0000-4000-8000-000000000040",sourceMaterialId:"mat-a",reason:"correct",expected,next});
  const provenance=await readPdfItemProvenance((s,p)=>db.select(s,p),"mat-a","question",next.questions[0]!.identity,next.questions[0] as unknown as Record<string,unknown>,"instructor");
  expect(provenance).toMatchObject({status:"valid",label:"Pulled from your PDF on this Mac",editOrigin:"instructor",sources:[{page:1,quote:"Synthetic quote."}]});
});
it.each(["user", "instructor"] as const)("edited_item_with_foreign_source_hash_shows_no_pdf_label (%s)", async (origin) => {
  const op = await rig();
  await db.savePracticeAuthoringAtomically!(op);
  const expected = await readCurrentSnapshot((s, p) => db.select(s, p), "mat-a");
  const next = structuredClone(op.next!);
  next.questions[0]!.origin = origin;
  next.questions[0]!.question = "Edited synthetic question";
  next.retired = [await practiceRetirementRecord(op.next!.questions[0]!, "corrected")];
  await db.savePracticeAuthoringAtomically!({
    operationId: "001c0001-0000-4000-8000-000000000040",
    sourceMaterialId: "mat-a", reason: "correct", expected, next,
  });
  const saved = await readCurrentSnapshot((s, p) => db.select(s, p), "mat-a");
  const question = saved!.questions[0]!;
  expect(question.origin).toBe(origin);
  const read = () => readPdfItemProvenance(
    (s, p) => db.select(s, p), "mat-a", "question", question.identity,
    question as unknown as Record<string, unknown>, question.origin,
  );
  expect(await read()).toMatchObject({status: "valid", label: "Pulled from your PDF on this Mac", editOrigin: origin});

  const foreignHash = "f".repeat(64);
  const versions = await db.select<Record<string, unknown>>(`
    SELECT i.question_text, i.options_json, i.correct_index, i.explanation, i.source_page
    FROM practice_test_items i JOIN practice_test_versions v ON v.id = i.version_id
    WHERE v.source_material_id = ? AND COALESCE(i.logical_id, i.id) = ?`, ["mat-a", question.identity]);
  expect(versions.length).toBeGreaterThanOrEqual(2);
  const hashes = await Promise.all(versions.map(v => pdfKitContentHash("question", {
    question: v.question_text, options: JSON.parse(String(v.options_json)),
    correctIndex: v.correct_index, explanation: v.explanation, sourcePage: v.source_page,
  })));
  expect(hashes).not.toContain(foreignHash);
  await db.execute(`UPDATE pdf_kit_item_sources SET content_hash = ?
    WHERE run_id = ? AND item_kind = 'question' AND logical_id = ?`,
    [foreignHash, op.pdfKitSources!.runId, question.identity]);
  expect(await read()).toEqual({
    status: "invalid", label: "PDF source details unavailable", sources: [], editOrigin: origin,
  });
  expect((await readCurrentSnapshot((s, p) => db.select(s, p), "mat-a"))!.questions[0]!.origin).toBe(origin);
});
it("damaged metadata fails closed instead of a human or AI label", async () => {
  const op=await rig();await db.savePracticeAuthoringAtomically!(op);
  await db.execute("UPDATE pdf_kit_item_sources SET content_hash = ?",["b".repeat(64)]);
  expect(await readPdfItemProvenance((s,p)=>db.select(s,p),"mat-a","question",op.next!.questions[0]!.identity,op.next!.questions[0] as unknown as Record<string,unknown>)).toMatchObject({status:"invalid",label:"PDF source details unavailable"});
});

it("study kit save binds the exact sources and retries, with atomic rollback", async () => {
  const practice=await rig();
  const { pdfKitContentHash }=await import("./pdfKitSources");
  const card={front:"Lift",back:"A synthetic upward force.",sourcePage:1,itemId:"kit-card"};
  const pdfKitSources=structuredClone(practice.pdfKitSources!);
  pdfKitSources.items=[{...pdfKitSources.items[0]!,itemKind:"card",logicalId:"kit-card",contentHash:await pdfKitContentHash("card",card)}];
  const op={operationId:practice.operationId,materialId:"mat-a",reason:"create" as const,expected:null,next:{title:"Kit",summary:"",summaryOrigin:null,sections:[],flashcards:[card],sourceNotes:"",provider:"manual" as const,model:"",retired:[]},pdfKitSources};
  await db.execute("CREATE TRIGGER inject_kit BEFORE INSERT ON study_set_save_operations BEGIN SELECT RAISE(FAIL,'synthetic'); END");
  await expect(db.saveStudySetAtomically!(op)).rejects.toMatchObject({code:"STORAGE_ERROR"});
  expect(await db.select("SELECT COUNT(*) AS n FROM ai_study_sets")).toEqual([{n:0}]);
  await db.execute("DROP TRIGGER inject_kit");
  expect(await db.saveStudySetAtomically!(op)).toEqual({status:"saved"});
  expect(await db.saveStudySetAtomically!(op)).toEqual({status:"already_saved"});
  const changed=structuredClone(op);changed.pdfKitSources.items[0]!.quote="Different quote.";
  await expect(db.saveStudySetAtomically!(changed)).rejects.toMatchObject({code:"CONFLICT"});
  const {pdfKitSources: _sources,...dropped}=op;
  await expect(db.saveStudySetAtomically!(dropped)).rejects.toMatchObject({code:"CONFLICT"});
});

it("shared study save fixture preserves source counts after edits and exact retries", async () => {
  await rig();
  await db.execute("INSERT INTO study_materials (id,title,created_at,updated_at) VALUES ('mat-b','Synthetic','now','now')");
  const {default:steps}=await import("@/testing/pdfKitStudySaveVectors.json");
  const {SET_COLUMNS}=await import("./studySetTransaction");
  for (const step of steps) {
    const op=structuredClone(step.operation) as unknown as import("./studySetTransaction").StudySetSaveOperation;
    if (step.operation.expected==="$current") {
      const [row]=await db.select<Record<string,unknown>>(`SELECT ${SET_COLUMNS.join(",")} FROM ai_study_sets WHERE source_material_id=?`,[op.materialId]);
      op.expected=row as unknown as import("./studySetTransaction").StoredSetRow;
    }
    let actual;
    try {actual=await db.saveStudySetAtomically!(op);} catch(e) {actual={error:(e as {code:string}).code};}
    expect(actual).toEqual(step.expect);
  }
  expect(await db.select("SELECT COUNT(*) AS n FROM pdf_kit_item_sources")).toEqual([{n:1}]);
});

it("missing source rows keep a kit label closed", async () => {
  const op=await rig();await db.savePracticeAuthoringAtomically!(op);
  await db.execute("DELETE FROM pdf_kit_item_sources");
  expect(await readPdfItemProvenance((s,p)=>db.select(s,p),"mat-a","question",op.next!.questions[0]!.identity,op.next!.questions[0] as unknown as Record<string,unknown>)).toMatchObject({status:"invalid",label:"PDF source details unavailable"});
});
