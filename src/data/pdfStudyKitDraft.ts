/** Editable projections of the native journal. Evidence always comes from the journal,
 * while hashes are made only after she has chosen and edited the final content. */
import type { PdfStudyKitDraft } from "@/services/documents";
import { pdfKitContentHash, type PdfKitSource, type PdfKitSources } from "./pdfKitSources";
import type { PracticeDraftQuestion } from "./practiceAuthoringDraft";
export interface KitEvidence { page: number; startOffset: number; endOffset: number; quote: string }
interface CardCandidate { prompt: string; answer: string; sourcePage: number; evidence: KitEvidence[] }
interface OutlineCandidate { heading: string; sourcePage: number; sentences: { text: string }[]; evidence: KitEvidence[] }
interface QuestionCandidate { prompt: string; answer: string; choices: string[]; correctIndex: number; sourcePage: number; evidence: KitEvidence[]; choiceEvidence: KitEvidence[][] }
export interface KitCandidates { glossary: CardCandidate[]; cloze: CardCandidate[]; outline: OutlineCandidate[]; questions: QuestionCandidate[] }
export interface KitReviewItem { id: string; kind: "section" | "card"; fields: string[]; kept: boolean; instructor: boolean }
export function kitCandidates(draft: PdfStudyKitDraft): KitCandidates {
  const c = draft.candidates as unknown as KitCandidates;
  if (!c || !Array.isArray(c.glossary) || !Array.isArray(c.cloze) || !Array.isArray(c.outline) || !Array.isArray(c.questions) || c.glossary.length > 40 || c.cloze.length > 40 || c.outline.length > 40 || c.questions.length > 20) throw new Error("INVALID_DRAFT");
  return c;
}
export function kitReviewItems(draft: PdfStudyKitDraft): KitReviewItem[] {
  const c = kitCandidates(draft);
  return [...c.outline.map((s, i) => ({ id: `${draft.runId}:section:${i}`, kind: "section" as const, fields: [s.heading, s.sentences.map(s => s.text).join("\n\n")], kept: true, instructor: false })),
    ...[...c.glossary, ...c.cloze].map((s, i) => ({ id: `${draft.runId}:card:${i}`, kind: "card" as const, fields: [s.prompt, s.answer], kept: true, instructor: false }))];
}
export function kitItemEvidence(draft: PdfStudyKitDraft, item: KitReviewItem): KitEvidence[] {
  const c = kitCandidates(draft); const index = Number(item.id.split(":").at(-1));
  return (item.kind === "section" ? c.outline[index] : [...c.glossary, ...c.cloze][index])?.evidence ?? [];
}
export function kitEditOrigin(draft: PdfStudyKitDraft, item: KitReviewItem): "instructor" | "user" | undefined {
  return item.instructor ? "instructor" : JSON.stringify(kitReviewItems(draft).find(i => i.id === item.id)?.fields) !== JSON.stringify(item.fields) ? "user" : undefined;
}
export async function kitSources(draft: PdfStudyKitDraft, items: { kind: PdfKitSource["itemKind"]; id: string; content: Record<string, unknown> | string; evidence: KitEvidence[] }[]): Promise<PdfKitSources> {
  const { materialId, contentSha256, selectedPages, extractorVersion, algorithmVersion } = draft.identity;
  return { runId: draft.runId, run: { materialId, contentSha256, selectedPages, extractorVersion, algorithmVersion, createdAt: draft.createdAt }, items: (await Promise.all(items.map(async i => {
    const contentHash = await pdfKitContentHash(i.kind, i.content);
    return i.evidence.map(e => ({ ...e, itemKind: i.kind, logicalId: i.id, contentHash }));
  }))).flat().filter((s, i, all) => all.findIndex(x => JSON.stringify(x) === JSON.stringify(s)) === i) };
}
export interface PdfQuestionSeed { journal: PdfStudyKitDraft; questions: PracticeDraftQuestion[] }
export function kitQuestionSeed(journal: PdfStudyKitDraft): PdfQuestionSeed {
  return { journal, questions: kitCandidates(journal).questions.map((q, i) => ({ identity: `${journal.runId.slice(0, 24)}${((BigInt("0x" + journal.runId.slice(24)) + BigInt(i + 1)) % (1n << 48n)).toString(16).padStart(12, "0")}`, question: q.prompt, options: [...q.choices], correctIndex: q.correctIndex, explanation: q.answer, sourcePage: q.sourcePage, instructor: false })) };
}
