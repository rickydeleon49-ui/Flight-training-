/**
 * Word-level "what changed" between two versions of the same text (JSDIFF-01).
 * Pure: no DOM, no storage. Callers render the parts as plain text children.
 */
import { diffWords } from "diff";

export interface TextDiffPart {
  readonly kind: "same" | "added" | "removed";
  readonly text: string;
}

/** Longer texts fall back to showing both versions as they are today. */
export const WORD_DIFF_MAX_CHARS = 4_000;

// Word boundaries that keep emoji and accented letters whole, where available.
const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "word" }) : undefined;

/**
 * The words removed from `before` and added in `after`, in reading order.
 * Joining the "same" and "added" parts gives `after` exactly. Whitespace-only
 * changes are not reported. Returns null when either side is over
 * WORD_DIFF_MAX_CHARS, so callers show the texts without highlighting.
 */
export function wordDiff(before: string, after: string): TextDiffPart[] | null {
  if (before.length > WORD_DIFF_MAX_CHARS || after.length > WORD_DIFF_MAX_CHARS) return null;
  const changes = segmenter ? diffWords(before, after, { intlSegmenter: segmenter }) : diffWords(before, after);
  const parts: TextDiffPart[] = [];
  for (const change of changes) {
    if (!change.value) continue;
    const kind = change.added ? "added" : change.removed ? "removed" : "same";
    const last = parts[parts.length - 1];
    if (last && last.kind === kind) parts[parts.length - 1] = { kind, text: last.text + change.value };
    else parts.push({ kind, text: change.value });
  }
  return parts;
}
