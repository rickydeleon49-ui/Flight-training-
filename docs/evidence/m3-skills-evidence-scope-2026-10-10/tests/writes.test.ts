/**
 * M3 candidate write contract on real node:sqlite and sql.js connections
 * migrated with the shipped 0001-0013 plus candidate 0014.
 */
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { openCandidateStore, openEngine, openNodeEngine, openSqlJsEngine, type Engine, type EngineName } from "../prototype/candidateEngine";
import { LIMITS } from "../prototype/types";
import { candidateWithDebrief, clock, expectCode, observation, tempDir, uuid } from "./helpers";

const engines: EngineName[] = ["node:sqlite", "sql.js"];
const open: Engine[] = [];
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const e of open.splice(0)) e.close();
  for (const c of cleanups.splice(0)) c();
});

async function setup(name: EngineName) {
  const ctx = await candidateWithDebrief(name);
  open.push(ctx.engine);
  return ctx;
}

const count = (e: Engine, table: string) => Number(e.query(`SELECT COUNT(*) AS n FROM ${table}`)[0]!["n"]);

describe.each(engines)("creation and retries (%s)", (name) => {
  it("a retried create writes one observation and replays the same result", async () => {
    const { store, engine, journalId } = await setup(name);
    const request = observation("builtin.normal_landing", journalId);
    const first = await store.act(request);
    const again = await store.act(structuredClone(request));
    expect(first).toEqual({ status: "applied", result: { action: "create_observation", observationId: request.observationId, revision: 1 } });
    expect(again).toEqual({ status: "replayed", result: first.result });
    expect(count(engine, "skill_observations")).toBe(1);
    expect(count(engine, "skill_observation_revisions")).toBe(1);
    expect(count(engine, "skill_evidence_operations")).toBe(1);
  });

  it("the same request id with different content is refused and changes nothing", async () => {
    const { store, engine, journalId } = await setup(name);
    const request = observation("builtin.normal_landing", journalId);
    await store.act(request);
    const before = engine.query("SELECT * FROM skill_observations");
    await expectCode(store.act({ ...request, wording: "Something else." }), "OPERATION_CONFLICT");
    expect(engine.query("SELECT * FROM skill_observations")).toEqual(before);
  });

  it("a replay after later edits returns the original result and never undoes the edit", async () => {
    const { store, journalId } = await setup(name);
    const request = observation("builtin.normal_landing", journalId);
    await store.act(request);
    await store.act({
      action: "edit_observation", operationId: uuid(), observationId: request.observationId, expectedRevision: 1,
      wording: "Eyes to the far end of the runway.", observedOn: "2026-10-01", attribution: "instructor_transcribed", instructorName: "Synthetic CFI",
    });
    const replay = await store.act(request);
    expect(replay.status).toBe("replayed");
    const [item] = (await store.page()).items;
    expect(item!.wording).toBe("Eyes to the far end of the runway.");
    expect(item!.revision).toBe(2);
  });

  it("two distinct requests issued together both land, in order", async () => {
    const { store, engine, journalId } = await setup(name);
    const a = observation("builtin.normal_landing", journalId);
    const b = observation("builtin.crosswind_landing", journalId, { attribution: "self_report", instructorName: "", sourceField: "was_difficult", wording: "Gusts pushed me off centerline." });
    const results = await Promise.all([store.act(a), store.act(b)]);
    expect(results.map((r) => r.status)).toEqual(["applied", "applied"]);
    expect(count(engine, "skill_observations")).toBe(2);
  });

  it("a double-clicked edit with one expected revision applies once; the second is stale", async () => {
    const { store, journalId } = await setup(name);
    const request = observation("builtin.normal_landing", journalId);
    await store.act(request);
    const edit = (wording: string) => ({
      action: "edit_observation" as const, operationId: uuid(), observationId: request.observationId, expectedRevision: 1,
      wording, observedOn: "2026-10-01", attribution: "instructor_transcribed" as const, instructorName: "Synthetic CFI",
    });
    const [first, second] = await Promise.allSettled([store.act(edit("First edit.")), store.act(edit("Second edit."))]);
    expect(first.status).toBe("fulfilled");
    expect(second.status === "rejected" && (second.reason as { code: string }).code).toBe("STALE_REVISION");
    expect((await store.page()).items[0]!.wording).toBe("First edit.");
  });
});

