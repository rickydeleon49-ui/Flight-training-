/**
 * A Gemini failure in her words, with any technical trace kept apart.
 *
 * The native side appends a sanitized "Details: stage …; attempts …" line to
 * some failures. That line helps when reporting a problem but reads as jargon
 * in the main sentence, so it is shown only inside a collapsed "Details".
 */
export function splitGeminiError(message: string): { text: string; details: string | null } {
  const match = /(?:^|\n|\s)Details:\s*/.exec(message);
  if (!match) return { text: message.trim(), details: null };
  const text = message.slice(0, match.index).trim();
  const details = message.slice(match.index + match[0].length).trim();
  if (!text) return { text: message.trim(), details: null };
  return { text, details: details || null };
}
