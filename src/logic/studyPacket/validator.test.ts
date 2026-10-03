import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import type { AiStudySet, PracticeTest } from "@/domain/types";
import {
  canonicalPersistenceJson,
  validatePacketBytes,
  validatePacketText,
  type ImportPayload,
  type ImportedPracticeTestDraft,
  type ImportedStudySetDraft,
  type PacketValidationResult,
} from "./index";

const encode = (text: string) => new TextEncoder().encode(text);
const base = { format: "hfd-study-packet", formatVersion: 1, title: "Invented labels" };
const question = (id: string, correctChoiceId: string) => ({
  id, type: "single-choice", question: `Pick ${id}`,
  choices: [{ id: "a", text: "Zorb" }, { id: "b", text: "Quill" }, { id: "c", text: "Plinth" }],
  correctChoiceId, explanation: "Invented.",
});
function accepted(packet: unknown) {
  const result = validatePacketBytes(encode(JSON.stringify(packet)));
  if (!result.ok) throw new Error(`rejected: ${result.errors.map((e) => e.code).join(",")}`);
  return result;
}
const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

describe("answer mapping and persistence payload", () => {
  it("maps each choice-ID answer to its own position, keeping question and choice order", () => {
    const result = accepted({ ...base, questions: [question("q1", "c"), question("q2", "a"), question("q3", "b")] });
    const test = result.payload.practiceTest!;
    expect(test.questions.map((q) => q.correctIndex)).toEqual([2, 0, 1]);
    expect(test.questions.map((q) => q.question)).toEqual(["Pick q1", "Pick q2", "Pick q3"]);
    expect(test.questions[0]!.options).toEqual(["Zorb", "Quill", "Plinth"]);
  });

  it("uses provider import, an empty model, null source pages and a title-only material", () => {
    const result = accepted({
      ...base,
      guide: { summary: "S" },
      flashcards: [{ id: "c1", front: "F", back: "B", sourceRefs: [{ label: "Invented", page: 7 }] }],
      questions: [{ ...question("q1", "a"), sourceRefs: [{ page: 3 }] }],
    });
    expect(result.payload.material).toEqual({ title: "Invented labels" });
    expect(result.payload.studySet).toMatchObject({ provider: "import", model: "" });
    expect(result.payload.practiceTest).toMatchObject({ provider: "import", model: "" });
    expect(result.payload.studySet!.flashcards[0]!.sourcePage).toBeNull();
    expect(result.payload.practiceTest!.questions[0]!.sourcePage).toBeNull();
    // The preview still shows the claimed pages, as unverified references.
    expect(result.preview.data.flashcards[0]!.sourceRefs).toEqual([{ label: "Invented", page: 7 }]);
    expect(result.preview.data.questions[0]!.sourceRefs).toEqual([{ page: 3 }]);
  });

  it("types the import DTOs without widening the stored domain types", () => {
    const guideOnly: ImportPayload = accepted({ ...base, guide: { summary: "S" } }).payload;
    const testOnly: ImportPayload = accepted({ ...base, questions: [question("q1", "a")] }).payload;
    const combined: ImportPayload = accepted({ ...base, guide: { summary: "S" }, questions: [question("q1", "a")] }).payload;
    expect([guideOnly.practiceTest, testOnly.studySet]).toEqual([null, null]);
    expect(combined.studySet && combined.practiceTest).toBeTruthy();
    // The stored types still require "gemini"; the drafts replace only provider and model.
    type StoredProvider = AiStudySet["provider"] | PracticeTest["provider"];
    const stored: StoredProvider = "gemini";
    const drafts: [ImportedStudySetDraft["provider"], ImportedPracticeTestDraft["provider"]] = ["import", "import"];
    expect([stored, ...drafts]).toEqual(["gemini", "import", "import"]);
  });
});

describe("canonical persistence content and hashes", () => {
  const packet = { ...base, guide: { summary: "S", sourceNotes: "Notes" }, flashcards: [{ id: "c1", front: "F", back: "B" }], questions: [question("q1", "b")] };

  it("is stable for the same content and differs from the original-file hash", () => {
    const text = JSON.stringify(packet);
    const first = canonicalPersistenceJson(accepted(packet).payload);
    const second = canonicalPersistenceJson(accepted(JSON.parse(text)).payload);
    expect(first).toBe(second);
    expect(sha256(first)).toBe(sha256(second));
    expect(sha256(first)).not.toBe(sha256(text)); // original-file SHA-256 is a different value
    expect(JSON.parse(first)[0]).toBe("hfd-study-packet-content/1");
  });

  it("changes when a saved value changes", () => {
    const original = canonicalPersistenceJson(accepted(packet).payload);
    const variants = [
      { ...packet, title: "Other title" },
      { ...packet, guide: { ...packet.guide, sourceNotes: "Other notes" } },
      { ...packet, flashcards: [{ id: "c1", front: "F", back: "Other" }] },
      { ...packet, questions: [question("q1", "c")] },
    ];
    for (const variant of variants) expect(canonicalPersistenceJson(accepted(variant).payload)).not.toBe(original);
  });
});

describe("byte and text entry points", () => {
  const small = JSON.stringify({ ...base, guide: { summary: "x" } });

  it("accepts one UTF-8 BOM from bytes and reports it like the text entry point", () => {
    const fromBytes = validatePacketBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...encode(small)]));
    const fromText = validatePacketText(small, { bomRemoved: true });
    expect(fromBytes).toEqual(fromText);
    expect(fromBytes.ok && fromBytes.preview.warnings.map((w) => w.code)).toContain("utf8_bom_removed");
  });

  it("refuses UTF-16 byte-order marks and an unstripped BOM character", () => {
    const codeOf = (r: PacketValidationResult) => (r.ok ? "ok" : r.errors[0]!.code);
    expect(codeOf(validatePacketBytes(new Uint8Array([0xfe, 0xff, 0x00, 0x7b])))).toBe("unsupported_encoding");
    expect(codeOf(validatePacketBytes(new Uint8Array([0xff, 0xfe, 0x7b, 0x00])))).toBe("unsupported_encoding");
    expect(codeOf(validatePacketText("﻿" + small))).toBe("unsupported_encoding");
  });

  it("returns the fixed internal error for non-text input to the text entry point", () => {
    const result = validatePacketText(42 as unknown as string);
    expect(result).toEqual({ ok: false, stage: "internal", errors: [{ code: "internal_error", path: "$", message: "The packet could not be checked. Nothing was imported." }], omittedErrors: 0 });
  });
});
