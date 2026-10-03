/**
 * Entry points for `hfd-study-packet` version 1 validation. Pure: no I/O, no
 * network, no storage. The native reader (`pick_study_packet`) supplies text;
 * nothing is saved here.
 *
 * Pipeline: bytes → strict bounded scan → format/version gate → Zod schema with
 * normalization → semantic rules → preview data and persistence payload.
 * Every failure crosses the fixed diagnostic boundary.
 */
import { failure, internalFailure, rawError } from "./diagnostics";
import { FORMAT, FORMAT_VERSION, LIMITS } from "./limits";
import { toImportPayload, toPreviewData } from "./payload";
import { decodeBytes, scanJson } from "./scan";
import { mapIssue, packetSchema } from "./schema";
import { checkSemantics } from "./semantic";
import type { PacketValidationResult, PacketWarningCode } from "./types";

const WARNING_MESSAGES: Readonly<Record<PacketWarningCode, string>> = Object.freeze({
  utf8_bom_removed: "A UTF-8 byte-order mark at the start of the file was ignored.",
  no_practice_test: "This packet has no structured questions, so no practice test will be created.",
  no_study_guide: "This packet has no guide or flashcards, so only a practice test will be created.",
  source_refs_unverified:
    "Source references come from the packet and have not been checked against any file. They are shown in this preview but not saved.",
  source_claim_unverified: "The packet says who or what produced it. That claim has not been verified.",
  bidi_controls_present: "Some text contains direction-control characters that can change how it looks.",
  html_like_text: "Some text looks like HTML. It will be shown as text and never run.",
  markdown_images_not_shown: "Some text references images. Images are never loaded or shown.",
});

const hasOwn = (object: object, key: string): boolean => Object.prototype.hasOwnProperty.call(object, key);

/**
 * Validates original file bytes: the same byte checks as the native reader,
 * then the full pipeline. Used by tests and any non-native caller.
 */
export function validatePacketBytes(bytes: Uint8Array): PacketValidationResult {
  try {
    if (!(bytes instanceof Uint8Array)) return internalFailure();
    const decoded = decodeBytes(bytes);
    if (!decoded.ok) return failure("bytes", [decoded.error]);
    return validateDecoded(decoded.text, decoded.warnings);
  } catch {
    return internalFailure();
  }
}

/**
 * Validates text the native reader has already decoded. The original size is
 * re-derived from the text (UTF-8 length, plus 3 when the reader removed a
 * BOM); a caller-supplied length is never trusted. A leading U+FEFF means the
 * BOM was not removed and is refused.
 */
export function validatePacketText(text: string, options: { bomRemoved?: boolean } = {}): PacketValidationResult {
  try {
    if (typeof text !== "string") return internalFailure();
    const bomRemoved = options.bomRemoved === true;
    const bytes = new TextEncoder().encode(text).length + (bomRemoved ? 3 : 0);
    if (text.length === 0) return failure("bytes", [rawError("file_empty", "$")]);
    if (bytes > LIMITS.fileBytes) return failure("bytes", [rawError("file_too_large", "$", { limit: LIMITS.fileBytes })]);
    if (text.charCodeAt(0) === 0xfeff) return failure("bytes", [rawError("unsupported_encoding", "$")]);
    return validateDecoded(text, bomRemoved ? ["utf8_bom_removed"] : []);
  } catch {
    return internalFailure();
  }
}

function validateDecoded(text: string, byteWarnings: PacketWarningCode[]): PacketValidationResult {
  const scanned = scanJson(text);
  if (!scanned.ok) return failure("scan", [scanned.error]);
  const root = scanned.value;
  if (!root || typeof root !== "object" || Array.isArray(root)) return failure("gate", [rawError("root_not_object", "$")]);
  // The version is checked before the schema so a newer packet gets one clear error.
  if (!hasOwn(root, "format")) return failure("gate", [rawError("format_missing", "$.format")]);
  if (root.format !== FORMAT) return failure("gate", [rawError("unsupported_format", "$.format")]);
  if (!hasOwn(root, "formatVersion")) return failure("gate", [rawError("version_missing", "$.formatVersion")]);
  if (root.formatVersion !== FORMAT_VERSION) return failure("gate", [rawError("unsupported_version", "$.formatVersion")]);

  const parsed = packetSchema.safeParse(root, { reportInput: true });
  if (!parsed.success) return failure("schema", parsed.error.issues.flatMap(mapIssue));

  const semantic = checkSemantics(parsed.data);
  if (semantic.errors.length) return failure("semantic", semantic.errors);

  const payload = toImportPayload(parsed.data, semantic.hasGuide);
  const { data, discardedOnSave } = toPreviewData(parsed.data, semantic.hasGuide);
  const warnings = [...byteWarnings, ...semantic.warnings];
  return {
    ok: true,
    stage: "preview",
    preview: {
      title: parsed.data.title,
      counts: {
        sections: data.guide?.sections.length ?? 0,
        flashcards: data.flashcards.length,
        questions: data.questions.length,
        choices: discardedOnSave.choiceIds,
        sourceRefs: discardedOnSave.sourceRefs,
      },
      createsStudySet: payload.studySet !== null,
      createsPracticeTest: payload.practiceTest !== null,
      warnings: warnings.map((code) => ({ code, message: WARNING_MESSAGES[code] })),
      data,
      discardedOnSave,
    },
    payload,
  };
}
