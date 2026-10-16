/**
 * The narrow database surface the rest of the application depends on.
 *
 * Repositories talk to this interface, never to a concrete driver, so the
 * same repository code runs against Tauri's bundled SQLite in the desktop
 * app, sql.js in a plain browser during development, and node:sqlite in
 * tests. Replacing local persistence with a hosted backend means writing
 * one new implementation of this interface.
 */
export interface SqlDatabase {
  /** Run a query and return typed rows. */
  select<T = Record<string, unknown>>(sql: string, params?: SqlValue[]): Promise<T[]>;
  /** Run a statement that returns no rows. */
  execute(sql: string, params?: SqlValue[]): Promise<void>;
  /** Flush to durable storage where the driver needs it. Optional. */
  persist?(): Promise<void>;
  /** Desktop-only pinned transaction for a batch of PDF part records. */
  saveMaterialsAtomically?(materials: import("@/domain/types").StudyMaterial[]): Promise<void>;
  /**
   * Desktop-only: save the parts of a recorded split with their lineage, in
   * one native transaction bound to the split's receipt.
   */
  saveSplitBatch?(
    receipt: import("@/domain/types").SplitSourceReceipt,
    presentation: import("@/domain/types").SplitPartPresentation[],
  ): Promise<import("@/domain/types").SplitBatchSaveResult>;
  /** Desktop-only: cancel an unsaved split and remove its own part files. */
  cancelSplitBatch?(operationId: string): Promise<import("@/domain/types").SplitBatchCancelResult>;
  /** Desktop-only: read a split back by its operation id. */
  reconcileSplitBatch?(operationId: string): Promise<import("@/domain/types").SplitBatchReconciliation>;
  /** Desktop-only: fingerprint stored documents, off the interface thread. */
  fingerprintStoredDocuments?(
    relativePaths: string[],
  ): Promise<import("@/domain/types").StoredDocumentFingerprint[]>;
  /** Single-connection atomic transaction for debrief multi-record acceptance. */
  saveDebriefAtomically?(operation: DebriefSaveOperation): Promise<void>;
  /** Single-connection atomic transaction for study material create or update. */
  saveMaterialAtomically?(
    operation: MaterialSaveOperation,
  ): Promise<import("@/domain/types").StudyMaterial>;
  /**
   * One atomic save of a previewed structured study packet as a new material
   * (Slice B). There is deliberately no fallback: without it, import refuses.
   */
  saveStructuredImportAtomically?(
    operation: StructuredImportSaveOperation,
  ): Promise<NativeImportSaveResult>;
  /**
   * Single-connection atomic transaction for practice session mutations (M2 PR 1).
   */
  savePracticeSessionAtomically?(
    action: import("@/domain/types").PracticeSessionAction,
  ): Promise<import("@/domain/types").PracticeSessionActionResult>;
  /**
   * Single-connection atomic transaction for saving or regenerating a practice test.
   */
  savePracticeTestAtomically?(
    operation: PracticeTestSaveOperation,
  ): Promise<void>;
  /**
   * Single-connection atomic transaction for removing a practice test.
   */
  removePracticeTestAtomically?(
    sourceMaterialId: string,
  ): Promise<void>;
  /**
   * Single-connection atomic transaction for erasing practice history for a history key (M2 PR 2).
   */
  erasePracticeHistoryAtomically?(
    action: import("@/domain/types").EraseHistoryAction,
  ): Promise<import("@/domain/types").EraseHistoryResult>;
  /**
   * Single-connection atomic transaction for one card-review action (M2-3
   * C1). There is deliberately no fallback: without it, card writes refuse
   * with `UNSUPPORTED_DRIVER`.
   */
  saveCardReviewAtomically?(
    action: import("@/domain/types").CardReviewAction,
  ): Promise<import("@/domain/types").CardReviewResult>;
  /**
   * Library-wide Review due page (M2-4 / C2). Read-only; bounded by its
   * input budgets. Drivers without it fall back to the TypeScript reader
   * over `select`.
   */
  readLibraryReviewDue?(
    input: import("@/domain/types").LibraryReviewDueInput,
  ): Promise<import("@/domain/types").LibraryReviewDueResult>;
  /** Library-wide card review history page or enrichment (M2-4 / C2). Read-only. */
  readLibraryRecentReviews?(
    input: import("@/domain/types").LibraryRecentReviewsInput,
  ): Promise<import("@/domain/types").LibraryRecentReviewsResult>;
  /**
   * One skill-evidence action (M3) as a single-connection immediate
   * transaction. There is deliberately no fallback: without it, skill-evidence
   * writes refuse.
   */
  saveSkillEvidenceAtomically?(
    action: import("@/domain/types").SkillEvidenceAction,
  ): Promise<import("@/domain/types").SkillEvidenceOutcome>;
  /** One bounded, fenced page of evidence (M3). Read-only. */
  readSkillEvidencePage?(
    input: import("@/domain/types").EvidencePageInput,
  ): Promise<import("@/domain/types").EvidencePage>;
  /** One skill's summary, or null when it does not exist (M3). Read-only. */
  readSkillSummary?(skillId: string): Promise<import("@/domain/types").SkillSummary | null>;
  /** The skill catalog for pickers and lists (M3). Read-only. */
  listSkills?(options: { includeRetired?: boolean }): Promise<import("@/domain/types").SkillListEntry[]>;
  /** One bounded page of an observation's history, newest first (M3). Read-only. */
  readObservationHistory?(
    input: import("@/domain/types").ObservationHistoryInput,
  ): Promise<import("@/domain/types").ObservationHistoryPage>;
  /**
   * One document-navigation operation (M4) as a single-connection immediate
   * transaction: reserve, cancel, commit, read, read confirmation and
   * bookmarks. There is no fallback: without it, navigation writes refuse.
   */
  navigationOperation?<K extends import("@/domain/types").NavigationOperation["kind"]>(
    operation: Extract<import("@/domain/types").NavigationOperation, { kind: K }>,
  ): Promise<import("@/domain/types").NavigationResultByKind[K]>;
  /**
   * Desktop only: hash and page-count a material's managed PDF from its own
   * bytes and record that identity (M4). Browser mode has no managed files.
   */
  inspectNavigationIdentity?(materialId: string): Promise<import("@/domain/types").InspectedNavigationIdentity>;
}

