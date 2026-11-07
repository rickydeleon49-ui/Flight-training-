import { describe, expect, it } from "vitest";

import type { GeminiJobRecord } from "@/services/gemini";
import {
  IllegalMove, KIT_QUEUE_TEXT, canMove, consentValid, isPartialKit, kitEnd, kitRecords, looksRateLimited, moveItem, slotsFull, slotsHeld, type ItemStatus, type QueueItem,
} from "./kitQueueLogic";

const ALL: ItemStatus[] = ["waiting", "running", "checkpointed", "saved", "partial", "unclear", "skipped", "failed"];
const LEGAL: Record<string, string[]> = {
  waiting: ["running", "skipped"],
  running: ["checkpointed", "partial", "unclear", "failed", "waiting"],
  checkpointed: ["saved", "partial"],
  partial: ["saved", "waiting"],
  unclear: ["waiting"],
  failed: ["waiting"],
  skipped: [],
  saved: [],
};
const item = (status: ItemStatus): QueueItem => ({ position: 0, materialId: "m", sourceSha256: "s", status, requestId: null, jobId: null, updatedAt: "t" });

describe("kit queue state machine", () => {
  it("allows the main path waiting -> running -> checkpointed -> saved", () => {
    let current = item("waiting");
    for (const next of ["running", "checkpointed", "saved"] as const) current = moveItem(current, next, {}, "t2");
    expect(current.status).toBe("saved");
  });
  it("rejects every illegal move", () => {
    for (const from of ALL) for (const to of ALL) {
      const legal = LEGAL[from]!.includes(to);
      expect(canMove(from, to), `${from} -> ${to}`).toBe(legal);
      if (!legal) expect(() => moveItem(item(from), to, {}, "t")).toThrow(IllegalMove);
    }
  });
});

describe("kit queue rules", () => {
  it("consent is bound to the provider and the exact chapter set", () => {
    const consent = { provider: "Google", materialIds: ["a", "b"] };
    expect(consentValid(consent, { provider: "Google", materialIds: ["b", "a"] })).toBe(true);
    expect(consentValid(consent, { provider: "Anthropic", materialIds: ["a", "b"] })).toBe(false);
    expect(consentValid(consent, { provider: "Google", materialIds: ["a"] })).toBe(false);
    expect(consentValid(null, { provider: "Google", materialIds: ["a"] })).toBe(false);
  });
  it("counts the slots that hold a draft, not failed records with nothing to keep", () => {
    const rec = (stage: GeminiJobRecord["stage"], draft?: unknown) => ({ id: `${Math.random()}`, stage, draft }) as unknown as GeminiJobRecord;
    const eight = Array.from({ length: 8 }, () => rec("ready"));
    expect(slotsFull(eight)).toBe(true);
    expect(slotsHeld([...eight.slice(0, 7), rec("failed")])).toBe(7);
    expect(slotsHeld([...eight.slice(0, 7), rec("failed", { kind: "x" })])).toBe(8);
  });
  it("counts one slot per journal job, however many review parts it is listed as (gemini_jobs.rs MAX_JOBS)", () => {
    const parts = (job: string, ...names: string[]) => names.map((part) => ({ id: `${job}#${part}`, stage: part === "cards" ? "failed" : "ready", draft: { kind: "study-kit-part" } }) as unknown as GeminiJobRecord);
    const three = ["a", "b", "c"].flatMap((job) => parts(job, "guide", "cards", "questions"));
    expect(three).toHaveLength(9);
    expect(slotsHeld(three)).toBe(3);
    expect(slotsFull(three)).toBe(false);
    const eight = Array.from({ length: 8 }, (_, i) => parts(`k${i}`, "guide", "cards")).flat();
    expect(slotsFull(eight)).toBe(true);
  });
  it("finds a kit by what survives in the native listing, and reads partial from the review parts", () => {
    const at = Date.parse("2026-11-07T10:00:00.000Z") / 1000;
    const part = (job: string, name: string, ok: boolean, createdAt = at) => ({
      id: `${job}#${name}`, requestId: `study-kit:${job}`, materialId: "m", contentSha256: "s", stage: ok ? "ready" : "failed", createdAt, draft: { kind: "study-kit-part" },
    }) as unknown as GeminiJobRecord;
    const records = [part("old", "guide", true, at - 60), part("new", "guide", true), part("new", "cards", false)];
    const running = { requestId: "req-gone", jobId: null, materialId: "m", sourceSha256: "s" };
    expect(kitRecords(records, running, "2026-11-07T10:00:00.000Z").map((r) => r.id)).toEqual(["new#guide", "new#cards"]);
    expect(kitRecords(records, { ...running, sourceSha256: "other" }, "2026-11-07T10:00:00.000Z")).toEqual([]);
    expect(kitRecords(records, { requestId: null, jobId: "old" }).map((r) => r.id)).toEqual(["old#guide"]);
    expect(kitEnd(kitRecords(records, running, "2026-11-07T10:00:00.000Z"))).toBe("partial");
    expect(kitEnd([part("x", "guide", true), part("x", "cards", true), part("x", "questions", true)])).toBe("whole");
    expect(kitEnd([part("x", "guide", false), part("x", "cards", false), part("x", "questions", false)])).toBe("empty");
    // A saved part has left the listing: what is left failed, so the kit is partly done.
    expect(kitEnd([part("x", "cards", false)])).toBe("partial");
  });
  it("tells a partial kit from a whole or empty one", () => {
    expect(isPartialKit({ guide: { answer: 1 }, cards: { error: "no" } })).toBe(true);
    expect(isPartialKit({ guide: { answer: 1 }, cards: { answer: 1 } })).toBe(false);
    expect(isPartialKit({ guide: { error: "a" }, cards: { error: "b" } })).toBe(false);
    expect(isPartialKit(undefined)).toBe(false);
  });
  it("recognises the rate limit message", () => {
    expect(looksRateLimited("Gemini's rate or spending limit was reached for this project.")).toBe(true);
    expect(looksRateLimited("The connection dropped.")).toBe(false);
  });
  it("says the student's lines in short, plain words with no she/her", () => {
    const lines = [
      KIT_QUEUE_TEXT.skipped, KIT_QUEUE_TEXT.slotsFull, KIT_QUEUE_TEXT.notKept("X"), KIT_QUEUE_TEXT.rateLimit, KIT_QUEUE_TEXT.unclear("X"),
      KIT_QUEUE_TEXT.busy, KIT_QUEUE_TEXT.consentStale, KIT_QUEUE_TEXT.restart, KIT_QUEUE_TEXT.progress(3, 9, "X"), KIT_QUEUE_TEXT.billed("Google"),
    ];
    for (const line of lines) expect(line).not.toMatch(/\b(she|her|hers|herself)\b/i);
    expect(KIT_QUEUE_TEXT.progress(3, 9, "Airspace")).toBe("Making kit 3 of 9: Airspace");
    expect(KIT_QUEUE_TEXT.skipped).toBe("This chapter changed. Make it again from its page.");
    expect(KIT_QUEUE_TEXT.slotsFull).toBe("Save or dismiss your finished chapters to continue");
    expect(KIT_QUEUE_TEXT.notKept("Airspace")).toBe("Your finished kit for Airspace has not been kept yet. Save or keep this window open.");
  });
});
