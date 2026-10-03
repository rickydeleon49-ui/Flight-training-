/**
 * Codex's two independent diagnostic sets from the contract reviews, run
 * against the production validator. Inputs, expectations and pass rules match
 * the published sources:
 * - docs/evidence/structured-study-import-review-2026-10-03/codex-diagnostics.mjs.txt
 *   (the two R2 retention checks read the documented `preview.data`, as in the
 *   accepted adaptation prototype-corrected/run-codex-diagnostics-adapted.mjs.txt);
 * - docs/evidence/structured-study-import-rereview-2026-10-03/codex-source-notes-diagnostics.mjs.txt.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { validatePacketBytes } from "./index";

type Loose = any;
const run = (packet: unknown): Loose => validatePacketBytes(new TextEncoder().encode(JSON.stringify(packet)));
const fixture = JSON.parse(
  readFileSync(new URL("../../testing/fixtures/study-packets/02-flashcards-and-test.json", import.meta.url), "utf8"),
);
const clone = (): Loose => structuredClone(fixture);
const secret = "sk-" + "Q".repeat(30);

describe("Codex review diagnostics (R1/R2)", () => {
  it("R1: unknown identifier-shaped key never echoed", () => {
    const p = clone();
    p[secret] = "ordinary";
    expect(JSON.stringify(run(p).errors).includes(secret)).toBe(false);
  });
  it("R1: duplicate credential-shaped item id never echoed", () => {
    const p = clone();
    p.questions[0].id = secret;
    p.questions[1].id = secret;
    expect(JSON.stringify(run(p).errors).includes(secret)).toBe(false);
  });
  it("R1: scan-stage path never echoes unknown identifier", () => {
    const r: Loose = validatePacketBytes(new TextEncoder().encode('{"' + secret + '":{"title":"x", "title":"y"}}'));
    expect(JSON.stringify(r.errors).includes(secret)).toBe(false);
  });
  it("R2: validated preview retains normalized source claims", () => {
    expect(Boolean(run(clone()).preview?.data?.source)).toBe(true);
  });
  it("R2: validated preview retains per-item unverified references", () => {
    expect(Boolean(run(clone()).preview?.data?.questions?.[0]?.sourceRefs?.length)).toBe(true);
  });
  it("R2: source note/date without generator are marked unverified", () => {
    const p = clone();
    p.source = { note: "Invented exporter claim", createdAt: "Invented date" };
    expect(run(p).preview.warnings.some((w: Loose) => w.code === "source_claim_unverified")).toBe(true);
  });
  it("Control: trailing LF in flashcard id is rejected", () => {
    const p = clone();
    p.flashcards[0].id = "c1\n";
    expect(run(p).ok).toBe(false);
  });
  it("Control: trailing LF in choice id and answer is rejected", () => {
    const p = clone();
    p.questions[0].choices[0].id = "a\n";
    p.questions[0].correctChoiceId = "a\n";
    expect(run(p).ok).toBe(false);
  });
});

describe("Codex re-review source-notes diagnostics (R5)", () => {
  const base = { format: "hfd-study-packet", formatVersion: 1, title: "Invented labels" };
  const note = "Synthetic provenance note";
  const question = {
    id: "q1", type: "single-choice", question: "Choose an invented label",
    choices: [{ id: "a", text: "Quill" }, { id: "b", text: "Plinth" }], correctChoiceId: "a", explanation: "Invented.",
  };
  const card = { id: "c1", front: "Invented front", back: "Invented back" };
  const cases: [string, Record<string, unknown>, "no_silent_loss" | "preserve" | "valid" | "reject"][] = [
    ["R5: questions plus sourceNotes-only guide never silently discard notes", { questions: [question], guide: { sourceNotes: note } }, "no_silent_loss"],
    ["R5: empty summary and sections plus questions never silently discard notes", { questions: [question], guide: { summary: "", sections: [], sourceNotes: note } }, "no_silent_loss"],
    ["Control: cards plus sourceNotes preserve notes", { flashcards: [card], guide: { sourceNotes: note } }, "preserve"],
    ["Control: substantive guide plus sourceNotes preserve notes", { guide: { summary: "Synthetic guide", sourceNotes: note } }, "preserve"],
    ["Control: blank notes with questions stay valid", { questions: [question], guide: { sourceNotes: "   \n" } }, "valid"],
    ["Control: standalone sourceNotes remain an empty packet", { guide: { sourceNotes: note } }, "reject"],
  ];
  it.each(cases)("%s", (_name, extra, expectation) => {
    const r = run({ ...base, ...extra });
    const kept = r.ok && r.payload.studySet?.sourceNotes === note;
    const pass =
      expectation === "no_silent_loss" ? !r.ok || kept : expectation === "preserve" ? kept : expectation === "valid" ? r.ok : !r.ok;
    expect(pass).toBe(true);
  });
});
