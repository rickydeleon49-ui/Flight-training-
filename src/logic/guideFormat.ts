/**
 * Reading a study guide's formatting (P54-03).
 *
 * Guide bodies are stored exactly as written, often with Markdown-style marks:
 * "- " lists, **bold**, *italic*, "> " quotes and pipe tables. This turns that
 * text into a small set of blocks the guide view can show, so she reads a list
 * rather than a column of dashes and asterisks.
 *
 * Deliberately narrow:
 * - Only headings, paragraphs, lists, quotes, tables, bold, italic and code.
 * - Nothing becomes a link, image or HTML. A link shows its text and address
 *   as plain words; an image shows its description; tags show as typed.
 * - Text with no marks comes back as the same paragraphs, so plain guides
 *   read as they always have.
 * - The saved text is never changed; this only affects how it is shown.
 */

export type GuideInline =
  | { kind: "text"; text: string }
  | { kind: "strong"; children: GuideInline[] }
  | { kind: "em"; children: GuideInline[] }
  | { kind: "code"; text: string };

export type GuideBlock =
  | { kind: "paragraph"; content: GuideInline[] }
  | { kind: "heading"; content: GuideInline[] }
  | { kind: "quote"; blocks: GuideBlock[] }
  | { kind: "list"; ordered: boolean; start: number; items: GuideBlock[][] }
  | { kind: "table"; header: GuideInline[][]; rows: GuideInline[][][] };

/** Longer text is shown as plain paragraphs rather than parsed. */
export const GUIDE_FORMAT_LIMIT = 20_000;

/** Quotes and lists inside lists stop being nested past this depth. */
const MAX_DEPTH = 4;

const HEADING = /^ {0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;
const RULE = /^ {0,3}([-*_])(\s*\1){2,}\s*$/;
const BULLET = /^( *)[-*+]\s+(.*)$/;
const NUMBERED = /^( *)(\d{1,9})[.)]\s+(.*)$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

interface ListMarker {
  ordered: boolean;
  indent: number;
  number: number;
  text: string;
}

function listMarker(line: string): ListMarker | null {
  const numbered = NUMBERED.exec(line);
  if (numbered) return { ordered: true, indent: (numbered[1] ?? "").length, number: Number(numbered[2]), text: numbered[3] ?? "" };
  const bullet = BULLET.exec(line);
  if (bullet && !RULE.test(line)) return { ordered: false, indent: (bullet[1] ?? "").length, number: 1, text: bullet[2] ?? "" };
  return null;
}

const blank = (line: string) => line.trim() === "";
const indentOf = (line: string) => line.length - line.trimStart().length;
const isTableRow = (line: string) => line.includes("|");

function startsTable(lines: string[], i: number): boolean {
  const separator = lines[i + 1];
  return isTableRow(lines[i] ?? "") && separator !== undefined && TABLE_SEPARATOR.test(separator) && separator.includes("-");
}

function startsBlock(lines: string[], i: number): boolean {
  const line = lines[i] ?? "";
  return HEADING.test(line) || QUOTE.test(line) || RULE.test(line) || (listMarker(line)?.indent ?? 4) < 4 || startsTable(lines, i);
}

function splitRow(line: string): string[] {
  let row = line.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|") && !row.endsWith("\\|")) row = row.slice(0, -1);
  const cells: string[] = [];
  let cell = "";
  for (let i = 0; i < row.length; i += 1) {
    const c = row.charAt(i);
    if (c === "\\" && row.charAt(i + 1) === "|") {
      cell += "|";
      i += 1;
    } else if (c === "|") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += c;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function parseBlocks(lines: string[], depth: number): GuideBlock[] {
  if (depth >= MAX_DEPTH) {
    const text = lines.join("\n").trim();
    return text ? [{ kind: "paragraph", content: parseGuideInline(text) }] : [];
  }
  const blocks: GuideBlock[] = [];
  const at = (k: number) => lines[k] ?? "";
  let i = 0;
  while (i < lines.length) {
    const line = at(i);
    if (blank(line) || RULE.test(line)) {
      i += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", content: parseGuideInline(heading[1] ?? "") });
      i += 1;
      continue;
    }

    if (startsTable(lines, i)) {
      const header = splitRow(line);
      const rows: GuideInline[][][] = [];
      i += 2;
      while (i < lines.length && !blank(at(i)) && isTableRow(at(i))) {
        const cells = splitRow(at(i));
        // Every row has the header's columns: missing cells are empty, extra ones dropped.
        rows.push(header.map((_, column) => parseGuideInline(cells[column] ?? "")));
        i += 1;
      }
      blocks.push({ kind: "table", header: header.map((cell) => parseGuideInline(cell)), rows });
      continue;
    }

    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && QUOTE.test(at(i))) {
        inner.push(QUOTE.exec(at(i))?.[1] ?? "");
        i += 1;
      }
      blocks.push({ kind: "quote", blocks: parseBlocks(inner, depth + 1) });
      continue;
    }

    const first = listMarker(line);
    if (first && first.indent < 4) {
      const items: string[][] = [];
      const base = first.indent;
      while (i < lines.length) {
        const current = at(i);
        const marker = listMarker(current);
        if (marker && marker.ordered === first.ordered && marker.indent >= base && marker.indent <= base + 1) {
          items.push([marker.text]);
          i += 1;
        } else if (blank(current)) {
          // A blank line ends the list unless the list or this item carries on after it.
          const next = lines[i + 1];
          if (next === undefined) break;
          const nextMarker = listMarker(next);
          const continues = indentOf(next) > base + 1 || (nextMarker?.ordered === first.ordered && nextMarker.indent <= base + 1);
          if (!continues) break;
          items.at(-1)?.push("");
          i += 1;
        } else if (indentOf(current) > base + 1) {
          // Indented under an item: part of that item, including a nested list.
          items.at(-1)?.push(current.slice(Math.min(indentOf(current), base + 2)));
          i += 1;
        } else {
          break;
        }
      }
      blocks.push({
        kind: "list",
        ordered: first.ordered,
        start: first.number,
        items: items.map((item) => parseBlocks(item, depth + 1)),
      });
      continue;
    }

    const paragraph: string[] = [line.trim()];
    i += 1;
    while (i < lines.length && !blank(at(i)) && !startsBlock(lines, i)) {
      paragraph.push(at(i).trim());
      i += 1;
    }
    blocks.push({ kind: "paragraph", content: parseGuideInline(paragraph.join("\n")) });
  }
  return blocks;
}

