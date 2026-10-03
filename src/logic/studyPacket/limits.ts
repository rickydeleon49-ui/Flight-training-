/**
 * Limits and fixed name lists for the `hfd-study-packet` version 1 format.
 *
 * The numbers come from the accepted contract
 * (docs/STRUCTURED_STUDY_IMPORT_CONTRACT_2026-10-03.md, §2.2, §2.3 and §2.11).
 * Three are reused from existing app limits; the rest were proposed by the
 * contract to keep one displayed card, choice or section predictable.
 */

export const FORMAT = "hfd-study-packet";
export const FORMAT_VERSION = 1;

export const LIMITS = Object.freeze({
  /** Reused: MAX_TEXT_BYTES in src/logic/aiLimits.ts and src-tauri/src/gemini.rs. */
  fileBytes: 4 * 1024 * 1024,
  depth: 8,
  objectKeys: 32,
  keyCodePoints: 64,
  integerDigits: 9,
  values: 250_000,
  title: 200,
  sourceGenerator: 100,
  sourceCreatedAt: 40,
  sourceNote: 1_000,
  summary: 20_000,
  sections: 100,
  heading: 200,
  body: 20_000,
  sourceNotes: 5_000,
  flashcards: 500,
  front: 1_000,
  back: 2_000,
  questions: 200,
  question: 2_000,
  /** Reused: a practice question always has at least two options. */
  choicesMin: 2,
  choicesMax: 6,
  choiceText: 500,
  explanation: 4_000,
  sourceRefs: 5,
  refLabel: 200,
  pageMin: 1,
  /** Reused: pdf::MAX_PAGES. */
  pageMax: 1_000,
  reportedErrors: 50,
});

export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
export const CHOICE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,31}$/;

/**
 * Field names owned by the contract. Only these, and numeric indexes, may
 * appear in a diagnostic path. Any other key is packet content, however
 * ordinary it looks, and is shown as `<field>`.
 */
export const CONTRACT_FIELDS: ReadonlySet<string> = new Set([
  "format", "formatVersion", "title", "source", "generator", "createdAt", "note", "guide", "summary",
  "sections", "heading", "body", "sourceNotes", "flashcards", "id", "front", "back", "sourceRefs", "label",
  "page", "questions", "type", "question", "choices", "text", "correctChoiceId", "explanation",
]);

/** Never accepted anywhere: assigning them can change an object's prototype. */
export const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Fixed allowlists. A matching key is already a known word, so naming it in a
 * targeted error repeats nothing private.
 */
export const DIRECTIVE_FIELDS: ReadonlySet<string> = new Set([
  "actions", "commands", "command", "script", "scripts", "exec", "execute", "run", "fetch", "upload",
  "download", "webhook", "callback", "instructions", "system", "systemPrompt", "onImport", "onLoad",
  "html", "mdx", "jsx", "apiKey", "token", "credentials",
]);

export const LEGACY_ANSWER_FIELDS: ReadonlySet<string> = new Set([
  "correctIndex", "answerIndex", "answer", "correct", "correctAnswer", "correctChoice", "answers",
  "correctChoiceIds",
]);
