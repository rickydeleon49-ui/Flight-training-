import type { PdfItemProvenance } from "@/data/pdfKitSources";
export const PDF_KIT_LABEL = "Pulled from your PDF on this Mac";
export const PDF_KIT_REMINDER = "Compare this kit with your PDF, current FAA guidance and your instructor.";
interface PdfItem {
  pdfProvenance?: PdfItemProvenance;
  heading?: string;
  body?: string;
  front?: string;
  back?: string;
  question?: string;
  itemId?: string;
  origin?: unknown;
}
export interface PdfLabelContent { summary?: string | null; summaryPdfProvenance?: PdfItemProvenance; sections?: PdfItem[]; flashcards?: PdfItem[]; questions?: PdfItem[] }

export function kitContentItems(content: PdfLabelContent | null | undefined): (PdfItemProvenance | undefined)[] {
  if (!content) return [];
  const items: (PdfItemProvenance | undefined)[] = [];
  if (content.summary && content.summary.trim().length > 0) {
    items.push(content.summaryPdfProvenance);
  } else if (content.summaryPdfProvenance) {
    items.push(content.summaryPdfProvenance);
  }
  if (content.sections) {
    for (const s of content.sections) items.push(s.pdfProvenance);
  }
  if (content.flashcards) {
    for (const c of content.flashcards) items.push(c.pdfProvenance);
  }
  if (content.questions) {
    for (const q of content.questions) items.push(q.pdfProvenance);
  }
  return items;
}

export function isAllPdfKit(content: PdfLabelContent | null | undefined): boolean {
  const items = kitContentItems(content);
  return items.length > 0 && items.every(i => i?.status === "valid");
}

/** PDF authorship remains known even when some source details are unavailable. */
export function hasOnlyPdfContent(content: PdfLabelContent | null | undefined): boolean {
  const items = kitContentItems(content);
  return items.length > 0 && items.every(Boolean);
}

export function isMixedPdfKit(content: PdfLabelContent | null | undefined): boolean {
  const items = kitContentItems(content);
  if (items.length === 0) return false;
  const valid = items.filter(i => i?.status === "valid").length;
  return valid > 0 && valid < items.length;
}

export function hasPdfContent(content: PdfLabelContent | null | undefined): boolean {
  return kitContentItems(content).some(Boolean);
}

/** The set header takes the PDF label only when every item has valid PDF provenance. */
export function pdfLabelState(content: PdfLabelContent | null | undefined): "valid" | "invalid" | undefined {
  if (!content) return undefined;
  if (isAllPdfKit(content)) return "valid";
  return undefined;
}
export function pdfEditLabel(origin: unknown): string | undefined { return origin === "user" ? "Edited by you" : origin === "instructor" ? "Corrected by your instructor" : undefined; }

