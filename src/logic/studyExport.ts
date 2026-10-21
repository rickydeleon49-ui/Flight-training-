/**
 * Exporting a material's study aid as a study packet (P54-04).
 *
 * She chooses which parts of one material's guide, flashcards and practice
 * test to share. They are written in the same `hfd-study-packet` version 1
 * format the import reads, and the text is run through that import validator
 * before it can be saved. What another copy of Her Flight Deck would import is
 * checked against what she chose, so an export never silently drops or alters
 * content beyond the format's own whitespace tidying.
 *
 * Only the chosen material's study content travels: no other records, no file
 * paths, no practice history, no settings and nothing from the Gemini key.
 * Page references go along as unverified claims, which an import shows and
 * then discards, as it does for any outside packet.
 */
import { pdfLabelState, PDF_KIT_LABEL, PDF_KIT_REMINDER, pdfEditLabel } from "./pdfKitLabels";
import type { PdfItemProvenance } from "@/data/pdfKitSources";
import type { AiStudySet, PracticeTest, StudyMaterial } from "@/domain/types";
import { FORMAT, FORMAT_VERSION, LIMITS, validatePacketText, type ImportPayload, type PacketError } from "@/logic/studyPacket";
import { normalizeBlock, normalizeLine } from "@/logic/studyPacket/schema";

export interface ExportSelection {
  guide: boolean;
  flashcards: boolean;
  questions: boolean;
  /**
   * Her instructor's corrections stay private unless she includes them
   * (OFFLINE-03 §2.6); applied before anything is written.
   */
  instructorCorrections?: boolean;
}

export interface ExportSource {
  material: Pick<StudyMaterial, "title">;
  studySet: AiStudySet | null;
  practiceTest: PracticeTest | null;
}

export type ExportPacketResult =
  | { ok: true; text: string; fileName: string; counts: { sections: number; flashcards: number; questions: number } }
  | { ok: false; message: string };

const CHOICE_IDS = ["a", "b", "c", "d", "e", "f"] as const;

/** Messages for a packet this export could not write, in her words. */
export const EXPORT_MESSAGES = {
  nothingChosen: "Choose at least one part to export.",
  credential:
    "This study aid contains text that looks like a password or access key, so it wasn't exported. Remove it from the study aid first.",
  tooLarge: "This is more than a study packet can hold. Export fewer parts, or split the material and export each part.",
  invalid: "This study aid can't be written as a study packet:",
  mismatch: "The exported packet would not import exactly as chosen, so it wasn't saved. Nothing was written.",
} as const;

/** Whether either study aid holds any of her instructor's corrections. */
export function hasInstructorCorrections(set: AiStudySet | null, test?: PracticeTest | null): boolean {
  return Boolean(
    (set &&
      (set.summaryOrigin === "instructor" ||
        set.sections.some((section) => section.origin === "instructor") ||
        set.flashcards.some((card) => card.origin === "instructor"))) ||
      test?.questions.some((question) => question.origin === "instructor"),
  );
}

/** Whether either study aid holds handwritten items (so a packet would lose their labels). */
export function hasHandwrittenItems(set: AiStudySet | null, test?: PracticeTest | null): boolean {
  return Boolean(
    (set &&
      (set.provider === "manual" ||
        set.summaryOrigin ||
        set.sections.some((section) => section.origin !== undefined) ||
        set.flashcards.some((card) => card.origin !== undefined))) ||
      (test && (test.provider === "manual" || test.questions.some((question) => question.origin !== undefined))),
  );
}

/**
 * What may be exported: her instructor's corrections are removed unless she
 * chose to include them. Every export path starts here, before serializing.
 */
