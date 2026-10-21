import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { HomeworkOperation, HomeworkSnapshot } from "@/domain/homework";
import { executeHomeworkOperation } from "./homeworkTransaction";
import { homeworkRepository } from "./repositories/homeworkRepository";
import { applyMigrations } from "./migrations";
import { validateHomeworkState } from "./practiceStateValidation";
import { openEngine, schemaReference, ENGINES, dumpTables, type EngineName } from "./testing/skillEvidenceEngines";
const C = JSON.parse(readFileSync("src-tauri/fixtures/homework-validation/cases.json", "utf8")) as { baseline: string[]; operations: Record<string,HomeworkOperation> };
const request = (key: string) => structuredClone(C.operations[key]!);
const T3 = "2026-10-21T10:02:00.000Z";
const uid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12,"0")}`;
async function store(name: EngineName) {
  const engine = await openEngine(name);
  await applyMigrations((s) => engine.exec(s),new Set());
  for (const s of C.baseline) engine.exec(s);
  const act = (op: HomeworkOperation) => executeHomeworkOperation((s) => engine.exec(s),(s,p) => engine.run(s,p),(s,p) => engine.query(s,p),op);
  const validate = async () => validateHomeworkState((s,p) => engine.query(s,p),await schemaReference());
  return { engine,act,validate };
}
describe.each(ENGINES)("homework atomic contract: %s", (name) => {
  it("homework_rollback_midwrite_leaves_nothing",async () => {
    const { engine,act } = await store(name);
    try {
      const before = dumpTables(engine);
      engine.exec(`CREATE TRIGGER fail_second BEFORE INSERT ON homework_activities WHEN NEW.id='${uid(3)}' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END`);
      await expect(act(request("create"))).rejects.toMatchObject({ code:"STORAGE" });
      expect(dumpTables(engine)).toEqual(before);
    } finally { engine.close(); }
  });
  it("homework_retry_same_operation_returns_original",async () => {
    const { engine,act,validate } = await store(name);
    try {
      const original = await act(request("create")); await act(request("edit"));
      const before = dumpTables(engine);
      expect(await act(request("create"))).toEqual(original);
      expect(dumpTables(engine)).toEqual(before); await validate();
    } finally { engine.close(); }
  });
  it("homework_changed_payload_same_operation_refused",async () => {
    const { engine,act } = await store(name);
    try { await act(request("create")); const changed = request("create"); changed.next.assignment.title="Changed";
      const before = dumpTables(engine); await expect(act(changed)).rejects.toMatchObject({ code:"CONFLICT" }); expect(dumpTables(engine)).toEqual(before);
    } finally { engine.close(); }
  });
  it("stale aggregate and forged old activity cycle refuse without writes",async () => {
    const { engine,act } = await store(name);
    try { await act(request("create")); await act(request("complete"));
      const before = dumpTables(engine); const stale=request("edit"); stale.operationId=uid(90);
      await expect(act(stale)).rejects.toMatchObject({ code:"STALE" });
      const cycle=request("reopen"); cycle.next.activities[0]!.record.cycle=1;
      await expect(act(cycle)).rejects.toMatchObject({ code:"INVALID" }); expect(dumpTables(engine)).toEqual(before);
    } finally { engine.close(); }
  });
  it("homework_source_deleted_keeps_assignment_and_history",async () => {
    const { engine,act,validate } = await store(name);
    try { await act(request("create")); await act(request("complete"));
      const before=engine.query("SELECT * FROM homework_history ORDER BY revision");
      engine.exec(`DELETE FROM study_materials WHERE id='${uid(5)}'`);
      expect(engine.query("SELECT material_id,source_material_id FROM homework_activities WHERE kind='read'")).toEqual([{ material_id:null,source_material_id:uid(5) }]);
      expect(engine.query("SELECT * FROM homework_history ORDER BY revision")).toEqual(before);
      await validate();
      const repo=homeworkRepository({ select:async <T>(s:string,p:import("./db").SqlValue[]=[]) => engine.query(s,p) as T[], execute:async () => {} });
      const latest=await repo.get(uid(1)); expect(latest!.activities[2]!.record.material_id).toBeNull();
      const archive=request("archive"); archive.baseRevision=2; archive.operationId=uid(15); archive.at=T3;
      archive.next=structuredClone(latest!); archive.next.assignment.revision=3; archive.next.assignment.updated_at=T3; archive.next.assignment.archived=1;
      // Stored history is canonical (sorted keys); decoded requests retain codec field order.
      const stored = JSON.parse(String(engine.query("SELECT snapshot_json FROM homework_history WHERE revision=2")[0]!.snapshot_json)) as HomeworkSnapshot;
      expect(Object.keys(stored.activities[0]!.record)).not.toEqual(Object.keys(archive.next.activities[0]!.record));
      archive.next.activities = archive.next.activities.map((e) => ({ ...e, record: Object.fromEntries(Object.entries(e.record).reverse()) as typeof e.record }));
      await act(archive); await validate();
    } finally { engine.close(); }
  });
  it("homework_reorder_keeps_ids_and_evidence",async () => {
    const { engine,act,validate } = await store(name);
    try { await act(request("create")); await act(request("complete"));
      const reorder=request("reorder"); reorder.operationId=uid(55); reorder.baseRevision=2; reorder.at=T3; reorder.next=request("complete").next;
      reorder.next.assignment.revision=3; reorder.next.assignment.updated_at=T3;
      for (const [i,e] of reorder.next.activities.entries()) { e.record.position=2-i; e.record.updated_at=T3; }
      const oldEvidence=request("complete").next.activities.map((e) => e.evidence);
      await act(reorder); await validate();
      expect(reorder.next.activities.map((e) => e.evidence)).toEqual(oldEvidence);
      expect(engine.query("SELECT id FROM homework_activities ORDER BY position").map((r) => r.id)).toEqual([uid(4),uid(3),uid(2)]);
    } finally { engine.close(); }
  });
  it("homework_reopen_preserves_prior_cycle_completion",async () => {
    const { engine,act,validate } = await store(name);
    try { await act(request("create")); await act(request("complete")); const previous=engine.query("SELECT snapshot_json FROM homework_history WHERE revision=2");
      await act(request("reopen")); await validate();
      expect(engine.query("SELECT snapshot_json FROM homework_history WHERE revision=2")).toEqual(previous);
      expect(engine.query("SELECT state,cycle,completed_at FROM homework_activities ORDER BY id")[0]).toEqual({ state:"reopened",cycle:2,completed_at:null });
    } finally { engine.close(); }
  });
  it("homework_empty_assignment_never_completes",async () => {
    const { engine,act,validate } = await store(name);
    try { await act(request("empty")); await validate();
      const bad=request("complete"); bad.next.activities=[];
      await expect(act(bad)).rejects.toMatchObject({ code:"INVALID" });
      expect(engine.query("SELECT state FROM homework_assignments")).toEqual([{ state:"upcoming" }]);
    } finally { engine.close(); }
  });
  it("homework_history_append_only",async () => {
    const { engine,act } = await store(name);
    try { await act(request("create"));
      expect(() => engine.exec("UPDATE homework_history SET snapshot_json='{}'")).toThrow(/append-only/);
      expect(() => engine.exec("DELETE FROM homework_history")).toThrow(/append-only/);
      expect(() => engine.exec("DELETE FROM homework_assignments")).toThrow();
    } finally { engine.close(); }
  });
  it("no runs or planner rows; unsupported drivers refuse",async () => {
    const { engine,act } = await store(name);
    try { await act(request("create")); await act(request("complete"));
      expect(engine.query("SELECT * FROM homework_runs")).toEqual([]); expect(engine.query("SELECT * FROM next_actions")).toEqual([]);
      const repo=homeworkRepository({ select:async () => [],execute:async () => {} });
      await expect(repo.save(request("create"))).rejects.toMatchObject({ code:"UNSUPPORTED" });
    } finally { engine.close(); }
  });
  it("remove is soft; removing last activity produces upcoming",async () => {
    const { engine,act,validate } = await store(name);
    try { await act(request("create")); const remove=request("create"); remove.operationId=uid(56); remove.baseRevision=1; remove.at="2026-10-21T10:01:00.000Z"; remove.next.assignment.revision=2; remove.next.assignment.updated_at=remove.at; remove.changeKind="remove_activity";
      for (const e of remove.next.activities) { e.record.removed_at=remove.at; e.record.updated_at=remove.at; }
      await act(remove); await validate();
      expect(engine.query("SELECT COUNT(*) AS n FROM homework_activities WHERE removed_at IS NOT NULL")).toEqual([{ n:3 }]);
      expect(engine.query("SELECT state FROM homework_assignments")).toEqual([{ state:"upcoming" }]);
    } finally { engine.close(); }
  });
});