export interface PracticeTestSaveOperation {
  sourceMaterialId: string;
  title: string;
  questions: import("@/domain/types").PracticeQuestion[];
  model: string;
}

/**
 * The structured study-import save contract (Slice B), shared by the dialog,
 * the Tauri adapter (`invoke("save_structured_study_material_atomically",
 * { operation })`), the native validator in `src-tauri/src/study_packet.rs`
 * and the browser/test transaction in `structuredImportTransaction.ts`.
 *
 * Built from the accepted validator's persistence payload. `operationId` and
 * `materialId` are the same UUID v4, minted once per preview, so "Try again"
 * resends the same identity: a retry whose stored content matches is
 * `already_saved`; any difference is `IDEMPOTENCY_CONFLICT`. `contentHash` is
 * SHA-256 of `canonicalPersistenceJson(payload)`; it is carried as a digest and
 * never trusted as proof of equality.
 */
export interface StructuredImportSaveOperation {
  operationId: string;
  materialId: string;
  contentHash: string;
  material: { title: string };
  studySet: {
    title: string;
    provider: "import";
    model: "";
    summary: string;
    sections: Array<{ heading: string; body: string }>;
    flashcards: Array<{ front: string; back: string; sourcePage: null }>;
    sourceNotes: string;
  } | null;
  practiceTest: {
    title: string;
    provider: "import";
    model: "";
    questions: Array<{
      question: string;
      options: string[];
      correctIndex: number;
      explanation: string;
      sourcePage: null;
    }>;
  } | null;
}

export type NativeImportSaveResult =
  | { status: "saved"; materialId: string }
  | { status: "already_saved"; materialId: string };

export type NativeImportSaveErrorCode =
  | "INVALID_ARGUMENT"
  | "INVALID_OPERATION_ID"
  | "INVALID_HASH_FORMAT"
  | "EMPTY_SUBSTANTIVE_CONTENT"
  | "CONTENT_LIMIT_EXCEEDED"
  | "INVALID_SOURCE_PAGE"
  | "UNSUPPORTED_PROVIDER"
  | "IDEMPOTENCY_CONFLICT"
  | "STORAGE_FAILURE"
  | "IPC_TRANSPORT_ERROR";

/** A refusal on the wire: one allowlisted code and its fixed message. */
export interface NativeImportSaveError {
  code: NativeImportSaveErrorCode;
  message: string;
}

