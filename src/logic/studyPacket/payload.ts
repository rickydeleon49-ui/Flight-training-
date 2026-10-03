/**
 * The two outputs of a successful validation, built from the same validated
 * value in one pass (contract §2.13, §3.5):
 *
 * - preview data: normalized and in memory only, keeping unverified source
 *   claims, export IDs and per-item references for display;
 * - the persistence payload: lossy by design, with no claims, references or
 *   export IDs, provider "import", model "" and every sourcePage null.
 */
import type { ValidatedPacket } from "./schema";
import { sourceClaims } from "./semantic";
import type { DiscardedOnSave, ImportPayload, PacketPreviewData, PreviewSourceRef } from "./types";

function previewRefs(refs: ReadonlyArray<{ label?: string; page?: number }> | undefined): PreviewSourceRef[] {
  return (refs ?? []).map((ref) => {
    const out: PreviewSourceRef = {};
    if (ref.label) out.label = ref.label;
    if (ref.page !== undefined) out.page = ref.page;
    return out;
  });
}

export function toPreviewData(
  packet: ValidatedPacket,
  hasGuide: boolean,
): { data: PacketPreviewData; discardedOnSave: DiscardedOnSave } {
  const cards = packet.flashcards ?? [];
  const questions = packet.questions ?? [];
  const source = sourceClaims(packet.source);
  const data: PacketPreviewData = {
    title: packet.title,
    source,
    guide:
      hasGuide || packet.guide?.sourceNotes
        ? {
            summary: packet.guide?.summary ?? "",
            sections: (packet.guide?.sections ?? []).map((s) => ({ heading: s.heading, body: s.body })),
            sourceNotes: packet.guide?.sourceNotes ?? "",
          }
        : null,
    flashcards: cards.map((card, index) => ({
      index,
      id: card.id,
      front: card.front,
      back: card.back,
      sourceRefs: previewRefs(card.sourceRefs),
    })),
    questions: questions.map((question, index) => ({
      index,
      id: question.id,
      question: question.question,
      choices: question.choices.map((choice) => ({ id: choice.id, text: choice.text })),
      correctChoiceId: question.correctChoiceId,
      explanation: question.explanation,
      sourceRefs: previewRefs(question.sourceRefs),
    })),
  };
  const discardedOnSave: DiscardedOnSave = {
    sourceClaims: source ? (Object.keys(source) as DiscardedOnSave["sourceClaims"]) : [],
    sourceRefs:
      data.flashcards.reduce((n, card) => n + card.sourceRefs.length, 0) +
      data.questions.reduce((n, question) => n + question.sourceRefs.length, 0),
    exportIds: cards.length + questions.length,
    choiceIds: questions.reduce((n, question) => n + question.choices.length, 0),
  };
  return { data, discardedOnSave };
}

export function toImportPayload(packet: ValidatedPacket, hasGuide: boolean): ImportPayload {
  const cards = packet.flashcards ?? [];
  const questions = packet.questions ?? [];
  return {
    material: { title: packet.title },
    studySet:
      hasGuide || cards.length
        ? {
            title: packet.title,
            summary: packet.guide?.summary ?? "",
            sections: (packet.guide?.sections ?? []).map((s) => ({ heading: s.heading, body: s.body })),
            flashcards: cards.map((card) => ({ front: card.front, back: card.back, sourcePage: null })),
            sourceNotes: packet.guide?.sourceNotes ?? "",
            provider: "import",
            model: "",
          }
        : null,
    practiceTest: questions.length
      ? {
          title: packet.title,
          questions: questions.map((question) => ({
            question: question.question,
            options: question.choices.map((choice) => choice.text),
            // Validation has already proved exactly one exact match exists.
            correctIndex: question.choices.findIndex((choice) => choice.id === question.correctChoiceId),
            explanation: question.explanation,
            sourcePage: null,
          })),
          provider: "import",
          model: "",
        }
      : null,
  };
}

/**
 * Canonical persistence content for the content hash: persistence fields only,
 * in a fixed order. It excludes every preview-only value (source claims, export
 * and choice IDs, references, warnings, counts) and the original file bytes,
 * so it is not the original-file SHA-256. The caller computes
 * SHA-256 over this string's UTF-8 bytes; nothing here stores it.
 */
export function canonicalPersistenceJson(payload: ImportPayload): string {
  const set = payload.studySet;
  const test = payload.practiceTest;
  return JSON.stringify([
    "hfd-study-packet-content/1",
    [payload.material.title],
    set
      ? [
          set.provider,
          set.model,
          set.title,
          set.summary,
          set.sections.map((s) => [s.heading, s.body]),
          set.flashcards.map((card) => [card.front, card.back, card.sourcePage]),
          set.sourceNotes,
        ]
      : null,
    test
      ? [
          test.provider,
          test.model,
          test.title,
          test.questions.map((q) => [q.question, q.options, q.correctIndex, q.explanation, q.sourcePage]),
        ]
      : null,
  ]);
}
