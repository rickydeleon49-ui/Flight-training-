/**
 * Rules that need the whole normalized packet (contract §2.4–2.7, §2.10):
 * valid combinations including guide source notes (R5), identifier
 * uniqueness, explicit choice-ID answers, duplicate choices, empty source
 * references and credential-shaped text, plus the informational warnings.
 */
import { rawError, type RawError } from "./diagnostics";
import type { ValidatedPacket } from "./schema";
import type { PacketWarningCode, PreviewSourceClaims } from "./types";

const CREDENTIAL_PATTERNS: ReadonlyArray<RegExp> = [
  /AIza[0-9A-Za-z_-]{35}/, // Google API key
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/, // provider secret-key style
  /\bgh[pousr]_[A-Za-z0-9]{36,}/, // GitHub token
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/, // Slack token
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/, // PEM private key
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key id
];
const BIDI_CONTROLS = /[‪-‮⁦-⁩]/;
const HTML_LIKE = /<\/?[A-Za-z!][^>]*>/;
const MARKDOWN_IMAGE = /!\[[^\]]*\]\(/;

/** Shared secret-shaped text guard for export formats that carry study text. */
export function hasCredentialLikeText(value: string): boolean {
  return CREDENTIAL_PATTERNS.some((pattern) => pattern.test(value));
}

/** Non-empty normalized source claims, or null. An empty object or blank values are not a claim. */
export function sourceClaims(source: ValidatedPacket["source"]): PreviewSourceClaims | null {
  if (!source) return null;
  const claims: PreviewSourceClaims = {};
  if (source.generator) claims.generator = source.generator;
  if (source.createdAt) claims.createdAt = source.createdAt;
  if (source.note) claims.note = source.note;
  return Object.keys(claims).length ? claims : null;
}

/** A guide counts only with a non-empty summary or at least one section. Notes alone never do. */
export function hasSubstantiveGuide(packet: ValidatedPacket): boolean {
  return Boolean(packet.guide && (packet.guide.summary || (packet.guide.sections ?? []).length));
}

export interface SemanticResult {
  errors: RawError[];
  warnings: PacketWarningCode[];
  hasGuide: boolean;
}

export function checkSemantics(packet: ValidatedPacket): SemanticResult {
  const errors: RawError[] = [];
  const warnings = new Set<PacketWarningCode>();
  const hasGuide = hasSubstantiveGuide(packet);
  const cards = packet.flashcards ?? [];
  const questions = packet.questions ?? [];

  if (!hasGuide && cards.length === 0 && questions.length === 0) {
    errors.push(rawError("packet_empty", "$"));
  } else if (packet.guide?.sourceNotes && !hasGuide && cards.length === 0) {
    // R5: guide source notes are saved only inside a study set, which needs a
    // substantive guide or a flashcard. Blank notes are "" here and act as absent.
    errors.push(rawError("source_notes_without_study_set", "$.guide.sourceNotes"));
  }

  // Duplicates are reported by position, never by the identifier itself.
  const unique = (items: ReadonlyArray<{ id: string }>, base: string) => {
    const seen = new Map<string, number>();
    items.forEach((item, index) => {
      const folded = item.id.toLowerCase();
      const first = seen.get(folded);
      if (first !== undefined) errors.push(rawError("duplicate_id", `${base}[${index}].id`, { index, firstIndex: first }));
      else seen.set(folded, index);
    });
  };
  unique(cards, "$.flashcards");
  unique(questions, "$.questions");

  questions.forEach((question, qi) => {
    const base = `$.questions[${qi}]`;
    const ids = new Map<string, number>();
    const texts = new Map<string, number>();
    question.choices.forEach((choice, ci) => {
      const folded = choice.id.toLowerCase();
      const firstId = ids.get(folded);
      if (firstId !== undefined) {
        errors.push(rawError("duplicate_choice_id", `${base}.choices[${ci}].id`, { index: ci, firstIndex: firstId }));
      } else ids.set(folded, ci);
      const text = choice.text.toLowerCase();
      const firstText = texts.get(text);
      if (firstText !== undefined) {
        errors.push(rawError("duplicate_choice_text", `${base}.choices[${ci}].text`, { index: ci, firstIndex: firstText }));
      } else texts.set(text, ci);
    });
    if (!question.choices.some((choice) => choice.id === question.correctChoiceId)) {
      // Never repaired: a match that only ignores letter case is still an error.
      const folded = ids.has(question.correctChoiceId.toLowerCase());
      errors.push(rawError(folded ? "answer_key_case_mismatch" : "answer_key_not_in_choices", `${base}.correctChoiceId`));
    }
  });

  let referenceCount = 0;
  const checkReferences = (refs: ReadonlyArray<{ label?: string; page?: number }> | undefined, base: string) => {
    (refs ?? []).forEach((ref, ri) => {
      if (!ref.label && ref.page === undefined) errors.push(rawError("source_ref_empty", `${base}.sourceRefs[${ri}]`));
      referenceCount++;
    });
  };
  cards.forEach((card, i) => checkReferences(card.sourceRefs, `$.flashcards[${i}]`));
  questions.forEach((question, i) => checkReferences(question.sourceRefs, `$.questions[${i}]`));
  if (referenceCount) warnings.add("source_refs_unverified");
  if (sourceClaims(packet.source)) warnings.add("source_claim_unverified");

  // Every normalized string. Object keys here are schema-owned names only.
  const walk = (value: unknown, path: string) => {
    if (typeof value === "string") {
      if (hasCredentialLikeText(value)) errors.push(rawError("credential_like_content", path));
      if (BIDI_CONTROLS.test(value)) warnings.add("bidi_controls_present");
      if (HTML_LIKE.test(value)) warnings.add("html_like_text");
      if (MARKDOWN_IMAGE.test(value)) warnings.add("markdown_images_not_shown");
    } else if (Array.isArray(value)) {
      value.forEach((item, k) => walk(item, `${path}[${k}]`));
    } else if (value && typeof value === "object") {
      for (const [key, item] of Object.entries(value)) walk(item, `${path}.${key}`);
    }
  };
  walk(packet, "$");

  if (questions.length === 0 && (hasGuide || cards.length)) warnings.add("no_practice_test");
  if (questions.length > 0 && !hasGuide && cards.length === 0) warnings.add("no_study_guide");
  return { errors, warnings: [...warnings], hasGuide };
}