export function exportSourceFor(source: ExportSource, selection: Pick<ExportSelection, "instructorCorrections">): ExportSource {
  const set = source.studySet;
  const test = source.practiceTest;
  if (selection.instructorCorrections === true || !hasInstructorCorrections(set, test)) return source;
  const summaryIsCorrection = set?.summaryOrigin === "instructor";
  const questions = test?.questions.filter((question) => question.origin !== "instructor");
  return {
    ...source,
    studySet: set ? {
      ...set,
      summary: summaryIsCorrection ? "" : set.summary,
      summaryOrigin: summaryIsCorrection ? null : set.summaryOrigin,
      sections: set.sections.filter((section) => section.origin !== "instructor"),
      flashcards: set.flashcards.filter((card) => card.origin !== "instructor"),
    } : null,
    practiceTest: test && questions?.length ? { ...test, questions } : null,
  };
}

/** What a choice of parts actually contains, for the dialog's labels and checks. */
export function exportableParts(source: ExportSource): ExportSelection {
  const set = source.studySet;
  return {
    guide: Boolean(set && (set.summary.trim() || set.sections.length > 0)),
    flashcards: Boolean(set && set.flashcards.length > 0),
    questions: Boolean(source.practiceTest && source.practiceTest.questions.length > 0),
  };
}

/** An item that may carry PDF provenance. */
type PdfProvenanceItem = { pdfProvenance?: PdfItemProvenance };

/**
 * How a part's items came from the PDF: none of them, some of them, or all
 * of them (with their source details still known, or not).
 */
type PdfShare = "none" | "some" | "all" | "allValid";

function pdfShare(items: PdfProvenanceItem[]): PdfShare {
  if (items.length === 0) return "none";
  const fromPdf = items.filter((item) => item.pdfProvenance).length;
  if (fromPdf === 0) return "none";
  if (fromPdf < items.length) return "some";
  return items.every((item) => item.pdfProvenance?.status === "valid") ? "allValid" : "all";
}

/** Where the content came from, said plainly for whoever opens the file. */
export function provenanceNote(source: ExportSource, selection: ExportSelection, portable = false): string {
  const pdfLabel = portable ? "Pulled from a PDF on the sender's Mac" : PDF_KIT_LABEL;
  const origins: { what: string; origin: string }[] = [];
  const set = source.studySet;
  const test = source.practiceTest;
  // Only the parts she chose travel in the packet, so only they can be claimed.
  const chosenSetItems = (): PdfProvenanceItem[] => {
    if (!set) return [];
    const items: PdfProvenanceItem[] = [];
    if (selection.guide) {
      if (set.summary.trim()) items.push({ pdfProvenance: set.summaryPdfProvenance });
      items.push(...(set.sections ?? []));
    }
    if (selection.flashcards) items.push(...(set.flashcards ?? []));
    return items;
  };
  const chosenTestItems = (): PdfProvenanceItem[] => (test && selection.questions ? [...(test.questions ?? [])] : []);
  const setShare = pdfShare(chosenSetItems());
  const testShare = pdfShare(chosenTestItems());
  if (set && (selection.guide || selection.flashcards)) {
    const label = portable
      ? setShare === "allValid" ? pdfLabel : origin(set.provider, set.model)
      : pdfLabelState(set) ? pdfLabelState(set) === "valid" ? pdfLabel : "source details unavailable" : origin(set.provider, set.model);
    origins.push({ what: "Study guide and flashcards", origin: label });
  }
  if (test && selection.questions) {
    const label = portable
      ? testShare === "allValid" ? pdfLabel : origin(test.provider, test.model)
      : pdfLabelState(test) ? pdfLabelState(test) === "valid" ? pdfLabel : "source details unavailable" : origin(test.provider, test.model);
    origins.push({ what: "Practice test", origin: label });
  }
  const first = origins[0];
  const parts =
    first && origins.every((entry) => entry.origin === first.origin)
      ? [`${capitalize(first.origin)}.`]
      : origins.map((entry) => `${entry.what}: ${entry.origin}.`);
  // Per-item authorship can't travel in a packet; say that some was handwritten.
  const handwrittenSet = set && !pdfLabelState(set) && set.provider !== "manual" && (selection.guide || selection.flashcards) && hasHandwrittenItems(set);
  const handwrittenTest = test && !pdfLabelState(test) && test.provider !== "manual" && selection.questions && test.questions.some((question) => question.origin !== undefined);
  if (handwrittenSet || handwrittenTest) {
    parts.push("Some items were written or corrected by hand in Her Flight Deck, not generated.");
  }
  const pdfItems = [...(selection.guide ? [{ pdfProvenance: set?.summaryPdfProvenance, origin: set?.summaryOrigin }, ...(set?.sections ?? [])] : []), ...(selection.flashcards ? set?.flashcards ?? [] : []), ...(selection.questions ? test?.questions ?? [] : [])];
  if (portable) {
    // The PDF sentence describes the chosen items: when only some of them came
    // from the PDF, saying all of them did would be wrong.
    if (setShare === "some" || testShare === "some") parts.push("Some items pulled from a PDF on the sender's Mac.");
    else if (setShare === "all" || testShare === "all") {
      if (!parts.some((part) => part.includes(pdfLabel))) parts.push(`${pdfLabel}.`);
    }
  }
  if (!portable) for (const label of new Set(pdfItems.filter(i => i.pdfProvenance?.status === "valid").map(i => pdfEditLabel(i.origin)).filter(Boolean))) parts.push(`${label}.`);
  parts.push(pdfLabelState(set) || pdfLabelState(test) ? PDF_KIT_REMINDER : "Verify everything against current FAA material, aircraft documents and an instructor.");
  return parts.join(" ");
}

