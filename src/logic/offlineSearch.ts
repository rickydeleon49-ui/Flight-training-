/**
 * Plain wording and safe snippet handling for searching inside prepared
 * documents (OFFLINE-02b; design docs/OFFLINE_02_SEARCH_DESIGN_2026-10-19.md).
 *
 * A snippet is document text and is only ever rendered as text: it is split
 * here into plain and highlighted pieces, never treated as HTML.
 */
import type { SearchCoverage } from "@/services/offlineContent";

export const MARK_START = "\u{E000}";
export const MARK_END = "\u{E001}";

export interface SnippetPiece {
  text: string;
  mark: boolean;
}

/** Split a snippet on its match markers. Stray or nested markers are ignored. */
export function snippetPieces(snippet: string): SnippetPiece[] {
  const pieces: SnippetPiece[] = [];
  let mark = false;
  let text = "";
  const flush = () => {
    if (text) pieces.push({ text, mark });
    text = "";
  };
  for (const ch of snippet) {
    if (ch === MARK_START) {
      if (!mark) {
        flush();
        mark = true;
      }
    } else if (ch === MARK_END) {
      if (mark) {
        flush();
        mark = false;
      }
    } else {
      text += ch;
    }
  }
  flush();
  return pieces;
}

const count = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/**
 * One or two sentences about what was searched, so "no match" is never
 * confused with "not searched yet".
 */
export function coverageSentence(c: SearchCoverage, found: number, savedSearched = false, homeworkSearched = false): string {
  const parts: string[] = [];
  if (c.searchedDocuments === 0) {
    parts.push(savedSearched
      ? `PDF text isn’t ready to search yet — ${homeworkSearched ? "your saved study content and homework were searched" : "your saved study content was searched"}.`
      : "PDF text isn’t ready to search yet.");
  } else if (found === 0) {
    parts.push(`No matches in ${count(c.searchedDocuments, "document", "documents")} (${count(c.searchedPages, "page", "pages")}).`);
  } else {
    parts.push(`Searched ${count(c.searchedDocuments, "document", "documents")} (${count(c.searchedPages, "page", "pages")}).`);
  }
  if (c.notPrepared > 0) parts.push(`${count(c.notPrepared, "document isn't", "documents aren't")} prepared for offline search yet. Open each document in Study Library and choose “Read this PDF's text”.`);
  if (c.notChecked > 0) parts.push(`${count(c.notChecked, "document is", "documents are")} still being checked.`);
  if (c.preparing > 0) parts.push(`${count(c.preparing, "document is", "documents are")} being prepared.`);
  if (c.couldNotPrepare > 0) parts.push(`${count(c.couldNotPrepare, "document", "documents")} couldn't be prepared.`);
  if (c.missing > 0) parts.push(`${count(c.missing, "file is", "files are")} missing from this Mac.`);
  if (c.imagePages > 0) parts.push(`${count(c.imagePages, "page is an image", "pages are images")}, so text recognition would be needed to search ${c.imagePages === 1 ? "it" : "them"}.`);
  if (c.otherUnsearchablePages > 0) parts.push(`${count(c.otherUnsearchablePages, "page", "pages")} couldn't be read.`);
  return parts.join(" ");
}

/** Plain words for a search that couldn't run, or null when nothing should be said. */
export function searchProblem(code: string): string | null {
  switch (code) {
    case "superseded":
    case "empty_query":
      return null;
    case "query_too_long":
      return "That search is a bit long. Try fewer words.";
    case "too_many_terms":
      return "Try up to 8 words or phrases.";
    case "term_too_long":
      return "One of those words is very long. Try a shorter one.";
    case "timeout":
      return "That search took too long. Try more specific words.";
    case "offset_too_deep":
      return "That's as far as these results go. Narrow your search to see more.";
    case "too_many_materials":
      return "Narrow the filters to search inside fewer documents at once.";
    case "index_unavailable":
      return "Search inside documents isn't available right now. Try again in a moment.";
    default:
      return "Search inside documents didn't work just now. Try again in a moment.";
  }
}

/** What to say after re-checking a result's file before opening it. */
export function destinationProblem(check: "changed" | "missing"): string {
  return check === "changed"
    ? "This document changed since you searched. Search again to see its current pages."
    : "This document's file isn't on this Mac any more.";
}

/** "PDF page 3", plus the original's page for a split part when it is known. */
export function pagePlace(page: number, lineage: { sourcePageStart: number; childPageCount: number; sourceTitle: string } | null | undefined): string {
  const base = `PDF page ${page}`;
  if (!lineage || page < 1 || page > lineage.childPageCount) return base;
  return `${base} (page ${lineage.sourcePageStart + page - 1} of ${lineage.sourceTitle})`;
}
