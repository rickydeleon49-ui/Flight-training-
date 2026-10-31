/** Prepare a practice regeneration for review; no persistence or provider calls. */
import type { PracticeAuthoringQuestion, PracticeRetirementRecord, PracticeSaveOperation, PracticeSnapshot } from "@/domain/types";
import { appendPracticeRetirements, practiceRetirementRecord } from "@/data/practiceAuthoring";
import type { GeneratedPracticeTest } from "@/services/gemini";
import { NEAR_MATCH_THRESHOLD, type PreviewChoice } from "./studyAuthoring";

export interface PracticePreviewItem {
  readonly item: PracticeAuthoringQuestion;
  readonly status: "new" | "held" | "near";
  readonly match: PracticeRetirementRecord | null;
}

export function needsPracticeRegenerationReview(snapshot: PracticeSnapshot | null): boolean {
  return Boolean(snapshot && (snapshot.provider === "manual" || snapshot.questions.some((q) => q.origin !== undefined) || snapshot.retired.length > 0));
}

function scalarCompare(a: string, b: string): number {
  const left = Array.from(a), right = Array.from(b);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const delta = left[i]!.codePointAt(0)! - right[i]!.codePointAt(0)!;
    if (delta) return delta;
  }
  return left.length - right.length;
}
const recordKey = (entry: PracticeRetirementRecord) => JSON.stringify([entry.kind, entry.itemId, entry.reason, entry.textKey]);
function jaccard(left: readonly string[], right: ReadonlySet<string>): number {
  if (!left.length || !right.size) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared++;
  return shared / (left.length + right.size - shared);
}

/** Same exact-first, strongest-match, scalar-sorted tie handling as previewRegeneration. */
export async function practiceRegenerationPreview(current: PracticeSnapshot, generated: GeneratedPracticeTest["questions"]): Promise<readonly PracticePreviewItem[]> {
  const ledger = appendPracticeRetirements(current.retired, []).map((entry) => ({ entry, words: new Set(entry.terms) }))
    .sort((a, b) => scalarCompare(recordKey(a.entry), recordKey(b.entry)));
  const result: PracticePreviewItem[] = [];
  for (const candidate of generated) {
    const item: PracticeAuthoringQuestion = {
      identity: crypto.randomUUID(), question: candidate.question, options: [...candidate.options],
      correctIndex: candidate.correctIndex, explanation: candidate.explanation, sourcePage: candidate.sourcePage, ...(candidate.acsTask ? { acsTask: candidate.acsTask } : {}),
    };
    const { textKey, terms } = await practiceRetirementRecord(item, "deleted");
    let exact: PracticeRetirementRecord | null = null, best: PracticeRetirementRecord | null = null, score = NEAR_MATCH_THRESHOLD;
    for (const { entry, words } of ledger) {
      if (entry.textKey === textKey) { exact = entry; break; }
      const similarity = jaccard(terms, words);
      if (similarity >= score && (best === null || similarity > score)) { best = entry; score = similarity; }
    }
    result.push({ item, status: exact ? "held" : best ? "near" : "new", match: exact ?? best });
  }
  return result;
}

/** Held items default to omitted; every near match needs an explicit choice. */
export function resolvePracticeRegeneration(preview: readonly PracticePreviewItem[], choices: ReadonlyMap<string, PreviewChoice>): PracticeAuthoringQuestion[] {
  if (preview.some((entry) => entry.status === "near" && !choices.has(entry.item.identity))) {
    throw new Error("Choose whether to keep or leave out each similar question before saving.");
  }
  return preview.filter((entry) => choices.get(entry.item.identity) === "keep" || (entry.status === "new" && !choices.has(entry.item.identity))).map((entry) => entry.item);
}

export interface MergedPracticeRegeneration {
  questions: PracticeAuthoringQuestion[];
  retired: PracticeRetirementRecord[];
}

export async function mergePracticeRegeneration(current: PracticeSnapshot, resolved: readonly PracticeAuthoringQuestion[], mode: "keep" | "replace" = "keep"): Promise<MergedPracticeRegeneration> {
  const mine = current.questions.filter((q) => q.origin !== undefined);
  const records = mode === "replace" ? await Promise.all(mine.map((q) => practiceRetirementRecord(q, "deleted"))) : [];
  return {
    questions: [...resolved, ...(mode === "keep" ? mine : [])],
    retired: appendPracticeRetirements(current.retired, records),
  };
}

/** A snapshot has no material id, so the caller supplies it with the answer's frame. */
export function buildPracticeRegenerationOperation(operationId: string, current: PracticeSnapshot, merged: MergedPracticeRegeneration, answer: GeneratedPracticeTest & { sourceMaterialId: string }): PracticeSaveOperation {
  return {
    operationId, sourceMaterialId: answer.sourceMaterialId, reason: "regenerate", expected: current,
    next: { title: answer.title, provider: "gemini", model: answer.model, questions: merged.questions, retired: merged.retired },
  };
}