/** The blocks one guide body is shown as. */
export function parseGuideBody(text: string): GuideBlock[] {
  const normalized = text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ");
  if (normalized.length > GUIDE_FORMAT_LIMIT) {
    return normalized
      .split(/\n\s*\n/)
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => ({ kind: "paragraph", content: [{ kind: "text", text: part }] }));
  }
  return parseBlocks(normalized.split("\n"), 0);
}

const ESCAPABLE = new Set(["\\", "`", "*", "_", "[", "]", "(", ")", "#", ">", "|", "!", "-", "+", "."]);
const LINK = /^\[([^\]\n]*)\]\(([^)\s]*)\)/;
const wordChar = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);

/** Where a single `*` or `_` emphasis opened at `open` closes, or -1. */
function closeSingle(text: string, open: number, mark: string): number {
  for (let j = open + 1; j < text.length; j += 1) {
    if (text[j] === "\\") {
      j += 1;
    } else if (text[j] === mark) {
      if (text[j + 1] === mark) {
        // A doubled mark inside is its own strong span; step over it.
        const end = text.indexOf(mark + mark, j + 2);
        if (end === -1) return -1;
        j = end + 1;
      } else if (text[j - 1] !== " " && text[j - 1] !== "\n") {
        if (mark === "_" && wordChar(text[j + 1])) continue;
        return j;
      }
    }
  }
  return -1;
}

/** Bold, italic and code within one piece of text; everything else stays as written. */
export function parseGuideInline(text: string, depth = 0): GuideInline[] {
  const out: GuideInline[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer) out.push({ kind: "text", text: buffer });
    buffer = "";
  };
  const nested = depth < MAX_DEPTH;

  let i = 0;
  while (i < text.length) {
    const c = text.charAt(i);
    const next: string | undefined = text[i + 1];

    if (c === "\\" && next !== undefined && ESCAPABLE.has(next)) {
      buffer += next;
      i += 2;
      continue;
    }

    if (c === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > i + 1) {
        flush();
        out.push({ kind: "code", text: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    if (nested && (c === "*" || c === "_") && next === c) {
      const mark = c + c;
      const end = text.indexOf(mark, i + 2);
      const opens = i + 2 < text.length && !/\s/.test(text.charAt(i + 2));
      const intraword = c === "_" && (wordChar(text[i - 1]) || wordChar(text[end + 2]));
      if (opens && end > i + 2 && !/\s/.test(text.charAt(end - 1)) && !intraword) {
        flush();
        out.push({ kind: "strong", children: parseGuideInline(text.slice(i + 2, end), depth + 1) });
        i = end + 2;
        continue;
      }
    }

    if (nested && (c === "*" || c === "_") && next !== undefined && !/\s/.test(next) && next !== c) {
      const opens = c === "*" || !wordChar(text[i - 1]);
      const end = opens ? closeSingle(text, i, c) : -1;
      if (end > i + 1) {
        flush();
        out.push({ kind: "em", children: parseGuideInline(text.slice(i + 1, end), depth + 1) });
        i = end + 1;
        continue;
      }
    }

    if (c === "!" && next === "[") {
      const image = LINK.exec(text.slice(i + 1));
      if (image) {
        // Never loaded: an image is shown only by its description.
        buffer += image[1] ?? "";
        i += 1 + image[0].length;
        continue;
      }
    }

    if (c === "[") {
      const link = LINK.exec(text.slice(i));
      if (link) {
        // Never a live link: the text and the address are both shown as words.
        const [whole, label, address] = link;
        buffer += !address || label === address ? label : `${label} (${address})`;
        i += whole.length;
        continue;
      }
    }

    buffer += c;
    i += 1;
  }
  flush();
  return out;
}

/** The words a block shows, without any formatting; for tests and accessible summaries. */
export function guideInlineText(content: GuideInline[]): string {
  return content.map((part) => (part.kind === "text" || part.kind === "code" ? part.text : guideInlineText(part.children))).join("");
}
