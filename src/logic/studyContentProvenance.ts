/**
 * Pure helper for study content provenance formatting.
 *
 * Implements ROADMAP.md §7.C: expose the provenance already stored for saved
 * study guides/flashcards and practice tests in Material Detail.
 * Shows source material, origin, stored model when applicable, and locally
 * formatted creation date without modifying shared date helpers or persistence.
 */
import { hasOnlyPdfContent, isAllPdfKit, isMixedPdfKit, PDF_KIT_LABEL, type PdfLabelContent } from "./pdfKitLabels";
import type { StudySetProvider } from "@/domain/types";
import { formatLongDate, localDayOf } from "@/lib/dates";

export interface StudyContentProvenanceInput extends PdfLabelContent {
  provider?: StudySetProvider | null;
  model?: string | null;
  generatedAt?: string | null;
}

export interface FormattedStudyContentProvenance {
  sourceMaterialTitle: string;
  isImported: boolean;
  originLabel: string;
  modelLabel: string | null;
  dateText: string;
  summaryText: string;
  pdfNote?: string | null;
}

/**
 * Formats provenance information for a saved study set or practice test.
 *
 * - Gemini content shows its stored model (or "Model unavailable") and a "Generated <date>" text.
 * - Imported content shows "Imported study packet" as origin and an "Imported <date>" text,
 *   with no model shown (to avoid suggesting an external model or instructor verification).
 * - Empty model and invalid/missing timestamps produce clear unavailable wording.
 */
export function formatStudyContentProvenance(
  sourceMaterialTitle: string | null | undefined,
  content: StudyContentProvenanceInput | null | undefined,
): FormattedStudyContentProvenance {
  const trimmedTitle = typeof sourceMaterialTitle === "string" ? sourceMaterialTitle.trim() : "";
  const resolvedSourceTitle = trimmedTitle || "Source material unavailable";

  if (!content) {
    return {
      sourceMaterialTitle: resolvedSourceTitle,
      isImported: false,
      originLabel: "Origin unavailable",
      modelLabel: "Model unavailable",
      dateText: "Date unavailable",
      summaryText: `Source material: ${resolvedSourceTitle} · Origin: Origin unavailable · Model: Model unavailable · Date unavailable`,
      pdfNote: null,
    };
  }

  const allSourcesValid = isAllPdfKit(content);
  if (allSourcesValid || (content.provider === "manual" && hasOnlyPdfContent(content))) {
    const pdfNote = allSourcesValid ? null : "Some source details are unavailable";
    return {
      sourceMaterialTitle: resolvedSourceTitle,
      isImported: false,
      originLabel: PDF_KIT_LABEL,
      modelLabel: null,
      dateText: "Saved on this computer",
      summaryText: `Source material: ${resolvedSourceTitle} · ${PDF_KIT_LABEL}${pdfNote ? ` · ${pdfNote}` : ""}`,
      pdfNote,
    };
  }
  const isImported = content.provider === "import";
  // A set she wrote herself never borrows Gemini's or an import's wording.
  const isManual = content.provider === "manual";
  const originLabel = isManual ? "Written by you" : isImported ? "Imported study packet" : content.model?.trim().startsWith("claude-") ? "Claude" : "Gemini";

  // Stored model: only applicable for generated content.
  let modelLabel: string | null = null;
  if (!isImported && !isManual) {
    const trimmedModel = typeof content.model === "string" ? content.model.trim() : "";
    modelLabel = trimmedModel || "Model unavailable";
  }

  // Local calendar date formatting using existing localDayOf and formatLongDate.
  const localDay = localDayOf(content.generatedAt);
  let dateText: string;
  if (localDay) {
    const formattedDate = formatLongDate(localDay);
    dateText = isManual ? `Created ${formattedDate}` : isImported ? `Imported ${formattedDate}` : `Generated ${formattedDate}`;
  } else {
    dateText = isManual ? "Created date unavailable" : isImported ? "Imported date unavailable" : "Generated date unavailable";
  }

  const parts = [
    `Source material: ${resolvedSourceTitle}`,
    `Origin: ${originLabel}`,
  ];
  if (modelLabel) {
    parts.push(`Model: ${modelLabel}`);
  }
  parts.push(dateText);

  let pdfNote: string | null = null;
  if (isMixedPdfKit(content)) {
    pdfNote = "Some items pulled from your PDF on this Mac";
    parts.push(pdfNote);
  }

  return {
    sourceMaterialTitle: resolvedSourceTitle,
    isImported,
    originLabel,
    modelLabel,
    dateText,
    summaryText: parts.join(" · "),
    pdfNote,
  };
}