describe("reopening a saved library", () => {
  it("node:sqlite: an observation survives close and reopen, and a retry after reopen is still a replay", async () => {
    const t = tempDir("m3-reopen-");
    cleanups.push(t.cleanup);
    const path = join(t.dir, "library.db");
    const first = await openNodeEngine(path);
    const store = await openCandidateStore(first);
    first.exec(`INSERT INTO journal_entries (id, date, title, instructor_feedback, created_at, updated_at) VALUES ('j', '2026-10-01', 'L', 'Flare later.', 'x', 'x')`);
    const request = observation("builtin.normal_landing", "j", { wording: "Flare later." });
    await store.act(request);
    first.close();
    const reopened = await openNodeEngine(path);
    open.push(reopened);
    const again = await openCandidateStore(reopened);
    expect((await again.act(request)).status).toBe("replayed");
    expect((await again.page()).items.map((i) => i.wording)).toEqual(["Flare later."]);
  });

  it("sql.js: the exported bytes reopen with the same observation and receipt", async () => {
    const { store, engine, journalId } = await setup("sql.js");
    const request = observation("builtin.go_around", journalId);
    await store.act(request);
    const reopened = await openSqlJsEngine(engine.snapshot());
    open.push(reopened);
    const again = await openCandidateStore(reopened);
    expect((await again.act(request)).status).toBe("replayed");
    expect(count(reopened, "skill_observations")).toBe(1);
  });
});

describe.each(engines)("edits and history (%s)", (name) => {
  it("editing wording, date and attribution keeps every earlier version", async () => {
    const { store, journalId } = await setup(name);
    const c = clock();
    const request = observation("builtin.normal_landing", journalId, { attribution: "self_report", instructorName: "", sourceField: "none", wording: "I flared too high." });
    await store.act(request, { now: c.now });
    c.advance();
    await store.act({
      action: "edit_observation", operationId: uuid(), observationId: request.observationId, expectedRevision: 1,
      wording: "Flare started too high, about ten feet.", observedOn: "2026-10-02", attribution: "instructor_transcribed", instructorName: "Synthetic CFI",
    }, { now: c.now });
    const history = await store.history(request.observationId);
    expect(history.map((h) => [h.revision, h.changeKind, h.wording, h.observedOn, h.attribution, h.instructorName])).toEqual([
      [2, "edited", "Flare started too high, about ten feet.", "2026-10-02", "instructor_transcribed", "Synthetic CFI"],
      [1, "created", "I flared too high.", "2026-10-01", "self_report", ""],
    ]);
    expect(history[0]!.recordedAt > history[1]!.recordedAt).toBe(true);
  });

  it("a stale edit, a no-op edit and an edit of a missing observation are refused", async () => {
    const { store, journalId } = await setup(name);
    const request = observation("builtin.normal_landing", journalId);
    await store.act(request);
    const base = { action: "edit_observation" as const, observationId: request.observationId, observedOn: "2026-10-01", attribution: "instructor_transcribed" as const, instructorName: "Synthetic CFI" };
    await expectCode(store.act({ ...base, operationId: uuid(), expectedRevision: 7, wording: "New." }), "STALE_REVISION");
    await expectCode(store.act({ ...base, operationId: uuid(), expectedRevision: 1, wording: request.wording }), "INVALID_ARGUMENT");
    await expectCode(store.act({ ...base, operationId: uuid(), observationId: uuid(), expectedRevision: 1, wording: "New." }), "NOT_FOUND");
  });

  it("history rows cannot be rewritten, even with direct SQL", async () => {
    const { store, engine, journalId } = await setup(name);
    const request = observation("builtin.normal_landing", journalId);
    await store.act(request);
    expect(() => engine.exec("UPDATE skill_observation_revisions SET wording = 'rewritten'")).toThrow(/append-only/);
    expect(() => engine.exec("DELETE FROM skill_observation_revisions")).toThrow(/only be erased with its observation/);
    expect(() => engine.exec("UPDATE skill_catalog_revisions SET label = 'x'")).toThrow(/append-only/);
  });
});

