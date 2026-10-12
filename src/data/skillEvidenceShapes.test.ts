/**
 * The strict desktop adapters for skill evidence: only an allowlisted native
 * refusal with its fixed message, or a result of exactly the expected shape
 * for the request sent, is accepted. Everything else is STORAGE_FAILURE (an
 * unknown outcome the controller resolves before sending anything new).
 */
import { describe, expect, it } from "vitest";

import type { EvidencePage, SkillEvidenceAction } from "@/domain/types";

import {
  SKILL_EVIDENCE_ERROR_MESSAGES,
  invokeListSkills,
  invokeReadObservationHistory,
  invokeReadSkillEvidencePage,
  invokeReadSkillSummary,
  invokeSkillEvidenceAction,
  isEvidencePage,
  isObservationHistoryPageFor,
  isSkillList,
  isSkillSummaryFor,
} from "./skillEvidenceShapes";
import { SkillEvidenceError } from "./skillEvidenceTransaction";
import { readFixture } from "./testing/skillEvidenceEngines";

const OBS = "20000000-0000-4000-8000-000000000001";
const create: SkillEvidenceAction = {
  action: "create_observation",
  operationId: "10000000-0000-4000-8000-000000000001",
  observationId: OBS,
  skillId: "builtin.normal_landing",
  journalId: "j1",
  sourceField: "none",
  wording: "Flare later.",
  observedOn: "2026-10-01",
  attribution: "self_report",
  instructorName: "",
};

const answer = (value: unknown) => async () => value;
const reject = (value: unknown) => async () => {
  throw value;
};
const codeOf = (promise: Promise<unknown>) =>
  promise.then(
    () => "accepted",
    (error: unknown) => (error instanceof SkillEvidenceError ? error.code : "unexpected"),
  );

describe("write adapter", () => {
  it("accepts exactly the result of the request sent, applied or replayed", async () => {
    const result = { action: "create_observation", observationId: OBS, revision: 1 };
    expect(await invokeSkillEvidenceAction(create, answer({ status: "applied", result }))).toEqual({ status: "applied", result });
    expect(await invokeSkillEvidenceAction(create, answer({ status: "replayed", result }))).toEqual({ status: "replayed", result });
  });

  it("an answer that does not describe this request is never an acknowledgment", async () => {
    for (const value of [
      { status: "applied", result: { action: "create_observation", observationId: "20000000-0000-4000-8000-000000000002", revision: 1 } },
      { status: "applied", result: { action: "edit_observation", observationId: OBS, revision: 2 } },
      { status: "applied", result: { action: "create_observation", observationId: OBS, revision: 2 } },
      { status: "applied", result: { action: "create_observation", observationId: OBS, revision: 1, extra: true } },
      { status: "saved", result: { action: "create_observation", observationId: OBS, revision: 1 } },
      { status: "applied" },
      null,
      "ok",
    ]) {
      expect(await codeOf(invokeSkillEvidenceAction(create, answer(value)))).toBe("STORAGE_FAILURE");
    }
  });

  it("a native refusal keeps its code only with its fixed message", async () => {
    for (const [code, message] of Object.entries(SKILL_EVIDENCE_ERROR_MESSAGES)) {
      expect(await codeOf(invokeSkillEvidenceAction(create, reject({ code, message })))).toBe(code);
      expect(await codeOf(invokeSkillEvidenceAction(create, reject({ code, message: "SQLITE_BUSY: database is locked" })))).toBe(
        "STORAGE_FAILURE",
      );
    }
    expect(await codeOf(invokeSkillEvidenceAction(create, reject(new Error("IPC closed"))))).toBe("STORAGE_FAILURE");
    expect(await codeOf(invokeSkillEvidenceAction(create, reject({ code: "VERIFIED", message: "x" })))).toBe("STORAGE_FAILURE");
  });

  it("sends the request as the operation argument of save_skill_evidence_action", async () => {
    const calls: unknown[] = [];
    await invokeSkillEvidenceAction(create, async (command, args) => {
      calls.push([command, args]);
      return { status: "applied", result: { action: "create_observation", observationId: OBS, revision: 1 } };
    });
    expect(calls).toEqual([["save_skill_evidence_action", { operation: create }]]);
  });
});

describe("read adapters", () => {
  const reads = readFixture<{ reads: { kind: string; input: Record<string, unknown>; output: unknown }[] }>("read-cases.json").reads;

  it("every successful read in the shared read contract passes its shape check", () => {
    for (const read of reads) {
      if ((read.output as { code?: string } | null)?.code) continue;
      const ok =
        read.kind === "page" ? isEvidencePage(read.output)
        : read.kind === "summary" ? isSkillSummaryFor(String(read.input["skillId"]), read.output)
        : read.kind === "skills" ? isSkillList(read.output)
        : isObservationHistoryPageFor(String(read.input["observationId"]), read.output);
      expect(ok, `${read.kind} ${JSON.stringify(read.input)}`).toBe(true);
    }
  });

  it("refuses a page with an extra key, a widened attribution or too many items", async () => {
    const page = reads.find((r) => r.kind === "page" && (r.output as EvidencePage).items?.length)!.output as EvidencePage;
    const item = page.items[0]!;
    for (const bad of [
      { ...page, total: 1 },
      { ...page, items: [{ ...item, attribution: "verified_instructor" }] },
      { ...page, items: [{ ...item, verified: true }] },
      { ...page, items: Array.from({ length: 51 }, () => item) },
      { ...page, items: [{ ...item, revision: 0 }] },
    ]) {
      expect(await codeOf(invokeReadSkillEvidencePage({}, answer(bad)))).toBe("STORAGE_FAILURE");
    }
    expect(await invokeReadSkillEvidencePage({}, answer(page))).toEqual(page);
  });

  it("a summary or history for another subject is refused", async () => {
    const summary = reads.find((r) => r.kind === "summary" && r.output)!;
    expect(await codeOf(invokeReadSkillSummary("builtin.go_around", answer(summary.output)))).toBe(
      summary.input["skillId"] === "builtin.go_around" ? "accepted" : "STORAGE_FAILURE",
    );
    expect(await invokeReadSkillSummary("builtin.no_such_skill", answer(null))).toBeNull();
    const history = reads.find((r) => r.kind === "history" && (r.output as { items?: unknown[] }).items)!;
    expect(await codeOf(invokeReadObservationHistory({ observationId: "20000000-0000-4000-8000-0000000000aa" }, answer(history.output)))).toBe(
      "STORAGE_FAILURE",
    );
    expect(await codeOf(invokeListSkills({}, answer([{ id: "x" }])))).toBe("STORAGE_FAILURE");
    expect(await codeOf(invokeReadSkillEvidencePage({}, reject({ code: "STALE_CURSOR", message: SKILL_EVIDENCE_ERROR_MESSAGES.STALE_CURSOR })))).toBe(
      "STALE_CURSOR",
    );
  });
});
