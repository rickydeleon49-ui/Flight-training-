import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MIGRATIONS, applyMigrations } from "./migrations";
import { ENGINES, openEngine, schemaReference } from "./testing/skillEvidenceEngines";
import { validateHomeworkState } from "./practiceStateValidation";
import { validateHomeworkSnapshot, validateHomeworkTransition, type HomeworkOperation } from "@/domain/homework";
import { homeworkRepository } from "./repositories/homeworkRepository";
import { executeHomeworkOperation } from "./homeworkTransaction";
import { homeworkOperation } from "@/pages/StudyLibrary/homeworkUi";
const fixture = JSON.parse(readFileSync("src-tauri/fixtures/homework-validation/cases.json", "utf8"));
describe.each(ENGINES)("separate homework answers: %s", name => {
  it("0022 upgrade preserves prompts and version-1 receipts then saves an independent answer", async () => {
    const e = await openEngine(name);
    try {
      for (const m of MIGRATIONS.filter(m => m.version <= 22)) e.exec(m.sql);
      for (const sql of fixture.baseline) e.exec(sql);
      // The frozen legacy SQL includes authentic canonical requests, hashes and v1 evidence.
      const legacy = fixture.cases.find((c: {name: string; expect: string}) => c.expect === "accept" && c.name.includes("complete"));
      expect(legacy).toBeTruthy();
      for (const sql of legacy.sql) e.exec(sql);
      const before = e.query("SELECT id,body FROM homework_activities ORDER BY id");
      const history = e.query("SELECT * FROM homework_history ORDER BY revision");
      expect(before.some(r => r.body)).toBe(true);
      await applyMigrations(sql => e.exec(sql), new Set(MIGRATIONS.filter(m => m.version <= 22).map(m => m.version)));
      expect(e.query("SELECT id,body,answer FROM homework_activities ORDER BY id")).toEqual(before.map(r => ({...r, answer: ""})));
      expect(e.query("SELECT * FROM homework_history ORDER BY revision")).toEqual(history);
      expect(() => e.run("UPDATE homework_activities SET answer=?", ["x".repeat(20001)])).toThrow();
      expect(() => e.run("UPDATE homework_activities SET answer=?", [null])).toThrow();
      await validateHomeworkState((s,p) => e.query(s,p), await schemaReference());
      const repo = homeworkRepository({ select: async <T>(s: string, p: import("./db").SqlValue[] = []) => e.query(s,p) as T[], execute: async () => {}, saveHomeworkAtomically: op => executeHomeworkOperation(s => e.exec(s),(s,p) => e.run(s,p),(s,p) => e.query(s,p),op) });
      const id = String(e.query("SELECT id FROM homework_assignments")[0]!.id);
      const current = (await repo.get(id))!;
      expect(current.activities.some(a => a.evidence?.version === 1)).toBe(true);
      validateHomeworkSnapshot(current);
      const draft = structuredClone(current), entry = draft.activities.find(a => a.record.kind === "reflection")!;
      entry.record.answer = "My independent answer";
      await repo.save(homeworkOperation(current,draft,"edit"));
      const saved = (await repo.get(id))!;
      expect(saved.activities.find(a => a.record.id === entry.record.id)!.record).toMatchObject({body: entry.record.body,answer: "My independent answer"});
      await validateHomeworkState((s,p) => e.query(s,p), await schemaReference());
      const clearing = structuredClone(saved);
      delete clearing.activities.find(a => a.record.id === entry.record.id)!.record.answer;
      await repo.save(homeworkOperation(saved,clearing,"edit"));
      expect((await repo.get(id))!.activities.find(a => a.record.id === entry.record.id)!.record.answer).toBe("");
      await validateHomeworkState((s,p) => e.query(s,p), await schemaReference());
    } finally { e.close(); }
  });
  it("new completions require an answer and v2 evidence; bounds and kinds are validated", () => {
    const op = structuredClone(fixture.operations.complete) as HomeworkOperation;
    const r = op.next.activities.find(e => e.record.kind === "reflection")!;
    expect(validateHomeworkSnapshot(op.next)).toBeTruthy();
    r.record.answer = " ";
    if (r.evidence?.version === 2) r.evidence.answer = " ";
    expect(() => validateHomeworkSnapshot(op.next)).toThrow();
    const oversized = structuredClone(fixture.operations.create);
    oversized.next.activities.find((e: any) => e.record.kind === "reflection").record.answer = "x".repeat(20001);
    expect(() => validateHomeworkSnapshot(oversized.next)).toThrow();
    const invalid = structuredClone(fixture.operations.create);
    invalid.next.activities.find((e: any) => e.record.kind === "checklist").record.answer = "wrong kind";
    expect(() => validateHomeworkSnapshot(invalid.next)).toThrow();
  });
});

it("version-1 evidence retains its original validation while new completions require version 2", () => {
  const create = structuredClone(fixture.operations.create), complete = structuredClone(fixture.operations.complete);
  for (const op of [create, complete]) for (const e of op.next.activities) {
    delete e.record.answer;
    if (e.evidence) { e.evidence.version = 1; delete e.evidence.answer; }
  }
  const previous = validateHomeworkTransition(null, create);
  expect(validateHomeworkTransition(previous,complete,true)).toBeTruthy();
  expect(() => validateHomeworkTransition(previous,complete)).toThrow();
  const bad = structuredClone(complete);
  bad.next.activities.find((e: any) => e.record.kind === "reflection").evidence.body = "changed";
  expect(() => validateHomeworkTransition(previous,bad,true)).toThrow();
});

it("fresh card completions also use v2 while historical v1 still replays", () => {
  const previous = structuredClone(fixture.operations.card_partial.next);
  const completed = structuredClone(fixture.operations.card_finished);
  expect(validateHomeworkTransition(previous,completed)).toBeTruthy();
  completed.next.activities[0].evidence.version = 1;
  delete completed.next.activities[0].evidence.answer;
  expect(() => validateHomeworkTransition(previous,completed)).toThrow();
  expect(validateHomeworkTransition(previous,completed,true)).toBeTruthy();
});
