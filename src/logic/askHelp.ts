/**
 * Plain local wording for Ask: refusals that point her somewhere useful, and
 * a nudge when a question has no topic yet. Nothing here is sent anywhere.
 */

/** Section headings that name a page range or the whole guide, not a topic. */
const GENERIC_HEADING = /^(study guide|overview|summary|introduction|pages?\s+\d|part\s+\d)/i;

function cleanHeading(text: string): string {
  return text.replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Up to `max` topic headings from a saved guide: the Markdown headings inside
 * each section first (new guides put one per topic), then section headings
 * that name a topic. Duplicates are dropped, order is kept.
 */
export function guideTopics(
  sections: readonly { heading: string; body: string }[] | null | undefined,
  max = 5,
): string[] {
  const seen = new Set<string>();
  const topics: string[] = [];
  const add = (raw: string) => {
    const heading = cleanHeading(raw);
    const key = heading.toLowerCase();
    if (!heading || heading.length > 80 || GENERIC_HEADING.test(heading) || seen.has(key)) return;
    seen.add(key);
    topics.push(heading);
  };
  for (const section of sections ?? []) {
    for (const match of section.body.matchAll(/^#{1,4}\s+(.+)$/gm)) add(match[1]!);
  }
  for (const section of sections ?? []) add(section.heading);
  return topics.slice(0, max);
}

/** "pages 1–32" for a PDF whose page count is known, else null. */
export function pageRangeLabel(pages: number | null | undefined): string | null {
  if (!pages || pages < 1) return null;
  return pages === 1 ? "page 1" : `pages 1–${pages}`;
}

function listTopics(topics: readonly string[]): string {
  if (topics.length <= 1) return topics.join("");
  return `${topics.slice(0, -1).join(", ")} and ${topics[topics.length - 1]}`;
}

/** What she sees when an answer is not in this PDF (provider-neutral). */
export function notAnsweredMessage(range: string | null, topics: readonly string[]): string {
  const where = range ? `That isn't in these pages (${range}).` : "That isn't in these pages.";
  const covers = topics.length > 0 ? ` This PDF covers: ${topics.slice(0, 5).join("; ")}.` : "";
  return `${where}${covers} Try another chapter, or ask your instructor.`;
}

/** Words that, alone, don't say which part of the PDF she means. */
const VAGUE = new Set([
  "",
  "why",
  "what",
  "how",
  "huh",
  "explain",
  "explain this",
  "explain it",
  "explain that",
  "please explain",
  "explain please",
  "can you explain",
  "tell me more",
  "more",
  "help",
  "what is this",
  "what does this mean",
  "i dont understand",
  "i don't understand",
]);

/** True for a question like "why?", "?" or "explain" that names no topic. */
export function isVagueQuestion(question: string): boolean {
  const words = question
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return VAGUE.has(words);
}

/** The local reply to a vague question on Ask about this PDF. */
export function vagueQuestionReply(topics: readonly string[]): string {
  const examples = topics.slice(0, 3).map((topic) => `“${topic}”`);
  return examples.length > 0
    ? `Which part do you mean? For example: ${listTopics(examples)}.`
    : "Which part do you mean? For example, name a topic or a page from this PDF.";
}

/**
 * A card's source page as a page of this PDF (1 = first page). A split part's
 * cards may cite the original document's page numbers; those are moved into
 * the part. Anything outside the part gives null (no page text is sent).
 */
export function citedPdfPage(
  sourcePage: number | null | undefined,
  lineage: { sourcePageStart: number; sourcePageEnd: number; childPageCount: number } | null | undefined,
): number | null {
  if (!sourcePage || !Number.isInteger(sourcePage) || sourcePage < 1) return null;
  if (!lineage) return sourcePage;
  if (sourcePage <= lineage.childPageCount && lineage.sourcePageStart === 1) return sourcePage;
  if (sourcePage >= lineage.sourcePageStart && sourcePage <= lineage.sourcePageEnd) return sourcePage - lineage.sourcePageStart + 1;
  return sourcePage <= lineage.childPageCount ? sourcePage : null;
}

/** "Sent: this card and the text of pages 14–18" / "Sent: this card only". */
export function sentLine(noun: "card" | "question", pages: readonly number[] | undefined): string {
  if (!pages || pages.length === 0) return `Sent: this ${noun} only`;
  const first = Math.min(...pages);
  const last = Math.max(...pages);
  return `Sent: this ${noun} and the text of ${first === last ? `page ${first}` : `pages ${first}–${last}`}`;
}
