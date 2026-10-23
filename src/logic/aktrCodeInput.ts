/**
 * Pure helper for tokenizing and normalizing manually entered AKTR topic codes.
 *
 * NOTE: This is purely textual tokenization, whitespace cleanup, deduplication,
 * and ASCII letter case-folding. It is NOT code validation, FAA interpretation,
 * exam-question lookup, or readiness scoring. It does not verify codes against
 * an authoritative FAA topic catalog.
 */

/**
 * Splits raw user input containing topic codes on whitespace, commas, and semicolons,
 * trims each token, folds ASCII letters to uppercase, and preserves first-seen order
 * while removing duplicates.
 *
 * Every non-empty token is preserved (even unknown or oddly shaped strings), so that
 * later stages can leave unrecognized or outdated codes unresolved rather than silently
 * discarding them.
 *
 * @param input Raw text input from user
 * @returns Array of normalized topic code tokens in first-seen order
 */
export function tokenizeAktrCodes(input: string): string[] {
  if (!input) {
    return [];
  }

  // Split on whitespace, commas, and semicolons
  const rawTokens = input.split(/[\s,;]+/);
  const seen = new Set<string>();
  const result: string[] = [];

  for (const rawToken of rawTokens) {
    const trimmed = rawToken.trim();
    if (!trimmed) {
      continue;
    }
    const normalized = trimmed.replace(/[a-z]/g, (letter) => letter.toUpperCase());
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }

  return result;
}
