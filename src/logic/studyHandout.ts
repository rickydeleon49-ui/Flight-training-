import { PDF_KIT_LABEL, pdfEditLabel } from "./pdfKitLabels";
import type { PdfItemProvenance } from "@/data/pdfKitSources";
/**
 * A printable study handout (P54-04).
 *
 * One self-contained HTML page for the parts she chose: the guide with its
 * formatting, flashcards as a two-column sheet, and practice questions with
 * an optional answer key at the end on its own page. She opens it in any
 * browser and prints it or saves it as a PDF.
 *
 * The page cannot run or load anything: every piece of text is escaped, its
 * Content-Security-Policy allows only its own inline styles, and the guide
 * formatter never produces links or images.
 */
import { parseGuideBody, type GuideBlock, type GuideInline } from "@/logic/guideFormat";
import { exportableParts, exportSourceFor, provenanceNote, type ExportSelection, type ExportSource } from "@/logic/studyExport";

export interface HandoutOptions {
  answerKey: boolean;
}

const LETTERS = ["A", "B", "C", "D", "E", "F"] as const;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Plain text with its line breaks kept. */
function lines(value: string): string {
  return escapeHtml(value.trim()).replace(/\n/g, "<br>");
}

function inlineHtml(content: GuideInline[]): string {
  return content
    .map((part) => {
      switch (part.kind) {
        case "text":
          return escapeHtml(part.text).replace(/\n/g, "<br>");
        case "code":
          return `<code>${escapeHtml(part.text)}</code>`;
        case "strong":
          return `<strong>${inlineHtml(part.children)}</strong>`;
        case "em":
          return `<em>${inlineHtml(part.children)}</em>`;
      }
    })
    .join("");
}