describe.each(engines)("sources and skills that change (%s)", (name) => {
  it("a renamed debrief and edited feedback are shown as drift; nothing is relinked", async () => {
    const { store, engine, journalId } = await setup(name);
    await store.act(observation("builtin.normal_landing", journalId));
    engine.run("UPDATE journal_entries SET title = 'Renamed lesson', instructor_feedback = 'Different words now.' WHERE id = ?", [journalId]);
    const [item] = (await store.page()).items;
    expect(item!.source).toMatchObject({ kind: "present", currentTitle: "Renamed lesson", renamed: true, textChanged: true });
    expect(item!.sourceSnapshot).toEqual({ title: "Pattern work", date: "2026-10-01", field: "instructor_feedback" });
    expect(item!.wording).toBe("Look further down the runway in the flare.");
  });

  it("deleting the debrief keeps the observation, its wording and the snapshot; a replacement debrief is not adopted", async () => {
    const { store, engine, journalId } = await setup(name);
    const request = observation("builtin.normal_landing", journalId);
    await store.act(request);
    engine.run("DELETE FROM journal_entries WHERE id = ?", [journalId]);
    engine.run("INSERT INTO journal_entries (id, date, title, created_at, updated_at) VALUES (?, '2026-10-01', 'Pattern work', 'x', 'x')", [uuid()]);
    const [item] = (await store.page()).items;
    expect(item!.source).toEqual({ kind: "deleted", sourceJournalId: journalId });
    expect(item!.sourceSnapshot.title).toBe("Pattern work");
    expect(item!.wording).toBe(request.wording);
    await store.validate();
    await expectCode(store.act(observation("builtin.normal_landing", journalId)), "SOURCE_MISSING");
  });

  it("a retired skill keeps its history, refuses new observations, and can be restored", async () => {
    const { store, journalId } = await setup(name);
    await store.act(observation("builtin.go_around", journalId));
    await store.act({ action: "retire_skill", operationId: uuid(), skillId: "builtin.go_around", expectedRevision: 1 });
    expect((await store.skills()).some((s) => s.id === "builtin.go_around")).toBe(false);
    expect((await store.skills({ includeRetired: true })).find((s) => s.id === "builtin.go_around")?.retired).toBe(true);
    const [item] = (await store.page({ skillId: "builtin.go_around" })).items;
    expect(item!.skillRetired).toBe(true);
    await expectCode(store.act(observation("builtin.go_around", journalId)), "SKILL_RETIRED");
    await store.act({ action: "restore_skill", operationId: uuid(), skillId: "builtin.go_around", expectedRevision: 2 });
    expect((await store.act(observation("builtin.go_around", journalId))).status).toBe("applied");
  });

  it("renaming a custom skill keeps the name it had when each observation was recorded", async () => {
    const { store, journalId } = await setup(name);
    const skillId = `custom.${uuid()}`;
    await store.act({ action: "create_custom_skill", operationId: uuid(), skillId, label: "Short-field landing", description: "", topic: "landings" });
    await store.act(observation(skillId, journalId));
    await store.act({ action: "edit_custom_skill", operationId: uuid(), skillId, expectedRevision: 1, label: "Short-field approach and landing", description: "", topic: "landings" });
    const [item] = (await store.page({ skillId })).items;
    expect([item!.skillLabel, item!.skillLabelAtRecording]).toEqual(["Short-field approach and landing", "Short-field landing"]);
  });

  it("built-in names are read-only, active duplicate names are refused, retired duplicates are allowed", async () => {
    const { store } = await setup(name);
    await expectCode(
      store.act({ action: "edit_custom_skill", operationId: uuid(), skillId: "builtin.go_around", expectedRevision: 1, label: "Go around", description: "", topic: "landings" }),
      "BUILTIN_READ_ONLY",
    );
    await expectCode(
      store.act({ action: "create_custom_skill", operationId: uuid(), skillId: `custom.${uuid()}`, label: "  go-AROUND ", description: "", topic: "landings" }),
      "DUPLICATE_LABEL",
    );
    await store.act({ action: "retire_skill", operationId: uuid(), skillId: "builtin.go_around", expectedRevision: 1 });
    const id = `custom.${uuid()}`;
    expect((await store.act({ action: "create_custom_skill", operationId: uuid(), skillId: id, label: "Go-around", description: "", topic: "landings" })).status).toBe("applied");
    // Restoring the built-in would now duplicate an active name.
    await expectCode(store.act({ action: "restore_skill", operationId: uuid(), skillId: "builtin.go_around", expectedRevision: 2 }), "DUPLICATE_LABEL");
  });

  it("skills are never deleted", async () => {
    const { engine } = await setup(name);
    expect(() => engine.exec("DELETE FROM skill_catalog_entries WHERE id = 'builtin.go_around'")).toThrow();
  });
});

