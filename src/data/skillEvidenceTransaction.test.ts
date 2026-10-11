/**
 * Focused M3 write and read behaviour on node:sqlite and sql.js, through the
 * production transaction and reader on stores serialized by the production
 * ConnectionOwner. The shared fixtures (operation and validation cases) hold
 * these engines equal to the native writer.
 */
import { afterEach, describe, expect, it } from "vitest";

import { canonicalJson, sha256Hex } from "@/logic/cardIdentity";

import { SKILL_EVIDENCE_TABLES } from "./practiceStateValidation";
import { SkillEvidenceError, decodeSkillEvidenceAction, labelKey } from "./skillEvidenceTransaction";
import {
  ENGINES,
  clock,
  createRequest,
  insertAction,
  insertJournal,
  openEngine,
  openStore,
  uuid,
  type Engine,
  type SkillEvidenceStore,
} from "./testing/skillEvidenceEngines";

const opened: Engine[] = [];
afterEach(() => {
  for (const engine of opened.splice(0)) engine.close();
});

async function fresh(engineName: (typeof ENGINES)[number]): Promise<SkillEvidenceStore> {
  const engine = await openEngine(engineName);
  opened.push(engine);
  const store = await openStore(engine);
  insertJournal(engine, "j1");
  insertJournal(engine, "j2", { date: "2026-10-03", title: "Crosswind", instructorFeedback: "" });
  insertAction(engine, "a1");
  return store;
}

const codeOf = (promise: Promise<unknown>) =>
  promise.then(
    () => "applied",
    (error: unknown) => (error instanceof SkillEvidenceError ? error.code : `unexpected: ${String(error)}`),
  );

function tableCounts(engine: Engine): number[] {
  return SKILL_EVIDENCE_TABLES.map((t) => Number(engine.query(`SELECT COUNT(*) AS n FROM ${t}`)[0]!["n"]));
}

const edit = (observationId: string, expectedRevision: number, wording: string, observedOn = "2026-10-01") => ({
  action: "edit_observation",
  operationId: uuid(),
  observationId,
  expectedRevision,
  wording,
  observedOn,
  attribution: "self_report",
  instructorName: "",
});

describe("canonical request hash", () => {
  it("matches the native vector (skill_evidence_tests.rs)", async () => {
    const request = decodeSkillEvidenceAction({
      action: "create_observation",
      operationId: "10000000-0000-4000-8000-000000000001",
      observationId: "20000000-0000-4000-8000-000000000001",
      skillId: "builtin.crosswind_landing",
      journalId: "j1",
      sourceField: "none",
      wording: "Héllo \"quoted\" ✈︎\ttab\nline \u{1D11E} back\\slash",
      observedOn: "2026-10-01",
      attribution: "instructor_transcribed",
      instructorName: "Zoë",
    });
    expect(await sha256Hex(canonicalJson(request))).toBe("8c2456e1ecff47164663ed646ba7d66a444d05ad37719a2741ba439623c9cc42");
  });

  it("labelKey normalizes like the native label_key", () => {
    expect(labelKey("  Short-FIELD \t landing ")).toBe("short-field landing");
    expect(labelKey("Café")).toBe(labelKey("Café"));
    expect(labelKey("A B　C﻿")).toBe("a b c");
    expect(labelKey("﻿Go around")).toBe("go around");
    expect(labelKey("Go\u0085around")).toBe("go\u0085around");
    expect(labelKey("ΟΔΟΣ")).toBe("οδος");
  });
});

