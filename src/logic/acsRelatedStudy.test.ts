import { describe, expect, it } from "vitest";
import type { StudyMaterial } from "@/domain/types";
import { makeEvent, makeMaterial, makeQuestion } from "@/testing/factories";
import { CURRENT_PRIVATE_AIRPLANE_ACS_6C_CODES } from "./currentPrivateAirplaneAcsCatalog";
import { indexAcsRelatedStudy, selectAcsRelatedStudy, type AcsRelatedStudyIndexInput } from "./relatedStudy";

const tagged = (id: string, tags: string[], title = `Fictional ${id}`) => makeMaterial({ id, title, tags });
function lookup(code: string, input: Partial<AcsRelatedStudyIndexInput>, all?: boolean) {
  return selectAcsRelatedStudy(code, indexAcsRelatedStudy({ materials: [], ...input }), all);
}

describe("ACS lookup Related study", () => {
  it("lists materials tagged with the exact code, with a visible reason and the material destination", () => {
    const result = lookup("pa.iii.a.k1", { materials: [tagged("m /1", [" pa.iii.a.k1 "], "Radio notes")] });
    expect(result).toMatchObject({ status: "current", code: "PA.III.A.K1", hasMore: false });
    expect(result.rows).toEqual([{ kind: "material", id: "m /1", label: "Radio notes", reason: "Tagged: PA.III.A.K1", detail: "", target: { path: "/study/m%20%2F1" } }]);
  });

  it("aggregates a task code from its catalog element codes, exact task tags first, each row naming its element", () => {
    const result = lookup("PA.I.A", { materials: [
      tagged("k2", ["PA.I.A.K2"]), tagged("task", ["PA.I.A"]), tagged("k1", ["PA.I.A.K1"]),
    ] });
    expect(result).toMatchObject({ status: "task", code: "PA.I.A", title: "Task A. Pilot Qualifications" });
    expect(result.rows.map(r => [r.id, r.reason])).toEqual([
      ["task", "Tagged: PA.I.A"], ["k1", "From element PA.I.A.K1"], ["k2", "From element PA.I.A.K2"],
    ]);
  });

  it("lists a material once, under its first matching reason, despite several matching tags", () => {
    const result = lookup("PA.I.A", { materials: [tagged("both", ["PA.I.A.K3", "pa.i.a.k1", "PA.I.A.K1"])] });
    expect(result.rows.map(r => r.reason)).toEqual(["From element PA.I.A.K1"]);
  });

  it("never lists untagged, near-prefix, parent or topic-only items", () => {
    const materials: StudyMaterial[] = [
      makeMaterial({ id: "title", title: "PA.I.A.K1 notes", notes: "PA.I.A.K1", tags: [] }),
      tagged("prefix", ["PA.I.A.K10", "PA.I.A.K", "PA.I.AK1", "PA.I.A.K1x", "XPA.I.A.K1"]),
      tagged("parent", ["PA.I.A", "PA.I"]),
      tagged("other-task", ["PA.I.B.K1"]),
    ];
    const extra = { questions: [makeQuestion({ id: "q", materialId: null, text: "PA.I.A.K1?" })], events: [makeEvent({ title: "PA.I.A.K1" })] };
    expect(lookup("PA.I.A.K1", { materials, ...extra }).rows).toEqual([]);
    expect(lookup("PA.I.A", { materials: materials.filter(m => m.id !== "parent") }).rows).toEqual([]);
    // There is no area-level or prefix aggregation.
    expect(lookup("PA.I", { materials: [tagged("k1", ["PA.I.A.K1"])] })).toMatchObject({ status: "unresolved", rows: [] });
    expect(lookup("PA.I.A.", { materials: [tagged("k1", ["PA.I.A.K1"])] })).toMatchObject({ status: "unresolved", rows: [] });
  });

  it("shows three rows first, then every match — no material is unreachable", () => {
    const materials = Array.from({ length: 8 }, (_, i) => tagged(`m${i}`, ["PA.I.A.K1"]));
    expect(lookup("PA.I.A.K1", { materials })).toMatchObject({ hasMore: true, rows: { length: 3 } });
    expect(lookup("PA.I.A.K1", { materials }, true)).toMatchObject({ hasMore: false, rows: { length: 8 } });
    expect(lookup("PA.I.A", { materials: [...materials, tagged("s1", ["PA.I.A.S1"])] }, true).rows.map(r => r.id)).toEqual([...materials.map(m => m.id), "s1"]);
    expect(lookup("PA.I.A.K1", { materials: materials.slice(0, 4) })).toMatchObject({ hasMore: true, rows: { length: 3 } });
    expect(lookup("PA.I.A.K1", { materials: materials.slice(0, 3) })).toMatchObject({ hasMore: false, rows: { length: 3 } });
  });

  it("keeps the saved study counts as quiet row detail", () => {
    const material = tagged("m", ["PA.I.A.K1"]);
    const result = lookup("PA.I.A.K1", { materials: [material],
      aiStudySets: [{ sourceMaterialId: "m" }] as AcsRelatedStudyIndexInput["aiStudySets"],
      practiceTests: [{ sourceMaterialId: "m" }, { sourceMaterialId: "m" }] as AcsRelatedStudyIndexInput["practiceTests"],
      questions: [makeQuestion({ materialId: "m" })] });
    expect(result.rows[0]?.detail).toBe("1 study guide/set, 2 practice tests, 1 instructor question");
  });

  it("keeps archived and unknown codes separate with no rows", () => {
    const materials = [tagged("m", ["PA.I.A.K1", "NOT.A.CODE"])];
    expect(lookup("NOT.A.CODE", { materials })).toMatchObject({ status: "unresolved", rows: [] });
  });

  it("reports an unreadable library as not checked, never as empty", () => {
    const broken = { ...tagged("m", []), get tags(): string[] { throw new Error("PRIVATE_SENTINEL"); } };
    const index = indexAcsRelatedStudy({ materials: [broken] });
    expect(index).toEqual({ status: "failed" });
    expect(selectAcsRelatedStudy("PA.I.A.K1", index)).toMatchObject({ status: "failed", code: "PA.I.A.K1", rows: [] });
  });

  it("resolves every catalog task from its explicit element codes", () => {
    const tasks = new Map<string, number>();
    for (const entry of CURRENT_PRIVATE_AIRPLANE_ACS_6C_CODES) {
      const key = `PA.${entry.areaOfOperation}.${entry.task}`;
      tasks.set(key, (tasks.get(key) ?? 0) + 1);
    }
    expect(tasks.size).toBe(61);
    const index = indexAcsRelatedStudy({ materials: [] });
    for (const code of tasks.keys()) expect(selectAcsRelatedStudy(code, index).status).toBe("task");
  });

  it("stays fast on a large fictional library: one index, three rows per code at first", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_ACS_6C_CODES.map(e => e.code);
    const materials = Array.from({ length: 3000 }, (_, i) =>
      tagged(`m${i}`, Array.from({ length: 20 }, (_, j) => codes[(i * 7 + j * 13) % codes.length]!)));
    const started = performance.now();
    const index = indexAcsRelatedStudy({ materials,
      questions: Array.from({ length: 3000 }, (_, i) => makeQuestion({ materialId: `m${i}` })) });
    const tasks = [...new Set(CURRENT_PRIVATE_AIRPLANE_ACS_6C_CODES.map(e => `PA.${e.areaOfOperation}.${e.task}`))];
    const results = [...tasks, ...codes].map(code => selectAcsRelatedStudy(code, index));
    const elapsed = performance.now() - started;
    expect(results.every(r => r.rows.length <= 3)).toBe(true);
    expect(results.filter(r => r.status === "task").every(r => r.rows.length === 3 && r.hasMore)).toBe(true);
    // Show more reads only the code's own tag lists.
    const all = selectAcsRelatedStudy("PA.I.A", index, true);
    expect(all.rows.length).toBe(new Set(all.rows.map(r => r.id)).size);
    expect(elapsed).toBeLessThan(1000);
  });
});