describe.each(engines)("no manufactured approval or proficiency (%s)", (name) => {
  it("there is no verified-instructor attribution, at the boundary or in the table", async () => {
    const { store, engine, journalId } = await setup(name);
    await expectCode(store.act({ ...observation("builtin.go_around", journalId), attribution: "instructor_verified" } as never), "INVALID_ARGUMENT");
    await expectCode(store.act(observation("builtin.go_around", journalId, { attribution: "self_report" })), "INVALID_ARGUMENT"); // a name on a self-report
    expect(() =>
      engine.exec(`INSERT INTO skill_observations (id, skill_id, skill_label_snapshot, source_journal_id, source_journal_date, source_journal_title,
        source_field, attribution, wording, observed_on, revision, created_at, updated_at)
        VALUES ('x', 'builtin.go_around', 'Go-around', 'j', '2026-10-01', 'L', 'none', 'instructor_verified', 'w', '2026-10-01', 1, 'x', 'x')`),
    ).toThrow(/CHECK/);
  });

  it("completing the linked action, finishing practice or adding observations never sets status, confidence or addressed", async () => {
    const { store, engine, journalId, actionId } = await setup(name);
    const request = observation("builtin.normal_landing", journalId);
    await store.act(request);
    await store.act({ action: "link_action", operationId: uuid(), observationId: request.observationId, expectedRevision: 1, actionId });
    for (let i = 0; i < 4; i++) await store.act(observation("builtin.normal_landing", journalId, { wording: `Landing note ${i}.`, sourceField: "none" }));
    engine.run("UPDATE next_actions SET status = 'completed', completed_at = 'x' WHERE id = ?", [actionId]);
    const summary = (await store.summary("builtin.normal_landing"))!;
    expect(summary).toMatchObject({ status: null, confidence: null, observationCount: 5, evidence: "limited" });
    expect(Object.keys(summary).some((k) => /proficien|ready|endorse|sign|verified|mastery|score/i.test(k))).toBe(false);
    const item = (await store.page()).items.find((i) => i.id === request.observationId)!;
    expect(item.action).toMatchObject({ kind: "linked", actionStatus: "completed" });
    expect(item.addressedAt).toBeNull();
  });

  it("status and confidence are separate, explicit and stale-checked", async () => {
    const { store } = await setup(name);
    await store.act({ action: "set_status", operationId: uuid(), skillId: "builtin.steep_turns", expectedSequence: 0, status: "practicing" });
    await store.act({ action: "set_confidence", operationId: uuid(), skillId: "builtin.steep_turns", expectedSequence: 0, confidence: 2 });
    await expectCode(store.act({ action: "set_status", operationId: uuid(), skillId: "builtin.steep_turns", expectedSequence: 0, status: "needs_review" }), "STALE_REVISION");
    await store.act({ action: "set_status", operationId: uuid(), skillId: "builtin.steep_turns", expectedSequence: 1, status: null });
    expect(await store.summary("builtin.steep_turns")).toMatchObject({ status: null, statusSequence: 2, confidence: 2, confidenceSequence: 1, evidence: "none" });
    await expectCode(store.act({ action: "set_confidence", operationId: uuid(), skillId: "builtin.steep_turns", expectedSequence: 1, confidence: 6 }), "INVALID_ARGUMENT");
  });
});

describe.each(engines)("follow-up actions (%s)", (name) => {
  it("link and mark-addressed are explicit, idempotent, recorded in history, and never change the action", async () => {
    const { store, engine, journalId, actionId } = await setup(name);
    const request = observation("builtin.normal_landing", journalId);
    await store.act(request);
    const actionBefore = engine.query("SELECT * FROM next_actions WHERE id = ?", [actionId]);
    const link = { action: "link_action" as const, operationId: uuid(), observationId: request.observationId, expectedRevision: 1, actionId };
    await store.act(link);
    expect((await store.act(link)).status).toBe("replayed");
    const mark = { action: "set_addressed" as const, operationId: uuid(), observationId: request.observationId, expectedRevision: 2, addressed: true };
    await store.act(mark);
    expect((await store.act(mark)).status).toBe("replayed");
    expect(engine.query("SELECT * FROM next_actions WHERE id = ?", [actionId])).toEqual(actionBefore);
    expect((await store.history(request.observationId)).map((h) => h.changeKind)).toEqual(["marked_addressed", "linked_action", "created"]);
    await expectCode(store.act({ ...mark, operationId: uuid(), expectedRevision: 3 }), "INVALID_ARGUMENT");
  });

  it("deleting the linked action keeps a named record of it; linking a missing action is refused", async () => {
    const { store, engine, journalId, actionId } = await setup(name);
    const request = observation("builtin.normal_landing", journalId);
    await store.act(request);
    await store.act({ action: "link_action", operationId: uuid(), observationId: request.observationId, expectedRevision: 1, actionId });
    engine.run("DELETE FROM next_actions WHERE id = ?", [actionId]);
    const [item] = (await store.page()).items;
    expect(item!.action).toEqual({ kind: "deleted", formerActionId: actionId, formerTitle: "Review flare timing" });
    await store.validate();
    await expectCode(store.act({ action: "link_action", operationId: uuid(), observationId: request.observationId, expectedRevision: 2, actionId: uuid() }), "NOT_FOUND");
    await store.act({ action: "unlink_action", operationId: uuid(), observationId: request.observationId, expectedRevision: 2 });
    expect((await store.page()).items[0]!.action).toEqual({ kind: "none" });
  });
});