function origin(provider: string, model: string): string {
  if (provider === "import") return "imported into Her Flight Deck from a study packet; not checked by the app";
  if (provider === "manual") return "written by hand in Her Flight Deck; not checked by the app";
  return `AI-generated study aid${model ? ` (${model})` : ""}`;
}

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

function sourceRefs(title: string, page: number | null) {
  if (page === null || !Number.isInteger(page) || page < LIMITS.pageMin || page > LIMITS.pageMax) return undefined;
  return [{ label: title, page }];
}

/** A safe file name for the save dialog's suggestion. */
export function exportFileName(title: string, extension: "json" | "html" | "ics"): string {
  const base =
    title
      .normalize("NFC")
      .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^\.+/, "")
      .slice(0, 80)
      .trim() || "Study packet";
  return `${base}.${extension}`;
}

/** The packet object for the chosen parts, before validation. */
export function buildExportPacket(source: ExportSource, selection: ExportSelection, createdAt: Date): Record<string, unknown> {
  const available = exportableParts(source);
  const title = normalizeLine(source.material.title).slice(0, LIMITS.title) || "Study packet";
  const set = source.studySet;
  const test = source.practiceTest;
  const packet: Record<string, unknown> = {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    title,
    source: {
      generator: "Her Flight Deck",
      createdAt: createdAt.toISOString().slice(0, 10),
      note: provenanceNote(source, selection, true).slice(0, LIMITS.sourceNote),
    },
  };
  if (set && selection.guide && available.guide) {
    packet.guide = {
      ...(set.summary.trim() ? { summary: set.summary } : {}),
      sections: set.sections.map((section) => ({ heading: section.heading, body: section.body })),
      ...(set.sourceNotes.trim() ? { sourceNotes: set.sourceNotes } : {}),
    };
  }
  if (set && selection.flashcards && available.flashcards) {
    packet.flashcards = set.flashcards.map((card, index) => {
      const refs = sourceRefs(title, card.sourcePage);
      return { id: `card-${index + 1}`, front: card.front, back: card.back, ...(refs ? { sourceRefs: refs } : {}) };
    });
  }
  if (test && selection.questions && available.questions) {
    packet.questions = test.questions.map((question, index) => {
      const refs = sourceRefs(title, question.sourcePage);
      return {
        id: `question-${index + 1}`,
        type: "single-choice",
        question: question.question,
        choices: question.options.map((text, choice) => ({ id: CHOICE_IDS[choice] ?? `choice-${choice + 1}`, text })),
        correctChoiceId: CHOICE_IDS[question.correctIndex] ?? `choice-${question.correctIndex + 1}`,
        explanation: question.explanation,
        ...(refs ? { sourceRefs: refs } : {}),
      };
    });
  }
  return packet;
}

