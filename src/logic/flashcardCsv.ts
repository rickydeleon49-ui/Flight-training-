/**
 * Flashcard CSV export builder.
 *
 * CSV contract:
 * - UTF-8 character encoding.
 * - Comma delimiter (`,`).
 * - Header row: "Front","Back","Material","Source pages","Source / provenance".
 * - LF record endings (`\n`).
 * - Quote every field using standard double quotes (`"`).
 * - Double embedded quotes (`"` -> `""`).
 * - Columns in exact order:
 *   1. Front
 *   2. Back
 *   3. Material
 *   4. Source pages
 *   5. Source / provenance
 * - Embedded newlines and Unicode are preserved inside quoted cells.
 * - Card order is input-material order then each source's stored card order.
 * - Include only flashcards when that item's `selection.flashcards` is true.
 * - Apply each item's `instructorCorrections` filter before reading cards (`exportSourceFor`);
 *   does not mutate input source objects.
 * - Page references are the unique sorted union of `sourcePage` and `pdfProvenance.sources[].page`,
 *   joined by comma-space (`", "`). Empty optional values become empty cells (`""`).
 * - Provenance:
 *   Uses valid PDF label ("Pulled from your PDF on this Mac") or unavailable label
 *   ("PDF source details unavailable") when PDF provenance exists;
 *   otherwise identifies handwritten ("Written by hand in Her Flight Deck"),
 *   imported ("Imported into Her Flight Deck"), or AI-generated ("AI-generated study aid" /
 *   "AI-generated study aid (<model>)") origin.
 *   Labels instructor or user edits when present:
 *   - "Corrected by your instructor" for instructor edit/origin.
 *   - "Edited by you" for user edit/origin.
 *   When an item has both a base provenance and an edit origin, they are combined or labelled clearly.
 * - Spreadsheet formula mitigation:
 *   Prefix a leading apostrophe (`'`) to any cell whose first non-control text begins with
 *   `=`, `+`, `-`, or `@` (including after leading control/space characters), before CSV quoting.
 *
 * Callers must disclose this spreadsheet-safety transformation because some importers may show the apostrophe.
 */

import type { StudyFlashcard } from "@/domain/types";
import {
  exportSourceFor,
  type ExportSelection,
  type ExportSource,
} from "./studyExport";
import { PDF_KIT_LABEL } from "./pdfKitLabels";

export interface FlashcardCsvItem {
  source: ExportSource;
  selection: ExportSelection;
}

const CSV_HEADER = [
  "Front",
  "Back",
  "Material",
  "Source pages",
  "Source / provenance",
];

/**
 * Checks whether the text begins with a spreadsheet formula trigger character
 * (`=`, `+`, `-`, `@`) after any leading control or whitespace characters.
 * Control characters are ASCII 0x00-0x1F and 0x7F.
 */
export function needsFormulaMitigation(text: string): boolean {
  // Find first non-control, non-whitespace character
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const code = text.charCodeAt(i);
    // Skip ASCII control characters (0-31, 127) and whitespace
    if (code <= 32 || code === 127 || /\s/.test(ch)) {
      continue;
    }
    return ch === "=" || ch === "+" || ch === "-" || ch === "@";
  }
  return false;
}

/**
 * Mitigates spreadsheet formula injection by prefixing a single apostrophe `'`
 * if the cell content triggers formula execution in spreadsheet software.
 */
export function sanitizeCellForSpreadsheet(text: string): string {
  if (needsFormulaMitigation(text)) {
    return `'${text}`;
  }
  return text;
}

/**
 * Quotes a single CSV cell according to the contract:
 * - formula mitigation applied first
 * - embedded quotes doubled (`"` -> `""`)
 * - wrapped in double quotes
 */
export function formatCsvCell(text: string): string {
  const sanitized = sanitizeCellForSpreadsheet(text);
  const escaped = sanitized.replace(/"/g, '""');
  return `"${escaped}"`;
}

/**
 * Computes the unique sorted union of `sourcePage` and `pdfProvenance.sources[].page`,
 * formatted as a comma-space joined string. Returns empty string if none.
 */
export function formatSourcePages(card: StudyFlashcard): string {
  const pages = new Set<number>();

  if (card.sourcePage !== null && card.sourcePage !== undefined && Number.isInteger(card.sourcePage)) {
    pages.add(card.sourcePage);
  }

  if (card.pdfProvenance?.sources) {
    for (const s of card.pdfProvenance.sources) {
      if (s.page !== null && s.page !== undefined && Number.isInteger(s.page)) {
        pages.add(s.page);
      }
    }
  }

  if (pages.size === 0) {
    return "";
  }

  const sortedPages = Array.from(pages).sort((a, b) => a - b);
  return sortedPages.join(", ");
}

/**
 * Determines the provenance label for a card, accounting for PDF provenance,
 * study set provider/model, and user or instructor edits.
 */
export function cardProvenanceLabel(
  card: StudyFlashcard,
  source: ExportSource,
): string {
  const set = source.studySet;
  const editOrigin = card.origin ?? card.pdfProvenance?.editOrigin;

  let baseProvenance = "";

  if (card.pdfProvenance) {
    if (card.pdfProvenance.status === "valid") {
      baseProvenance = PDF_KIT_LABEL; // "Pulled from your PDF on this Mac"
    } else {
      baseProvenance = "PDF source details unavailable";
    }
  } else {
    const provider = set?.provider ?? "gemini";
    const model = set?.model ?? "";

    if (provider === "manual") {
      baseProvenance = "Written by hand in Her Flight Deck";
    } else if (provider === "import") {
      baseProvenance = "Imported into Her Flight Deck";
    } else {
      baseProvenance = model ? `AI-generated study aid (${model})` : "AI-generated study aid";
    }
  }

  let editLabel = "";
  if (editOrigin === "instructor") {
    editLabel = "Corrected by your instructor";
  } else if (editOrigin === "user") {
    editLabel = "Edited by you";
  }

  if (baseProvenance && editLabel) {
    return `${baseProvenance} (${editLabel})`;
  }
  return editLabel || baseProvenance;
}

/**
 * Builds a pure CSV string for flashcards from the given items.
 *
 * Notice for callers:
 * Callers must disclose the spreadsheet-safety transformation (formula mitigation)
 * to users because some CSV importers or text editors may show the leading apostrophe.
 */
export function buildFlashcardCsv(items: FlashcardCsvItem[]): string {
  const rows: string[][] = [CSV_HEADER];

  for (const item of items) {
    if (!item.selection.flashcards) {
      continue;
    }

    // Apply instructorCorrections filter without mutating the original source
    const filteredSource = exportSourceFor(item.source, item.selection);
    const studySet = filteredSource.studySet;
    if (!studySet || !Array.isArray(studySet.flashcards) || studySet.flashcards.length === 0) {
      continue;
    }

    const materialTitle = filteredSource.material.title ?? "";

    for (const card of studySet.flashcards) {
      const front = card.front ?? "";
      const back = card.back ?? "";
      const material = materialTitle;
      const sourcePages = formatSourcePages(card);
      const provenance = cardProvenanceLabel(card, filteredSource);

      rows.push([front, back, material, sourcePages, provenance]);
    }
  }

  // Format all rows according to the CSV contract
  return rows
    .map((row) => row.map((cell) => formatCsvCell(cell)).join(","))
    .join("\n") + "\n";
}
