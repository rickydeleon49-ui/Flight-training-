/**
 * The diagnostic boundary (contract §2.12).
 *
 * A failure carries only fixed or numeric information: a known code with its
 * fixed message, a path built from contract-owned field names and integer
 * indexes, integer limits/offsets/positions, and a `field` name only when it
 * comes from a fixed list. Identifier-shaped text is not treated as safe: an
 * unknown key or an export ID can still be private, so neither is returned.
 */
import { CONTRACT_FIELDS, DIRECTIVE_FIELDS, FORMAT_VERSION, LEGACY_ANSWER_FIELDS, LIMITS } from "./limits";
import type { PacketError, PacketErrorCode, PacketFailure, PacketFailureStage } from "./types";

export const ERROR_MESSAGES: Readonly<Record<PacketErrorCode, string>> = Object.freeze({
  file_empty: "The file is empty.",
  file_too_large: "The file is larger than the 4 MiB limit for a study packet.",
  file_read_failed: "The file could not be read.",
  unsupported_encoding: "The file is not UTF-8. Export it again as UTF-8 JSON.",
  invalid_utf8: "The file contains bytes that are not valid UTF-8.",
  malformed_json: "The file is not valid JSON.",
  trailing_content: "The file has extra content after the JSON value.",
  depth_exceeded: "The JSON is nested more deeply than this format allows.",
  too_many_keys: "An object has more fields than this format allows.",
  key_too_long: "A field name is longer than this format allows.",
  duplicate_key: "A field appears twice in the same object.",
  forbidden_property_name: "A field uses a reserved name that is never accepted.",
  unsupported_number: "Only whole numbers of up to 9 digits are used in this format.",
  invalid_string_character: "Text contains a control character or an invalid Unicode sequence.",
  too_many_values: "The JSON contains more values than this format allows.",
  root_not_object: "The packet must be a JSON object.",
  format_missing: "This is not a Her Flight Deck study packet (the format field is missing).",
  unsupported_format: "This is not a Her Flight Deck study packet (unknown format).",
  version_missing: "The packet does not say which format version it uses.",
  unsupported_version: "This packet uses a format version this app does not support.",
  unknown_field: "This field is not part of format version 1.",
  directive_field_unsupported:
    "Packets cannot contain actions, commands, scripts, credentials or fetch/upload instructions.",
  ambiguous_answer_key_field: "Version 1 identifies the correct answer only by correctChoiceId.",
  wrong_type: "This value has the wrong type.",
  null_not_allowed: "Null is not used in this format; leave the field out instead.",
  required_missing: "A required field is missing.",
  empty_required: "A required text field is empty.",
  too_long: "This text is longer than the limit.",
  too_few_items: "This list has too few items.",
  too_many_items: "This list has too many items.",
  invalid_id:
    "An identifier must be 1–64 letters, digits, '.', '_' or '-', starting with a letter or digit.",
  unsupported_question_type: "Only single-choice questions are supported.",
  answer_key_type: "correctChoiceId must be a choice id string, not a number or index.",
  multiple_answers_unsupported: "Each question must have exactly one correct choice.",
  page_out_of_range: "A source page must be a whole number from 1 to 1000.",
  source_ref_empty: "A source reference needs a label or a page.",
  packet_empty: "The packet has no guide, flashcards or questions.",
  duplicate_id: "Two items share the same identifier.",
  duplicate_choice_id: "Two choices in this question share the same identifier.",
  duplicate_choice_text: "Two choices in this question have the same text.",
  answer_key_not_in_choices: "correctChoiceId does not match any choice in this question.",
  answer_key_case_mismatch:
    "correctChoiceId matches a choice only if letter case is ignored; it is not repaired.",
  credential_like_content: "This text looks like a password, key or token. Remove it and export again.",
  source_notes_without_study_set:
    "Guide source notes need a guide summary, a guide section or a flashcard to be saved with.",
  invalid_value: "This value is not allowed here.",
  internal_error: "The packet could not be checked. Nothing was imported.",
});

/** An error before it crosses the boundary. Extra properties are dropped there. */
export interface RawError {
  code: PacketErrorCode;
  path: string;
  limit?: number;
  offset?: number;
  index?: number;
  firstIndex?: number;
  field?: string;
}

export function rawError(code: PacketErrorCode, path: string, extra: Omit<RawError, "code" | "path"> = {}): RawError {
  return { code, path, ...extra };
}

/** Builds `$`-rooted paths from contract-owned names and indexes; anything else is `<field>`. */
export function pathFromParts(parts: ReadonlyArray<PropertyKey>): string {
  let out = "$";
  for (const part of parts) {
    if (typeof part === "number") out += `[${part}]`;
    else if (typeof part === "string" && CONTRACT_FIELDS.has(part)) out += `.${part}`;
    else out += ".<field>";
  }
  return out;
}

const PATH_GRAMMAR = /^\$(?:\[\d+\]|\.(?:<field>|[A-Za-z]+))*$/;
const FIELD_ALLOWLIST: ReadonlySet<string> = new Set([...CONTRACT_FIELDS, ...DIRECTIVE_FIELDS, ...LEGACY_ANSWER_FIELDS]);
const NUMBER_KEYS = ["limit", "offset", "index", "firstIndex"] as const;

function isKnownCode(code: unknown): code is PacketErrorCode {
  return typeof code === "string" && Object.prototype.hasOwnProperty.call(ERROR_MESSAGES, code);
}

/**
 * Rebuilds one error from allowlisted parts. The upstream stages already avoid
 * private values; this second layer means a defect in one of them still cannot
 * put packet text into a result.
 */
export function publicError(raw: Partial<RawError> | undefined): PacketError {
  const code: PacketErrorCode = isKnownCode(raw?.code) ? raw.code : "internal_error";
  const redacted =
    typeof raw?.path === "string"
      ? raw.path.replace(/\.([^.[]+)/g, (match, name: string) =>
          CONTRACT_FIELDS.has(name) || name === "<field>" ? match : ".<field>",
        )
      : "$";
  const out: PacketError = {
    code,
    path: PATH_GRAMMAR.test(redacted) ? redacted : "$",
    message: ERROR_MESSAGES[code],
  };
  for (const key of NUMBER_KEYS) {
    const value = raw?.[key];
    if (typeof value === "number" && Number.isInteger(value)) out[key] = value;
  }
  if (code === "unsupported_version") out.supported = [FORMAT_VERSION];
  if (typeof raw?.field === "string" && FIELD_ALLOWLIST.has(raw.field)) {
    out.field = raw.field as PacketError["field"];
  }
  return out;
}

/** A failure result: capped at 50 errors, with the rest counted. */
export function failure(stage: PacketFailureStage, errors: ReadonlyArray<Partial<RawError>>): PacketFailure {
  const shown = errors.slice(0, LIMITS.reportedErrors);
  return {
    ok: false,
    stage,
    errors: shown.map(publicError),
    omittedErrors: Math.max(0, errors.length - LIMITS.reportedErrors),
  };
}

export const internalFailure = (): PacketFailure => failure("internal", [{ code: "internal_error", path: "$" }]);
