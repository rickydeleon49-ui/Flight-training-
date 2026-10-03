/**
 * Public types for structured study-packet validation (contract §2.12–2.13).
 *
 * The import DTOs omit and redefine `provider` instead of reusing the stored
 * domain types: `AiStudySet` and `PracticeTest` still require "gemini", and
 * widening them belongs to the later persistence slice.
 */
import type { AiStudySet, PracticeTest, StudyMaterial } from "@/domain/types";

/** Fields an import never supplies: identity and timestamps come from the save; provider is redefined. */
type StoredOnly = "sourceMaterialId" | "provider" | "generatedAt" | "updatedAt";

export type ImportedStudySetDraft = Omit<AiStudySet, StoredOnly> & { provider: "import"; model: "" };
export type ImportedPracticeTestDraft = Omit<PracticeTest, StoredOnly> & { provider: "import"; model: "" };

/**
 * Only the title comes from the packet. Every other material field is a fixed
 * default supplied by the later native save, so a packet cannot set it.
 */
export type ImportedMaterialDraft = Pick<StudyMaterial, "title">;

export interface ImportPayload {
  material: ImportedMaterialDraft;
  studySet: ImportedStudySetDraft | null;
  practiceTest: ImportedPracticeTestDraft | null;
}

export interface PreviewSourceRef {
  label?: string;
  page?: number;
}

export interface PreviewSourceClaims {
  generator?: string;
  createdAt?: string;
  note?: string;
}

/** Normalized, bounded, in-memory only. Never written anywhere. */
export interface PacketPreviewData {
  title: string;
  source: PreviewSourceClaims | null;
  guide: { summary: string; sections: { heading: string; body: string }[]; sourceNotes: string } | null;
  flashcards: { index: number; id: string; front: string; back: string; sourceRefs: PreviewSourceRef[] }[];
  questions: {
    index: number;
    id: string;
    question: string;
    choices: { id: string; text: string }[];
    correctChoiceId: string;
    explanation: string;
    sourceRefs: PreviewSourceRef[];
  }[];
}

export interface DiscardedOnSave {
  sourceClaims: (keyof PreviewSourceClaims)[];
  sourceRefs: number;
  exportIds: number;
  choiceIds: number;
}

export type PacketWarningCode =
  | "utf8_bom_removed"
  | "no_practice_test"
  | "no_study_guide"
  | "source_refs_unverified"
  | "source_claim_unverified"
  | "bidi_controls_present"
  | "html_like_text"
  | "markdown_images_not_shown";

export interface PacketPreview {
  title: string;
  counts: { sections: number; flashcards: number; questions: number; choices: number; sourceRefs: number };
  createsStudySet: boolean;
  createsPracticeTest: boolean;
  warnings: { code: PacketWarningCode; message: string }[];
  data: PacketPreviewData;
  discardedOnSave: DiscardedOnSave;
}

export type PacketErrorCode =
  | "file_empty" | "file_too_large" | "file_read_failed" | "unsupported_encoding" | "invalid_utf8"
  | "malformed_json" | "trailing_content" | "depth_exceeded" | "too_many_keys" | "key_too_long"
  | "duplicate_key" | "forbidden_property_name" | "unsupported_number" | "invalid_string_character"
  | "too_many_values" | "root_not_object" | "format_missing" | "unsupported_format" | "version_missing"
  | "unsupported_version" | "unknown_field" | "directive_field_unsupported" | "ambiguous_answer_key_field"
  | "wrong_type" | "null_not_allowed" | "required_missing" | "empty_required" | "too_long" | "too_few_items"
  | "too_many_items" | "invalid_id" | "unsupported_question_type" | "answer_key_type"
  | "multiple_answers_unsupported" | "page_out_of_range" | "source_ref_empty" | "packet_empty"
  | "duplicate_id" | "duplicate_choice_id" | "duplicate_choice_text" | "answer_key_not_in_choices"
  | "answer_key_case_mismatch" | "credential_like_content" | "source_notes_without_study_set"
  | "invalid_value" | "internal_error";

export type ContractField =
  | "format" | "formatVersion" | "title" | "source" | "generator" | "createdAt" | "note" | "guide" | "summary"
  | "sections" | "heading" | "body" | "sourceNotes" | "flashcards" | "id" | "front" | "back" | "sourceRefs"
  | "label" | "page" | "questions" | "type" | "question" | "choices" | "text" | "correctChoiceId" | "explanation";
export type DirectiveField =
  | "actions" | "commands" | "command" | "script" | "scripts" | "exec" | "execute" | "run" | "fetch" | "upload"
  | "download" | "webhook" | "callback" | "instructions" | "system" | "systemPrompt" | "onImport" | "onLoad"
  | "html" | "mdx" | "jsx" | "apiKey" | "token" | "credentials";
export type LegacyAnswerField =
  | "correctIndex" | "answerIndex" | "answer" | "correct" | "correctAnswer" | "correctChoice" | "answers"
  | "correctChoiceIds";

/** The diagnostic boundary: fixed codes/messages, contract-owned paths, integers and allowlisted names only. */
export interface PacketError {
  code: PacketErrorCode;
  /** "$" followed by ".<contract field>", ".<field>" (redacted) or "[<integer>]" segments only. */
  path: string;
  message: string;
  limit?: number;
  offset?: number;
  index?: number;
  firstIndex?: number;
  supported?: [1];
  field?: ContractField | DirectiveField | LegacyAnswerField;
}

export type PacketFailureStage = "bytes" | "scan" | "gate" | "schema" | "semantic" | "internal";

export interface PacketFailure {
  ok: false;
  stage: PacketFailureStage;
  errors: PacketError[];
  omittedErrors: number;
}

export interface PacketSuccess {
  ok: true;
  stage: "preview";
  preview: PacketPreview;
  payload: ImportPayload;
}

export type PacketValidationResult = PacketSuccess | PacketFailure;