/** What an import of the chosen parts must produce, normalized the way the format normalizes. */
function expectedPayload(source: ExportSource, selection: ExportSelection, title: string): ImportPayload {
  const available = exportableParts(source);
  const set = source.studySet;
  const test = source.practiceTest;
  const guide = Boolean(set && selection.guide && available.guide);
  const cards = set && selection.flashcards && available.flashcards ? set.flashcards : [];
  const questions = test && selection.questions && available.questions ? test.questions : [];
  return {
    material: { title },
    studySet:
      set && (guide || cards.length)
        ? {
            title,
            summary: guide ? normalizeBlock(set.summary) : "",
            sections: guide ? set.sections.map((s) => ({ heading: normalizeLine(s.heading), body: normalizeBlock(s.body) })) : [],
            flashcards: cards.map((card) => ({ front: normalizeBlock(card.front), back: normalizeBlock(card.back), sourcePage: null })),
            sourceNotes: guide ? normalizeBlock(set.sourceNotes) : "",
            provider: "import",
            model: "",
          }
        : null,
    practiceTest: questions.length
      ? {
          title,
          questions: questions.map((q) => ({
            question: normalizeBlock(q.question),
            options: q.options.map((option) => normalizeLine(option)),
            correctIndex: q.correctIndex,
            explanation: normalizeBlock(q.explanation),
            sourcePage: null,
          })),
          provider: "import",
          model: "",
        }
      : null,
  };
}

function describeErrors(errors: PacketError[]): string {
  if (errors.some((error) => error.code === "credential_like_content")) return EXPORT_MESSAGES.credential;
  if (errors.some((error) => error.code === "file_too_large" || error.code === "too_many_items" || error.code === "too_long")) {
    return EXPORT_MESSAGES.tooLarge;
  }
  const shown = errors.slice(0, 3).map((error) => `${error.message}${error.path !== "$" ? ` (${error.path})` : ""}`);
  return `${EXPORT_MESSAGES.invalid} ${shown.join(" ")}`;
}

/**
 * The packet file for the chosen parts, validated by the import's own
 * validator and checked against what an import would save.
 */
export function exportStudyPacket(allContent: ExportSource, selection: ExportSelection, createdAt: Date): ExportPacketResult {
  const source = exportSourceFor(allContent, selection);
  const available = exportableParts(source);
  const chosen = {
    guide: selection.guide && available.guide,
    flashcards: selection.flashcards && available.flashcards,
    questions: selection.questions && available.questions,
  };
  if (!chosen.guide && !chosen.flashcards && !chosen.questions) return { ok: false, message: EXPORT_MESSAGES.nothingChosen };

  const packet = buildExportPacket(source, chosen, createdAt);
  const text = `${JSON.stringify(packet, null, 2)}\n`;
  const result = validatePacketText(text);
  if (!result.ok) return { ok: false, message: describeErrors(result.errors) };

  const expected = expectedPayload(source, chosen, packet.title as string);
  if (JSON.stringify(result.payload) !== JSON.stringify(expected)) return { ok: false, message: EXPORT_MESSAGES.mismatch };

  return {
    ok: true,
    text,
    fileName: exportFileName(packet.title as string, "json"),
    counts: {
      sections: result.preview.counts.sections,
      flashcards: result.preview.counts.flashcards,
      questions: result.preview.counts.questions,
    },
  };
}
