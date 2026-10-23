const MAX_CONTEXT_CODE_POINTS = 8000;

/** Build the PDF Ask context without cutting a UTF-16 surrogate pair in half. */
export function pdfAskContext(title: string | null | undefined, summary: string | null | undefined): string {
  const combined = `${title || ""}${summary ? `\n\n${summary}` : ""}`;
  const points = Array.from(combined);
  return points.length > MAX_CONTEXT_CODE_POINTS
    ? points.slice(0, MAX_CONTEXT_CODE_POINTS).join("")
    : combined;
}