for (const engineName of ENGINES) {
  describe(`skill evidence writes (${engineName})`, () => {
    it("a failure after the first writes rolls everything back, receipt included (fault seam)", async () => {
      const store = await fresh(engineName);
      const first = createRequest({ wording: "First." });
      await store.act(first);
      const before = tableCounts(store.engine);
      const observationRows = store.engine.query("SELECT * FROM skill_observations");
      // Fail the receipt insert: the head row and history row were already written.
      store.engine.beforeStatement = (sql) => {
        if (sql.includes("INSERT INTO skill_evidence_operations")) throw new Error("injected fault");
      };
      for (const request of [
        createRequest({ wording: "Second." }),
        edit(first.observationId, 1, "First, edited."),
        { action: "erase_observation", operationId: uuid(), observationId: first.observationId, confirm: "erase" },
        { action: "create_custom_skill", operationId: uuid(), skillId: `custom.${uuid()}`, label: "Mine", description: "", topic: "general" },
        { action: "set_status", operationId: uuid(), skillId: "builtin.go_around", expectedSequence: 0, status: "learning" },
      ]) {
        expect(await codeOf(store.act(request))).toBe("STORAGE_FAILURE");
        expect(tableCounts(store.engine)).toEqual(before);
        expect(store.engine.query("SELECT * FROM skill_observations")).toEqual(observationRows);
      }
      // Fail the history append of an edit: the head row stays untouched.
      store.engine.beforeStatement = (sql) => {
        if (sql.includes("INSERT INTO skill_observation_revisions")) throw new Error("injected fault");
      };
      expect(await codeOf(store.act(edit(first.observationId, 1, "Edited.")))).toBe("STORAGE_FAILURE");
      expect(store.engine.query("SELECT * FROM skill_observations")).toEqual(observationRows);
      store.engine.beforeStatement = undefined;
      await store.validate();
      // The connection is usable afterwards: no transaction was left open.
      expect((await store.act(edit(first.observationId, 1, "Edited after the fault."))).status).toBe("applied");
    });

    it("a refusal inside the transaction leaves every table unchanged", async () => {
      const store = await fresh(engineName);
      const before = tableCounts(store.engine);
      expect(await codeOf(store.act(createRequest({ journalId: "missing" })))).toBe("SOURCE_MISSING");
      expect(await codeOf(store.act(createRequest({ skillId: "builtin.no_such_skill" })))).toBe("NOT_FOUND");
      expect(tableCounts(store.engine)).toEqual(before);
    });

    it("limits hold at their exact boundaries", async () => {
      const store = await fresh(engineName);
      expect((await store.act(createRequest({ wording: "a".repeat(2000) }))).status).toBe("applied");
      expect(await codeOf(store.act(createRequest({ wording: "a".repeat(2001) })))).toBe("LIMIT_EXCEEDED");
      const wide = "\u{1D11E}".repeat(2000);
      expect(new TextEncoder().encode(wide).length).toBe(8000);
      expect((await store.act(createRequest({ wording: wide }))).status).toBe("applied");
      expect(await codeOf(store.act(createRequest({ instructorName: "n".repeat(121) })))).toBe("LIMIT_EXCEEDED");
      for (let i = 3; i <= 50; i += 1) await store.act(createRequest({ wording: `Note ${i}` }));
      expect(store.engine.query("SELECT COUNT(*) AS n FROM skill_observations WHERE journal_id = 'j1'")[0]!["n"]).toBe(50);
      expect(await codeOf(store.act(createRequest({ wording: "One more." })))).toBe("LIMIT_EXCEEDED");
      expect((await store.act(createRequest({ journalId: "j2", observedOn: "2026-10-03" }))).status).toBe("applied");
      for (let i = 1; i <= 200; i += 1) {
        await store.act({ action: "create_custom_skill", operationId: uuid(), skillId: `custom.${uuid()}`, label: `Skill ${i}`, description: "", topic: "general" });
      }
      expect(
        await codeOf(store.act({ action: "create_custom_skill", operationId: uuid(), skillId: `custom.${uuid()}`, label: "Skill 201", description: "", topic: "general" })),
      ).toBe("LIMIT_EXCEEDED");
      await store.validate();
    });

    it("history is append-only outside an erase", async () => {
      const store = await fresh(engineName);
      await store.act(createRequest());
      await store.act({ action: "set_status", operationId: uuid(), skillId: "builtin.go_around", expectedSequence: 0, status: "learning" });
      for (const sql of [
        "UPDATE skill_observation_revisions SET wording = 'Rewritten.'",
        "DELETE FROM skill_observation_revisions",
        "UPDATE skill_catalog_revisions SET label = 'Renamed' WHERE skill_id = 'builtin.go_around'",
        "DELETE FROM skill_catalog_revisions WHERE skill_id = 'builtin.go_around'",
        "UPDATE skill_self_assessments SET status = 'practicing'",
        "DELETE FROM skill_self_assessments",
        "DELETE FROM skill_catalog_entries WHERE id = 'builtin.go_around'",
      ]) {
        expect(() => store.engine.exec(sql), sql).toThrow();
      }
    });

    it("every revision past one hundred is reachable with no gap or repeat; cursors bind to their observation", async () => {
      const store = await fresh(engineName);
      const tick = clock();
      const first = createRequest({ wording: "Version 1" });
      await store.act(first, { now: tick.now });
      for (let revision = 2; revision <= 130; revision += 1) {
        tick.advance();
        await store.act(edit(first.observationId, revision - 1, `Version ${revision}`), { now: tick.now });
      }
      const seen: number[] = [];
      let cursor: string | null = null;
      do {
        const page = await store.history({ observationId: first.observationId, cursor, limit: 100 });
        expect(page.currentRevision).toBe(130);
        seen.push(...page.items.map((item) => item.revision));
        cursor = page.nextCursor;
      } while (cursor);
      expect(seen).toEqual(Array.from({ length: 130 }, (_, i) => 130 - i));
      expect(await codeOf(store.history({ observationId: first.observationId, limit: 101 }))).toBe("LIMIT_EXCEEDED");
      const other = createRequest({ wording: "Other" });
      await store.act(other);
      await store.act(edit(other.observationId, 1, "Other revision 2"));
      expect(await codeOf(store.history({ observationId: other.observationId, cursor: JSON.stringify(["history", first.observationId, 2]) }))).toBe(
        "INVALID_ARGUMENT",
      );
    });

    it("an erase leaves no trace of the wording in any table; its history read is ERASED, an unknown one NOT_FOUND", async () => {
      const store = await fresh(engineName);
      const first = createRequest({ wording: "Secret phrase qx91." });
      await store.act(first);
      await store.act(edit(first.observationId, 1, "Secret phrase qx91, edited.", "2026-10-02"));
      await store.act({ action: "link_action", operationId: uuid(), observationId: first.observationId, expectedRevision: 2, actionId: "a1" });
      await store.act({ action: "erase_observation", operationId: uuid(), observationId: first.observationId, confirm: "erase" });
      const tables = store.engine.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").map((r) => String(r["name"]));
      for (const table of tables) {
        for (const column of store.engine.query(`SELECT name FROM pragma_table_info('${table}')`).map((r) => String(r["name"]))) {
          const [{ n }] = store.engine.query(`SELECT COUNT(*) AS n FROM "${table}" WHERE CAST("${column}" AS TEXT) LIKE '%qx91%'`) as [{ n: number }];
          expect(n, `${table}.${column}`).toBe(0);
        }
      }
      expect(await codeOf(store.history({ observationId: first.observationId }))).toBe("ERASED");
      expect(await codeOf(store.history({ observationId: uuid() }))).toBe("NOT_FOUND");
      expect(store.engine.query("SELECT COUNT(*) AS n FROM journal_entries WHERE id = 'j1'")[0]!["n"]).toBe(1);
      await store.validate();
    });

    it("no action changes next_actions or journal_entries, and status is never derived", async () => {
      const store = await fresh(engineName);
      const snapshot = () => ({
        actions: store.engine.query("SELECT * FROM next_actions ORDER BY id"),
        journals: store.engine.query("SELECT * FROM journal_entries ORDER BY id"),
      });
      const before = snapshot();
      const first = createRequest({ sourceField: "instructor_feedback" });
      await store.act(first);
      await store.act({ action: "link_action", operationId: uuid(), observationId: first.observationId, expectedRevision: 1, actionId: "a1" });
      await store.act({ action: "set_addressed", operationId: uuid(), observationId: first.observationId, expectedRevision: 2, addressed: true });
      await store.act({ action: "set_confidence", operationId: uuid(), skillId: "builtin.normal_landing", expectedSequence: 0, confidence: 4 });
      expect(snapshot()).toEqual(before);
      // Completing the action, rating cards or finishing practice elsewhere never sets status.
      store.engine.exec("UPDATE next_actions SET status = 'completed', completed_at = '2026-10-11T00:00:00.000Z' WHERE id = 'a1'");
      const summary = await store.summary("builtin.normal_landing");
      expect(summary).toMatchObject({ status: null, statusSequence: 0, confidence: 4, evidence: "limited" });
      const page = await store.page({ skillId: "builtin.normal_landing" });
      expect(page.items[0]!.action).toEqual({ kind: "linked", actionId: "a1", title: "Review flare timing", actionStatus: "completed" });
      expect(page.items[0]!.addressedAt).not.toBeNull();
    });
  });

  describe(`skill evidence reads (${engineName})`, () => {
    it("a date edit crossing the cursor restarts the list instead of repeating or skipping", async () => {
      const store = await fresh(engineName);
      const ids: string[] = [];
      for (const [n, date] of [[1, "2026-10-01"], [2, "2026-10-02"], [3, "2026-10-03"]] as const) {
        const request = createRequest({ wording: `Note ${n}`, observedOn: date });
        ids.push(request.observationId);
        await store.act(request);
      }
      const first = await store.page({ skillId: "builtin.normal_landing", limit: 1 });
      expect(first.items.map((i) => i.wording)).toEqual(["Note 3"]);
      const cursor = first.nextCursor!;
      expect(JSON.parse(cursor).slice(0, 4)).toEqual([2, "builtin.normal_landing", null, null]);
      expect(await codeOf(store.page({ skillId: "builtin.go_around", cursor, limit: 1 }))).toBe("INVALID_ARGUMENT");
      const forged = JSON.parse(cursor);
      forged[7] = 999;
      expect(await codeOf(store.page({ skillId: "builtin.normal_landing", cursor: JSON.stringify(forged) }))).toBe("INVALID_ARGUMENT");
      await store.act(edit(ids[0]!, 1, "Note 1, reworded"));
      const second = await store.page({ skillId: "builtin.normal_landing", cursor, limit: 1 });
      expect(second.items.map((i) => i.wording)).toEqual(["Note 2"]);
      await store.act(edit(ids[0]!, 2, "Note 1, reworded", "2026-10-05"));
      expect(await codeOf(store.page({ skillId: "builtin.normal_landing", cursor, limit: 1 }))).toBe("STALE_CURSOR");
      // Restarting from the newest shows every observation exactly once.
      const restarted = await store.page({ skillId: "builtin.normal_landing", limit: 50 });
      expect(restarted.items.map((i) => i.wording)).toEqual(["Note 1, reworded", "Note 3", "Note 2"]);
      expect(await codeOf(store.page({ limit: 51 }))).toBe("LIMIT_EXCEEDED");
      expect(await codeOf(store.page({ attribution: "verified" as never }))).toBe("INVALID_ARGUMENT");
    });

    it("equal dates and timestamps page without gaps or repeats, and the skill page uses its index", async () => {
      const store = await fresh(engineName);
      const fixed = { now: () => "2026-10-10T09:00:00.000Z" };
      for (let i = 0; i < 45; i += 1) await store.act(createRequest({ wording: `Same ${i}` }), fixed);
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const page = await store.page({ skillId: "builtin.normal_landing", cursor, limit: 20 });
        seen.push(...page.items.map((i) => i.id));
        cursor = page.nextCursor;
      } while (cursor);
      expect(seen).toHaveLength(45);
      expect(new Set(seen).size).toBe(45);
      const plan = store.engine
        .query(
          "EXPLAIN QUERY PLAN SELECT o.id FROM skill_observations o WHERE o.skill_id = ? AND (o.observed_on, o.created_at, o.id) < (?, ?, ?) ORDER BY o.observed_on DESC, o.created_at DESC, o.id DESC LIMIT 21",
          ["builtin.normal_landing", "2026-10-02", "x", "y"],
        )
        .map((r) => String(r["detail"]));
      expect(plan.join(" ")).toContain("idx_skill_observations_skill_page");
      expect(plan.join(" ")).not.toContain("TEMP B-TREE");
    });

    it("source drift and deletion are shown, never relinked", async () => {
      const store = await fresh(engineName);
      const first = createRequest({ sourceField: "instructor_feedback", wording: "Flare later." });
      await store.act(first);
      store.engine.exec("UPDATE journal_entries SET title = 'Pattern work, renamed', instructor_feedback = 'Changed.' WHERE id = 'j1'");
      const [renamed] = (await store.page({ journalId: "j1" })).items;
      expect(renamed!.source).toEqual({
        kind: "present", journalId: "j1", currentTitle: "Pattern work, renamed", currentDate: "2026-10-01", renamed: true, textChanged: true,
      });
      store.engine.exec("DELETE FROM journal_entries WHERE id = 'j1'");
      insertJournal(store.engine, "j9", { title: "Pattern work" });
      const [deleted] = (await store.page({ skillId: "builtin.normal_landing" })).items;
      expect(deleted!.source).toEqual({ kind: "deleted", sourceJournalId: "j1" });
      expect(deleted!.sourceSnapshot).toEqual({ title: "Pattern work", date: "2026-10-01", field: "instructor_feedback" });
      expect((await store.page({ journalId: "j9" })).items).toHaveLength(0);
    });

    it("the summary counts by attribution and lessons, in words not scores", async () => {
      const store = await fresh(engineName);
      expect(await store.summary("builtin.normal_landing")).toMatchObject({ observationCount: 0, evidence: "none" });
      await store.act(createRequest());
      await store.act(createRequest({ attribution: "self_report", instructorName: "" }));
      await store.act(createRequest());
      expect(await store.summary("builtin.normal_landing")).toMatchObject({ observationCount: 3, distinctDebriefs: 1, evidence: "limited" });
      await store.act(createRequest({ journalId: "j2", observedOn: "2026-10-03" }));
      expect(await store.summary("builtin.normal_landing")).toMatchObject({
        observationCount: 4, selfReportCount: 1, instructorTranscribedCount: 3, distinctDebriefs: 2, lastObservedOn: "2026-10-03", evidence: "recorded",
      });
      expect(await store.summary("builtin.no_such_skill")).toBeNull();
      expect(await codeOf(store.summary("not a skill"))).toBe("INVALID_ARGUMENT");
      const skills = await store.skills();
      expect(skills).toHaveLength(15);
      expect(skills.every((s) => s.origin === "builtin" && !s.retired)).toBe(true);
    });
  });
}
