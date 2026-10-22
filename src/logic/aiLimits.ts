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

/** Human-readable file size, e.g. "1.4 MB" or "204.7 MB". */
export function formatFileSize(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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
        `This file is ${formatFileSize(bytes)}, over the ${describeFileSize(limit)} ` +
        `limit for this kind of file. ${ADVICE[match.kind]}`,
    };
  }

  return { ready: true };
}

/** A page range, judged before any pages are written. */
export type SplitRangeVerdict =
  | { ok: true; pages: number }
  | { ok: false; pages: number; reason: string };

/**
 * Whether a chapter taken from these pages is one Google would read.
 *
 * The Rust side refuses a range past `maxPagesPerSplit` after doing the work
 * — see `src-tauri/src/pdf.rs`. Deciding the same thing here means an
 * impossible range is answered while she is choosing it, instead of being
 * called "well inside the limits" and then rejected.
 */
export function checkSplitRange(
  firstPage: number,
  lastPage: number,
  totalPages: number,
  maxPagesPerSplit: number,
): SplitRangeVerdict {
  const sensible =
    Number.isInteger(firstPage) &&
    Number.isInteger(lastPage) &&
    firstPage >= 1 &&
    lastPage >= firstPage &&
    lastPage <= totalPages;

  if (!sensible) {
    return {
      ok: false,
      pages: 0,
      reason: `Choose a first and last page inside 1–${totalPages.toLocaleString()}.`,
    };
  }

  const pages = lastPage - firstPage + 1;
  if (pages > maxPagesPerSplit) {
    return {
      ok: false,
      pages,
      reason:
        `That is ${pages.toLocaleString()} pages. Google reads ` +
        `${maxPagesPerSplit.toLocaleString()} at a time, so choose a smaller range — a ` +
        `chapter makes a better study aid than a whole book anyway.`,
    };
  }

  return { ok: true, pages };
}