export function guideBlocksHtml(blocks: GuideBlock[]): string {
  return blocks
    .map((block) => {
      switch (block.kind) {
        case "paragraph":
          return `<p>${inlineHtml(block.content)}</p>`;
        case "heading":
          return `<p class="subhead">${inlineHtml(block.content)}</p>`;
        case "quote":
          return `<blockquote>${guideBlocksHtml(block.blocks)}</blockquote>`;
        case "list": {
          const items = block.items
            .map((item) => {
              const only = item.length === 1 ? item[0] : undefined;
              return `<li>${only?.kind === "paragraph" ? inlineHtml(only.content) : guideBlocksHtml(item)}</li>`;
            })
            .join("");
          if (!block.ordered) return `<ul>${items}</ul>`;
          return `<ol${block.start === 1 ? "" : ` start="${block.start}"`}>${items}</ol>`;
        }
        case "table": {
          const head = block.header.map((cell) => `<th scope="col">${inlineHtml(cell)}</th>`).join("");
          const rows = block.rows.map((row) => `<tr>${row.map((cell) => `<td>${inlineHtml(cell)}</td>`).join("")}</tr>`).join("");
          return `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
        }
      }
    })
    .join("");
}

/** Who wrote an item, for a handout others may read; nothing for generated items. */
function authorRef(origin: unknown, pdf?: PdfItemProvenance): string {
  if (pdf) {
    const label = pdf.status === "valid" ? [PDF_KIT_LABEL, pdfEditLabel(origin)].filter(Boolean).join(" · ") : "Source details unavailable";
    return ` <span class="ref">${escapeHtml(label)}</span>`;
  }
  if (origin === "instructor") return ` <span class="ref">(instructor correction)</span>`;
  if (origin === "user") return ` <span class="ref">(written by hand)</span>`;
  return "";
}

function pageRef(page: number | null): string {
  return page ? ` <span class="ref">(source p. ${page})</span>` : "";
}

/** The printable-page styles, shared with the lesson brief (P54-05). */
export const PRINT_STYLE = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0 auto; max-width: 46rem; padding: 2rem 1.5rem 3rem; font: 11.5pt/1.5 -apple-system, "Helvetica Neue", Arial, sans-serif; color: #1f2328; background: #fff; }
h1 { font-size: 20pt; margin: 0 0 .25rem; }
h2 { font-size: 14pt; margin: 2rem 0 .75rem; padding-bottom: .25rem; border-bottom: 1px solid #c9ccd1; }
h3 { font-size: 12pt; margin: 1.25rem 0 .5rem; }
p { margin: 0 0 .6rem; }
.meta, .ref { color: #57606a; font-size: 9.5pt; }
.notice { margin: 1rem 0 0; padding: .6rem .8rem; border: 1px solid #c9ccd1; border-radius: 6px; font-size: 9.5pt; }
.subhead { font-weight: 600; }
ul, ol { margin: 0 0 .6rem; padding-left: 1.4rem; }
li { margin: .15rem 0; }
blockquote { margin: 0 0 .6rem; padding: .1rem 0 .1rem .8rem; border-left: 3px solid #c9ccd1; color: #444c56; }
code { font-family: ui-monospace, Menlo, monospace; font-size: .92em; }
table { border-collapse: collapse; width: 100%; margin: 0 0 .8rem; }
thead { display: table-header-group; }
th, td { border: 1px solid #c9ccd1; padding: .35rem .5rem; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
th { background: #f3f4f6; }
.cards td { width: 50%; }
.cards tr, .question, li { break-inside: avoid; page-break-inside: avoid; }
.practice-heading-keep { break-inside: avoid; page-break-inside: avoid; }
.question { margin: 0 0 1rem; }
.choices { list-style: none; padding-left: .5rem; }
.answer-key { break-before: page; }
h1, h2, h3, p { orphans: 3; widows: 3; }
@page { size: auto; margin: 0.6in; }
@media print { body { padding: 0; max-width: none; } h2, h3 { break-after: avoid; page-break-after: avoid; } }
`;

/** The handout page for the chosen parts. */
function handoutSections(allContent: ExportSource, selection: ExportSelection, options: HandoutOptions, includeAnswerKey = true): string[] {
  // Her instructor's corrections are left out unless she included them.
  const source = exportSourceFor(allContent, selection);
  const available = exportableParts(source);
  const set = source.studySet;
  const test = source.practiceTest;
  const sections: string[] = [];

  if (set && selection.guide && available.guide) {
    const parts = [`<h2>Study guide</h2>`];
    if (set.summary.trim()) parts.push(`<p>${lines(set.summary)}${authorRef(set.summaryOrigin, set.summaryPdfProvenance)}</p>`);
    for (const section of set.sections) {
      parts.push(`<h3>${escapeHtml(section.heading)}${authorRef(section.origin, section.pdfProvenance)}</h3>${guideBlocksHtml(parseGuideBody(section.body))}`);
    }
    if (set.sourceNotes.trim()) parts.push(`<p class="meta">${lines(set.sourceNotes)}</p>`);
    sections.push(`<section>${parts.join("")}</section>`);
  }

  if (set && selection.flashcards && available.flashcards) {
    const rows = set.flashcards
      .map((card) => `<tr><td>${lines(card.front)}${authorRef(card.origin, card.pdfProvenance)}</td><td>${lines(card.back)}${pageRef(card.sourcePage)}</td></tr>`)
      .join("");
    sections.push(
      `<section><h2>Flashcards</h2><table class="cards"><thead><tr><th scope="col">Front</th><th scope="col">Back</th></tr></thead><tbody>${rows}</tbody></table></section>`,
    );
  }

  if (test && selection.questions && available.questions) {
    const questionElements = test.questions.map((question, index) => {
      const choices = question.options
        .map((option, choice) => `<li>${LETTERS[choice] ?? choice + 1}. ${escapeHtml(option)}</li>`)
        .join("");
      return `<div class="question"><p><strong>${index + 1}.</strong> ${lines(question.question)}${authorRef(question.origin, question.pdfProvenance)}${pageRef(question.sourcePage)}</p><ul class="choices">${choices}</ul></div>`;
    });

    let questionsHtml = "";
    if (questionElements.length > 0) {
      const first = questionElements[0];
      const rest = questionElements.slice(1).join("");
      questionsHtml = `<div class="practice-heading-keep"><h2>Practice questions</h2>${first}</div>${rest}`;
    } else {
      questionsHtml = `<h2>Practice questions</h2>`;
    }

    sections.push(`<section>${questionsHtml}</section>`);
    if (options.answerKey && includeAnswerKey) {
      const answers = test.questions
        .map((question, index) => {
          const letter = LETTERS[question.correctIndex] ?? String(question.correctIndex + 1);
          const answer = question.options[question.correctIndex] ?? "";
          return `<li><strong>${index + 1}. ${letter}</strong>: ${escapeHtml(answer)}<br><span class="meta">${lines(question.explanation)}</span></li>`;
        })
        .join("");
      sections.push(`<section class="answer-key"><h2>Answer key</h2><ol class="choices">${answers}</ol></section>`);
    }
  }

  return sections;
}

function documentHtml(title: string, date: Date, notice: string, sections: string[]): string {
  const formattedDate = date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)}</title>
<style>${PRINT_STYLE}</style>
</head>
<body>
<header>
<h1>${escapeHtml(title)}</h1>
<p class="meta">Study handout from Her Flight Deck · ${escapeHtml(formattedDate)}</p>
<p class="notice">${escapeHtml(notice)}</p>
<p class="print-help">To make a PDF, open this file in a browser, choose Print, then Save as PDF.</p>
</header>
${sections.join("\n")}
</body>
</html>
`;
}

/** The handout page for the chosen parts. */
export function buildHandoutHtml(allContent: ExportSource, selection: ExportSelection, options: HandoutOptions, createdAt: Date): string {
  const source = exportSourceFor(allContent, selection);
  const title = source.material.title.trim() || "Study handout";
  return documentHtml(title, createdAt, provenanceNote(source, selection), handoutSections(allContent, selection, options));
}

/** One printable document for an ordered set of selected materials. */
export function buildMultiMaterialHandoutHtml(
  items: Array<{ source: ExportSource; selection: ExportSelection }>,
  options: HandoutOptions,
  createdAt: Date,
): string {
  const sections: string[] = [];
  const notices: string[] = [];
  const answers: Array<{ title: string; html: string }> = [];
  for (const { source: original, selection } of items) {
    const source = exportSourceFor(original, selection);
    const title = source.material.title.trim() || "Study handout";
    const selected = handoutSections(original, selection, { answerKey: false });
    if (options.answerKey) {
      const key = handoutSections(original, selection, { answerKey: true }).find((part) => part.includes('class="answer-key"'));
      if (key) answers.push({ title, html: key });
    }
    sections.push(`<section class="material"><h2>${escapeHtml(title)}</h2>${selected.join("")}</section>`);
    notices.push(`${title}: ${provenanceNote(source, selection)}`);
  }
  if (answers.length) {
    const keys = answers.map(({ title: materialTitle, html }) =>
      `<h3>${escapeHtml(materialTitle)}</h3>${html.replace(/<section class="answer-key"><h2>Answer key<\/h2>|<\/section>/g, "")}`,
    );
    sections.push(`<section class="answer-key"><h2>Answer key</h2>${keys.join("")}</section>`);
  }
  const title = items.length === 1 ? items[0]!.source.material.title.trim() || "Study handout" : "Study handout";
  return documentHtml(title, createdAt, notices.join(" "), sections);
}
