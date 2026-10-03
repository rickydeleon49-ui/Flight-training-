/**
 * Structural validation with Zod, after the scanner and the version gate.
 *
 * `jitless` is set here, before any schema exists. The app's CSP is
 * `script-src 'self'` without 'unsafe-eval'; by default Zod 4 probes
 * `new Function`, which a strict CSP reports as a violation even though Zod
 * catches it. Never import `zod/compile`.
 */
import * as z from "zod";

import { CHOICE_ID_PATTERN, DIRECTIVE_FIELDS, FORMAT, FORMAT_VERSION, ID_PATTERN, LEGACY_ANSWER_FIELDS, LIMITS } from "./limits";
import { pathFromParts, rawError, type RawError } from "./diagnostics";
import { codePointLength } from "./scan";
import type { PacketErrorCode } from "./types";

z.config({ jitless: true });

// Deterministic normalization (contract §2.8).
/** Single-line fields: LF, NFC, every whitespace run becomes one space, trimmed. */
export function normalizeLine(value: string): string {
  return value.replace(/\r\n?/g, "\n").normalize("NFC").replace(/\s+/g, " ").trim();
}
/** Block fields: LF, NFC, leading blank lines and trailing whitespace removed; first-line indentation kept. */
export function normalizeBlock(value: string): string {
  return value.replace(/\r\n?/g, "\n").normalize("NFC").replace(/^(?:[ \t]*\n)+/, "").replace(/\s+$/, "");
}

/** A normalized string whose limits count Unicode code points after normalization. */
function text(kind: "line" | "block", { min = 0, max }: { min?: number; max: number }) {
  return z.string().transform((raw, ctx) => {
    const value = kind === "line" ? normalizeLine(raw) : normalizeBlock(raw);
    const length = codePointLength(value);
    if (min > 0 && length === 0) {
      ctx.issues.push({ code: "custom", input: raw, params: { hfd: "empty_required" } });
      return z.NEVER;
    }
    if (length > max) {
      ctx.issues.push({ code: "custom", input: raw, params: { hfd: "too_long", limit: max } });
      return z.NEVER;
    }
    return value;
  });
}

const id = z.string().regex(ID_PATTERN);
const choiceId = z.string().regex(CHOICE_ID_PATTERN);

const sourceRef = z.strictObject({
  label: text("line", { max: LIMITS.refLabel }).optional(),
  page: z.int().min(LIMITS.pageMin).max(LIMITS.pageMax).optional(),
});
const sourceRefs = z.array(sourceRef).max(LIMITS.sourceRefs);

const section = z.strictObject({
  heading: text("line", { min: 1, max: LIMITS.heading }),
  body: text("block", { min: 1, max: LIMITS.body }),
});

const guide = z.strictObject({
  summary: text("block", { max: LIMITS.summary }).optional(),
  sections: z.array(section).max(LIMITS.sections).optional(),
  sourceNotes: text("block", { max: LIMITS.sourceNotes }).optional(),
});

const flashcard = z.strictObject({
  id,
  front: text("block", { min: 1, max: LIMITS.front }),
  back: text("block", { min: 1, max: LIMITS.back }),
  sourceRefs: sourceRefs.optional(),
});

const choice = z.strictObject({
  id: choiceId,
  text: text("line", { min: 1, max: LIMITS.choiceText }),
});

const question = z.strictObject({
  id,
  type: z.literal("single-choice"),
  question: text("block", { min: 1, max: LIMITS.question }),
  choices: z.array(choice).min(LIMITS.choicesMin).max(LIMITS.choicesMax),
  correctChoiceId: choiceId,
  explanation: text("block", { min: 1, max: LIMITS.explanation }),
  sourceRefs: sourceRefs.optional(),
});

export const packetSchema = z.strictObject({
  format: z.literal(FORMAT),
  formatVersion: z.literal(FORMAT_VERSION),
  title: text("line", { min: 1, max: LIMITS.title }),
  source: z
    .strictObject({
      generator: text("line", { max: LIMITS.sourceGenerator }).optional(),
      createdAt: text("line", { max: LIMITS.sourceCreatedAt }).optional(),
      note: text("block", { max: LIMITS.sourceNote }).optional(),
    })
    .optional(),
  guide: guide.optional(),
  flashcards: z.array(flashcard).max(LIMITS.flashcards).optional(),
  questions: z.array(question).max(LIMITS.questions).optional(),
});

/** The validated, normalized packet. */
export type ValidatedPacket = z.output<typeof packetSchema>;

function lastKey(path: ReadonlyArray<PropertyKey>): string | undefined {
  for (let k = path.length - 1; k >= 0; k--) {
    const part = path[k];
    if (typeof part === "string") return part;
  }
  return undefined;
}

/**
 * Zod issues to contract codes. Reads `input` only to classify (null versus a
 * number versus an array); never copies it, the issue message or an unknown key.
 */
export function mapIssue(issue: z.core.$ZodIssue): RawError[] {
  const path = pathFromParts(issue.path);
  if (issue.code === "custom") {
    const params = issue.params as { hfd?: PacketErrorCode; limit?: number } | undefined;
    if (params?.hfd) return [rawError(params.hfd, path, params.limit ? { limit: params.limit } : {})];
    return [rawError("invalid_value", path)];
  }
  if (issue.code === "unrecognized_keys") {
    return issue.keys.map((key) => {
      if (DIRECTIVE_FIELDS.has(key)) return rawError("directive_field_unsupported", path, { field: key });
      if (LEGACY_ANSWER_FIELDS.has(key)) return rawError("ambiguous_answer_key_field", path, { field: key });
      return rawError("unknown_field", path); // the unknown name itself is never returned
    });
  }
  const key = lastKey(issue.path);
  if (issue.code === "invalid_type") {
    const input: unknown = issue.input;
    if (input === undefined) return [rawError("required_missing", path)];
    if (key === "correctChoiceId" && typeof input === "number") return [rawError("answer_key_type", path)];
    if (key === "correctChoiceId" && Array.isArray(input)) return [rawError("multiple_answers_unsupported", path)];
    if (input === null) return [rawError("null_not_allowed", path)];
    if (key === "page" && typeof input === "number") return [rawError("page_out_of_range", path)];
    return [rawError("wrong_type", path)];
  }
  if (issue.code === "invalid_value") {
    return [rawError(key === "type" ? "unsupported_question_type" : "invalid_value", path)];
  }
  if (issue.code === "invalid_format") return [rawError("invalid_id", path)];
  if (issue.code === "too_big") {
    if (key === "page") return [rawError("page_out_of_range", path)];
    if (issue.origin === "array") return [rawError("too_many_items", path, { limit: Number(issue.maximum) })];
    return [rawError("too_long", path)];
  }
  if (issue.code === "too_small") {
    if (key === "page") return [rawError("page_out_of_range", path)];
    if (issue.origin === "array") return [rawError("too_few_items", path, { limit: Number(issue.minimum) })];
    return [rawError("empty_required", path)];
  }
  return [rawError("invalid_value", path)];
}