describe.each(engines)("explicit erasure (%s)", (name) => {
  it("erases only the selected observation and leaves no wording behind anywhere in the database", async () => {
    const { store, engine, journalId } = await setup(name);
    const secret = "Unique synthetic wording to erase 7f3a.";
    const keep = observation("builtin.normal_landing", journalId);
    const gone = observation("builtin.go_around", journalId, { wording: secret, sourceField: "none" });
    await store.act(keep);
    await store.act(gone);
    await store.act({ action: "edit_observation", operationId: uuid(), observationId: gone.observationId, expectedRevision: 1, wording: `${secret} edited`, observedOn: "2026-10-01", attribution: "instructor_transcribed", instructorName: "Synthetic CFI" });
    const journalBefore = engine.query("SELECT * FROM journal_entries");
    await store.act({ action: "erase_observation", operationId: uuid(), observationId: gone.observationId, confirm: "erase" });

    expect((await store.page()).items.map((i) => i.id)).toEqual([keep.observationId]);
    expect(engine.query("SELECT * FROM journal_entries")).toEqual(journalBefore);
    const tables = engine.query("SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => String(r["name"]));
    for (const table of tables) {
      const hits = engine.query(`SELECT * FROM "${table}"`).filter((row) => JSON.stringify(row).includes("7f3a"));
      expect(hits, table).toEqual([]);
    }
    const receipts = engine.query("SELECT operation_id, action, is_erased, result_json FROM skill_evidence_operations WHERE subject_id = ? ORDER BY action", [gone.observationId]);
    expect(receipts.map((r) => [r["action"], r["is_erased"], r["result_json"] === null])).toEqual([
      ["create_observation", 1, true],
      ["edit_observation", 1, true],
      ["erase_observation", 0, false],
    ]);
    await store.validate();
  });

  it("an old retry cannot resurrect an erased observation, and its id cannot be reused", async () => {
    const { store, journalId } = await setup(name);
    const request = observation("builtin.go_around", journalId);
    await store.act(request);
    const erase = { action: "erase_observation" as const, operationId: uuid(), observationId: request.observationId, confirm: "erase" as const };
    await store.act(erase);
    await expectCode(store.act(request), "ERASED");
    await expectCode(store.act({ ...request, operationId: uuid() }), "ERASED");
    expect((await store.act(erase)).status).toBe("replayed");
    expect((await store.page()).items).toEqual([]);
  });

  it("erasing needs explicit confirmation", async () => {
    const { store, journalId } = await setup(name);
    const request = observation("builtin.go_around", journalId);
    await store.act(request);
    await expectCode(store.act({ action: "erase_observation", operationId: uuid(), observationId: request.observationId, confirm: "yes" } as never), "INVALID_ARGUMENT");
  });
});

describe.each(engines)("all-or-nothing writes (%s)", (name) => {
  for (const failing of ["INSERT INTO skill_observation_revisions", "INSERT INTO skill_evidence_operations", "UPDATE skill_observations"]) {
    it(`a failure at "${failing}" leaves no partial change`, async () => {
      const { store, engine, journalId } = await setup(name);
      const created = observation("builtin.normal_landing", journalId);
      if (failing.startsWith("UPDATE")) await store.act(created);
      const before = ["skill_observations", "skill_observation_revisions", "skill_evidence_operations"].map((t) => engine.query(`SELECT * FROM ${t}`));
      engine.beforeStatement = (sql) => {
        if (sql.includes(failing)) throw new Error("injected storage failure");
      };
      const request = failing.startsWith("UPDATE")
        ? { action: "edit_observation" as const, operationId: uuid(), observationId: created.observationId, expectedRevision: 1, wording: "Changed.", observedOn: "2026-10-01", attribution: "instructor_transcribed" as const, instructorName: "Synthetic CFI" }
        : created;
      await expectCode(store.act(request), "STORAGE_FAILURE");
      engine.beforeStatement = undefined;
      const after = ["skill_observations", "skill_observation_revisions", "skill_evidence_operations"].map((t) => engine.query(`SELECT * FROM ${t}`));
      expect(after).toEqual(before);
      // The same request then succeeds normally: the failure left no receipt to replay.
      expect((await store.act(request)).status).toBe("applied");
    });
  }
});

describe.each(engines)("limits at the write boundary (%s)", (name) => {
  it("wording: 2000 characters is accepted, 2001 refused; empty and control characters refused", async () => {
    const { store, journalId } = await setup(name);
    const ok = "a".repeat(LIMITS.wordingCodePoints);
    expect((await store.act(observation("builtin.go_around", journalId, { wording: ok, sourceField: "none" }))).status).toBe("applied");
    await expectCode(store.act(observation("builtin.go_around", journalId, { wording: `${ok}a` })), "LIMIT_EXCEEDED");
    await expectCode(store.act(observation("builtin.go_around", journalId, { wording: "   " })), "INVALID_ARGUMENT");
    await expectCode(store.act(observation("builtin.go_around", journalId, { wording: "bad\u0000text" })), "INVALID_ARGUMENT");
    // 2000 four-byte characters is exactly the 8000-byte bound.
    expect((await store.act(observation("builtin.go_around", journalId, { wording: "😀".repeat(2000), sourceField: "none" }))).status).toBe("applied");
  });

  it("dates, ids and extra fields are refused before any transaction", async () => {
    const { store, engine, journalId } = await setup(name);
    await expectCode(store.act(observation("builtin.go_around", journalId, { observedOn: "2026-02-30" })), "INVALID_ARGUMENT");
    await expectCode(store.act(observation("builtin.go_around", journalId, { operationId: "not-a-uuid" })), "INVALID_ARGUMENT");
    await expectCode(store.act({ ...observation("builtin.go_around", journalId), verified: true } as never), "INVALID_ARGUMENT");
    await expectCode(store.act(observation("builtin.unknown_skill", journalId)), "NOT_FOUND");
    expect(count(engine, "skill_evidence_operations")).toBe(0);
  });

  it("one debrief holds at most 50 observations; a library at most 200 custom skills", async () => {
    const { store, engine, journalId } = await setup(name);
    for (let i = 0; i < LIMITS.observationsPerDebrief; i++) {
      await store.act(observation("builtin.go_around", journalId, { wording: `Note ${i}`, sourceField: "none" }));
    }
    await expectCode(store.act(observation("builtin.go_around", journalId, { sourceField: "none" })), "LIMIT_EXCEEDED");
    for (let i = 0; i < LIMITS.customSkills; i++) {
      engine.run(
        "INSERT INTO skill_catalog_entries (id, origin, catalog_version, label, description, topic, status, revision, created_at, updated_at, retired_at) VALUES (?, 'custom', NULL, ?, '', 'general', 'retired', 1, 'x', 'x', 'x')",
        [`custom.${uuid()}`, `Filler ${i}`],
      );
    }
    await expectCode(
      store.act({ action: "create_custom_skill", operationId: uuid(), skillId: `custom.${uuid()}`, label: "One more", description: "", topic: "general" }),
      "LIMIT_EXCEEDED",
    );
  });

  it("page size is bounded at the read boundary and a forged cursor is refused", async () => {
    const { store } = await setup(name);
    await expectCode(store.page({ limit: LIMITS.pageMax + 1 }), "LIMIT_EXCEEDED");
    await expectCode(store.page({ limit: 0 }), "LIMIT_EXCEEDED");
    await expectCode(store.page({ cursor: "{\"o\":1}" }), "INVALID_ARGUMENT");
    await expectCode(store.page({ cursor: JSON.stringify(["2026-13-01", "x", "y"]) }), "INVALID_ARGUMENT");
  });
});

it("both engines are the real ones", async () => {
  const node = await openEngine("node:sqlite");
  const wasm = await openEngine("sql.js");
  open.push(node, wasm);
  const version = (e: Engine) => String(e.query("SELECT sqlite_version() AS v")[0]!["v"]);
  expect(version(node)).toMatch(/^3\./);
  expect(version(wasm)).toMatch(/^3\./);
  console.log(`engines: node:sqlite ${version(node)}, sql.js ${version(wasm)}`);
});
