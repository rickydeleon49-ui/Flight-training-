import { describe, expect, it } from "vitest";

import type { GeminiJobRecord } from "@/services/gemini";
import {
  IllegalMove, KIT_QUEUE_TEXT, canMove, consentValid, isPartialKit, looksRateLimited, moveItem, slotsFull, slotsHeld, type ItemStatus, type QueueItem,
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
