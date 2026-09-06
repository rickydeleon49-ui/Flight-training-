/**
 * What Gemini will accept, decided before she waits for it.
 *
 * The Rust side enforces these limits and holds the reasoning behind each
 * number — see `src-tauri/src/gemini.rs`. They are repeated here so an
 * oversized or unreadable file is answered while she is looking at the
 * material, rather than after a click, an upload, and a wait.
 *
 * They are Google's limits, not this application's. A PDF is read up to 50 MB
 * or 1,000 pages, whichever comes first, and that is the same whether the
 * bytes are sent inline or uploaded first, so there is no larger number to
 * move to.
 */

export const MAX_PDF_BYTES = 50 * 1024 * 1024;
/** Anything else rides the inline request cap, raised to 100 MB in 2026. */
export const MAX_INLINE_BYTES = 100 * 1024 * 1024;
/** Text runs out of context window long before it runs out of request. */
export const MAX_TEXT_BYTES = 4 * 1024 * 1024;

/** The file types Google reads, by extension. */
const TYPES: Array<{ extensions: string[]; kind: "pdf" | "text" | "image" }> = [
  { extensions: [".pdf"], kind: "pdf" },
  { extensions: [".txt", ".md"], kind: "text" },
  { extensions: [".png", ".jpg", ".jpeg", ".webp"], kind: "image" },
];

const LIMITS = {
  pdf: MAX_PDF_BYTES,
  text: MAX_TEXT_BYTES,
  image: MAX_INLINE_BYTES,
} as const;

const ADVICE = {
  pdf:
    "Google reads a PDF up to 50 MB or 1,000 pages, whichever comes first. Split the " +
    "handbook and add the chapter you are studying as its own file — a study aid from " +
    "one chapter is more useful than one from the whole book anyway.",
  text:
    "A text file this size is more than the model can hold in mind at once. Add the " +
    "part you are studying as its own file.",
  image: "Save it at a smaller size, or add the page you are studying on its own.",
} as const;

export type AiFileVerdict = { ready: true } | { ready: false; reason: string };

/** Bytes as she would say them: "62 MB", not "65,011,712 bytes". */
export function describeFileSize(bytes: number): string {
  const mb = 1024 * 1024;
  if (bytes >= mb) return `${Math.ceil(bytes / mb)} MB`;
  return `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
}

/**
 * Whether this file can be sent at all.
 *
 * A size of null means the record predates file sizes being stored; that is
 * not a reason to stop her trying, so only the type is judged.
 */
export function checkFileForGemini(
  fileName: string,
  bytes: number | null,
): AiFileVerdict {
  const lower = fileName.toLowerCase();
  const match = TYPES.find((type) =>
    type.extensions.some((extension) => lower.endsWith(extension)),
  );

  if (!match) {
    return {
      ready: false,
      reason:
        "Gemini study tools read PDF, TXT, Markdown, PNG, JPG, and WebP files. " +
        "Convert this one to PDF first.",
    };
  }

  const limit = LIMITS[match.kind];
  if (bytes !== null && bytes > limit) {
    return {
      ready: false,
      reason:
        `This file is ${describeFileSize(bytes)}, over the ${describeFileSize(limit)} ` +
        `limit for this kind of file. ${ADVICE[match.kind]}`,
    };
  }

  return { ready: true };
}