export interface MaterialSaveFields {
  title?: string;
  materialType?: import("@/domain/types").MaterialType;
  topic?: import("@/domain/types").Topic;
  reviewStatus?: import("@/domain/types").ReviewStatus;
  priority?: import("@/domain/types").Priority;
  goalId?: string | null;
  eventId?: string | null;
  notes?: string;
  filePath?: string | null;
  originalFileName?: string | null;
  fileSize?: number | null;
  lastReviewedAt?: string | null;
}

export interface MaterialSaveOperation {
  mode: "create" | "update";
  id: string;
  fields: MaterialSaveFields;
  tags?: string[];
  createdAt?: string;
  updatedAt?: string;
}

/**
 * The one debrief-save contract, shared by the form, this interface, the Tauri
 * adapter (`invoke("save_debrief_operation", { operation })`), the Rust
 * `DebriefSaveOperation` (which rejects unknown fields), and the browser/test
 * transaction in `debriefTransaction.ts`. Checked-in fixtures captured from the
 * real form (`src-tauri/fixtures/debrief-contract/`) are replayed by both sides.
 *
 * Retry versus deliberate edit:
 * - `operationId` identifies one exact save. The form keeps it while that
 *   operation's content is unchanged, so a retry after a lost response sends
 *   the same id. An id that already committed is a complete no-op.
 * - A new id is a deliberate save. It writes the journal as shown in the form,
 *   and on an action/question it owns it writes only the debrief-managed
 *   fields (action title and material; question text, lesson and material).
 *   Status, completion, answers, priority, category, dates and estimates are
 *   never written on update.
 * - `targetId`, `action.id` and `question.id` are pre-assigned by the form.
 *   Existence in the database decides insert versus update; an existing record
 *   not owned by this journal is refused, never overwritten or deleted.
 */
export interface DebriefSaveOperation {
  operationId: string;
  targetId: string;
  journal: {
    eventId?: string | null;
    date: string;
    title: string;
    aircraftType?: string | null;
    aircraftId?: string | null;
    departureAirport?: string | null;
    arrivalAirport?: string | null;
    instructorName?: string | null;
    totalTime?: number | null;
    dualReceived?: number | null;
    soloTime?: number | null;
    picTime?: number | null;
    crossCountryTime?: number | null;
    nightTime?: number | null;
    actualInstrumentTime?: number | null;
    simulatedInstrumentTime?: number | null;
    dayLandings?: number | null;
    nightLandings?: number | null;
    mission?: string | null;
    practiced?: string | null;
    wentWell?: string | null;
    wasDifficult?: string | null;
    instructorFeedback?: string | null;
    questionsForNextTime?: string | null;
    confidence?: number | null;
    goalId?: string | null;
    materialIds?: string[];
  };
  action?: {
    id: string;
    title: string;
    materialId?: string | null;
  } | null;
  withdrawActionId?: string | null;
  question?: {
    id: string;
    text: string;
    eventId?: string | null;
    materialId?: string | null;
  } | null;
  withdrawQuestionId?: string | null;
}

export type SqlValue = string | number | null;

/**
 * Rewrite `?` placeholders to the `$1, $2, …` form Tauri's SQL plugin wants.
 *
 * All application queries are written with `?` so they stay portable across
 * the three drivers. Our SQL never contains a literal `?` inside a string,
 * which is what makes this safe.
 */
export function toNumberedPlaceholders(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

/* ---------------------------- row helpers ---------------------------- */

/** SQLite has no boolean type; it stores 0/1. */
export const toBool = (value: unknown): boolean => value === 1 || value === true;
export const fromBool = (value: boolean): number => (value ? 1 : 0);

export const toText = (value: unknown): string =>
  typeof value === "string" ? value : value == null ? "" : String(value);

export const toNullableText = (value: unknown): string | null =>
  value == null || value === "" ? null : String(value);

export const toNullableNumber = (value: unknown): number | null =>
  value == null ? null : Number(value);

/** Narrow a stored string to a known union, falling back when data is old. */
export function toEnum<T extends string>(
  value: unknown,
  allowed: Record<T, unknown>,
  fallback: T,
): T {
  const text = typeof value === "string" ? value : "";
  return Object.prototype.hasOwnProperty.call(allowed, text) ? (text as T) : fallback;
}
