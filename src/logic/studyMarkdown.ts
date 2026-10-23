/** A portable, plain Markdown bundle for the selected study material. */
import { exportableParts, exportSourceFor, provenanceNote, type ExportSelection, type ExportSource } from "./studyExport";

export interface MarkdownEntry { name: string; text: string }

const MAX_SLUG = 48;
const cleanText = (value: string) => value.replace(/\r\n?/g, "\n").trim();
const plainLabel = (value: string) => cleanText(value).replace(/\s+/g, " ").replace(/([\\`*_{}\[\]<>#+.!|])/g, "\\$1");
const safeGuideBody = (value: string) => cleanText(value)
  .replace(/<([/!?A-Za-z])/g, "&lt;$1")
  .replace(/!\[([^\]]*)\]\(/g, "\\![$1](");
const safeSlug = (value: string, fallback: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, MAX_SLUG).replace(/-+$/g, "") || fallback;

function filenames(source: ExportSource, selection: ExportSelection): string[] {
  const title = safeSlug(source.material.title, "study-material");
  const names: string[] = ["index.md"];
  const set = source.studySet;
  if (set && selection.guide) {
    if (set.summary.trim()) names.push(`${title}-summary.md`);
    for (const section of set.sections) names.push(`${title}-guide-${safeSlug(section.heading, "section")}.md`);
  }
  if (set && selection.flashcards) names.push(`${title}-flashcards.md`);
  if (source.practiceTest && selection.questions) names.push(`${title}-practice-questions.md`);
  const used = new Set<string>();
  return names.map((name) => {
    const dot = name.lastIndexOf(".");
    const stem = name.slice(0, dot), ext = name.slice(dot);
    let candidate = name, n = 2;
    while (used.has(candidate.toLowerCase())) candidate = `${stem}-${n++}${ext}`;
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

function pages(item: { pdfProvenance?: { sources: { page: number }[] }; sourcePage?: number | null }): string {
  const values = [...new Set([...(item.pdfProvenance?.sources.map((s) => s.page) ?? []), ...(item.sourcePage ? [item.sourcePage] : [])])].sort((a, b) => a - b);
  return values.length ? `Source pages: ${values.map((p) => `p. ${p}`).join(", ")}` : "";
}
function author(item: { origin?: string; pdfProvenance?: { status: string; label: string; editOrigin?: string } }): string {
  const labels: string[] = [];
  if (item.pdfProvenance) labels.push(item.pdfProvenance.status === "valid" ? item.pdfProvenance.label : "PDF source details unavailable");
  if (item.origin === "instructor" || item.pdfProvenance?.editOrigin === "instructor") labels.push("Instructor correction");
  else if (item.origin === "user" || item.pdfProvenance?.editOrigin === "user") labels.push("Written or edited by you");
  return labels.join(" · ");
}
const meta = (item: Parameters<typeof author>[0] & Parameters<typeof pages>[0]) => [author(item), pages(item)].filter(Boolean).map((v) => `_${v}_`).join("  \n");
const quote = (value: string) => cleanText(value).split("\n").map((line) => `> ${plainLabel(line)}`).join("\n");

/** Produce deterministic note names and content after applying the correction opt-in filter. */
export function buildMarkdownBundle(all: ExportSource, selection: ExportSelection): MarkdownEntry[] {
  const source = exportSourceFor(all, selection);
  const available = exportableParts(source);
  const title = cleanText(source.material.title) || "Study material";
  const set = source.studySet;
  const out: MarkdownEntry[] = [];
  const names = filenames(source, selection);
  let cursor = 1;
  const links: string[] = [];
  const add = (heading: string, body: string) => {
    const name = names[cursor++]!;
    out.push({ name, text: `# ${plainLabel(heading)}\n\n${body.trim()}\n` });
    links.push(`- [${plainLabel(heading)}](./${name})`);
  };
  out.push({ name: names[0]!, text: `# ${plainLabel(title)}\n\nObsidian-friendly study notes exported from Her Flight Deck.\n\n${links.join("\n")}` });
  if (set && selection.guide && available.guide) {
    if (set.summary.trim()) add(`${title} — Summary`, `${safeGuideBody(set.summary)}\n\n${meta({ pdfProvenance: set.summaryPdfProvenance, origin: set.summaryOrigin ?? undefined })}`);
    for (const section of set.sections) add(`${title} — ${section.heading || "Study guide"}`, `${safeGuideBody(section.body)}\n\n${meta(section)}`);
  }
  if (set && selection.flashcards && available.flashcards) {
    const rows = set.flashcards.map((card, i) => `## Card ${i + 1}\n\n**Front:** ${quote(card.front)}\n\n**Back:** ${quote(card.back)}\n\n${meta(card)}`).join("\n\n");
    add(`${title} — Flashcards`, rows);
  }
  const test = source.practiceTest;
  if (test && selection.questions && available.questions) {
    const body = test.questions.map((q, i) => `## ${i + 1}. ${plainLabel(q.question)}\n\n${q.options.map((o, j) => `- ${String.fromCharCode(65 + j)}. ${plainLabel(o)}`).join("\n")}\n\n**Answer:** ${plainLabel(q.options[q.correctIndex] ?? "")}\n\n**Explanation:** ${plainLabel(q.explanation)}\n\n${meta(q)}`).join("\n\n");
    add(`${title} — Practice questions and answers`, `Answers are included in this note.\n\n${body}`);
  }
  // Rebuild the index after links have been collected.
  out[0]!.text = `# ${plainLabel(title)}\n\nObsidian-friendly study notes exported from Her Flight Deck.\n\n${provenanceNote(source, selection, true)}\n\n${links.join("\n")}\n`;
  return out;
}
