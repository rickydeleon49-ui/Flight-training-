/**
 * Domain vocabulary for Her Flight Deck.
 *
 * These types describe the product, not the database. Repositories map rows
 * to these shapes so the UI never sees SQL concerns, and so local storage
 * could be swapped for a hosted backend without touching screens.
 */

export type Id = string;
/** Calendar day, 'YYYY-MM-DD'. */
export type IsoDate = string;
/** Instant, ISO-8601 with timezone. */
export type IsoDateTime = string;
/** Money in whole cents. Never floats — currency rounding errors compound. */
export type Cents = number;

/** A labelled option set, used to build selects without duplicating strings. */
export type Options<T extends string> = ReadonlyArray<{ value: T; label: string }>;

const options = <T extends string>(entries: Record<T, string>): Options<T> =>
  (Object.keys(entries) as T[]).map((value) => ({ value, label: entries[value] }));

/* ------------------------------------------------------------------ */
/* Next Actions — the shared action system                             */
/* ------------------------------------------------------------------ */

export type ActionCategory = "non_negotiable" | "prepare" | "life_admin" | "stretch";
export const ACTION_CATEGORY_LABELS: Record<ActionCategory, string> = {
  non_negotiable: "Non-Negotiable",
  prepare: "Prepare",
  life_admin: "Life Admin",
  stretch: "Stretch Goal",
};
/** Display order on Today's Flight Plan, most important first. */
export const ACTION_CATEGORY_ORDER: ActionCategory[] = [
  "non_negotiable",
  "prepare",
  "life_admin",
  "stretch",
];
export const ACTION_CATEGORY_OPTIONS = options(ACTION_CATEGORY_LABELS);

export const ACTION_CATEGORY_DESCRIPTIONS: Record<ActionCategory, string> = {
  non_negotiable: "Important work that should happen today.",
  prepare: "Tasks related to upcoming lessons or events.",
  life_admin: "Administrative responsibilities.",
  stretch: "Optional work if you have more time or energy.",
};

export type Priority = "next_up" | "important" | "later";
export const PRIORITY_LABELS: Record<Priority, string> = {
  next_up: "Next Up",
  important: "Important",
  later: "Later",
};
export const PRIORITY_OPTIONS = options(PRIORITY_LABELS);

export type ActionStatus = "open" | "completed" | "dismissed";

/** What an action can hang off. Every relationship is optional. */
export type RelatedType = "goal" | "material" | "event" | "journal" | "question";
export const RELATED_TYPE_LABELS: Record<RelatedType, string> = {
  goal: "Goal",
  material: "Study Material",
  event: "Lesson",
  journal: "Journal Entry",
  question: "Question",
};

export interface NextAction {
  id: Id;
  title: string;
  description: string;
  category: ActionCategory;
  priority: Priority;
  status: ActionStatus;
  dueDate: IsoDate | null;
  estimatedMinutes: number | null;
  relatedType: RelatedType | null;
  relatedId: Id | null;
  materialId: Id | null;
  /**
   * The study material this action was linked to before that material was
   * deleted. Written by a database trigger when a deletion removes the link, so
   * the UI can tell "never linked" from "linked material was deleted".
   */
  sourceMaterialId?: Id | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  completedAt: IsoDateTime | null;
}

/* ------------------------------------------------------------------ */
/* Flight Path — milestones and goals                                  */
/* ------------------------------------------------------------------ */

export type MilestoneStatus = "not_started" | "in_progress" | "completed";
export const MILESTONE_STATUS_LABELS: Record<MilestoneStatus, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  completed: "Completed",
};

export interface Milestone {
  id: Id;
  title: string;
  description: string;
  position: number;
  status: MilestoneStatus;
  targetDate: IsoDate | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export type GoalStatus =
  | "not_started"
  | "working_on"
  | "comfortable"
  | "completed"
  | "paused";
export const GOAL_STATUS_LABELS: Record<GoalStatus, string> = {
  not_started: "Not Started",
  working_on: "Working On",
  comfortable: "Comfortable",
  completed: "Completed",
  paused: "Paused",
};
export const GOAL_STATUS_OPTIONS = options(GOAL_STATUS_LABELS);

export interface Goal {
  id: Id;
  milestoneId: Id | null;
  title: string;
  description: string;
  status: GoalStatus;
  priority: Priority;
  targetDate: IsoDate | null;
  notes: string;
  /** Reflective 1–5 self-assessment, never an official proficiency rating. */
  confidence: number | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  completedAt: IsoDateTime | null;
}

export interface ChecklistItem {
  id: Id;
  goalId: Id;
  title: string;
  done: boolean;
  position: number;
  createdAt: IsoDateTime;
}

/* ------------------------------------------------------------------ */
/* Study Library                                                       */
/* ------------------------------------------------------------------ */

export type MaterialType =
  | "study_guide"
  | "lesson_notes"
  | "checklist"
  | "instructor_handout"
  | "personal_note"
  | "worksheet"
  | "admin_document"
  | "reference";
export const MATERIAL_TYPE_LABELS: Record<MaterialType, string> = {
  study_guide: "Study Guide",
  lesson_notes: "Lesson Notes",
  checklist: "Checklist",
  instructor_handout: "Instructor Handout",
  personal_note: "Personal Note",
  worksheet: "Worksheet",
  admin_document: "Admin Document",
  reference: "Reference",
};
export const MATERIAL_TYPE_OPTIONS = options(MATERIAL_TYPE_LABELS);

export type Topic =
  | "weather"
  | "navigation"
  | "regulations"
  | "communications"
  | "aerodynamics"
  | "aircraft_systems"
  | "flight_planning"
  | "airports"
  | "performance"
  | "emergency_procedures"
  | "landings"
  | "general";
export const TOPIC_LABELS: Record<Topic, string> = {
  weather: "Weather",
  navigation: "Navigation",
  regulations: "Regulations",
  communications: "Communications",
  aerodynamics: "Aerodynamics",
  aircraft_systems: "Aircraft Systems",
  flight_planning: "Flight Planning",
  airports: "Airports",
  performance: "Performance",
  emergency_procedures: "Emergency Procedures",
  landings: "Landings",
  general: "General",
};
export const TOPIC_OPTIONS = options(TOPIC_LABELS);

export type ReviewStatus = "needs_review" | "studying" | "confident" | "reference_only";
export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  needs_review: "Needs Review",
  studying: "Studying",
  confident: "Confident",
  reference_only: "Reference Only",
};
export const REVIEW_STATUS_OPTIONS = options(REVIEW_STATUS_LABELS);

export interface StudyMaterial {
  id: Id;
  title: string;
  materialType: MaterialType;
  topic: Topic;
  reviewStatus: ReviewStatus;
  priority: Priority;
  goalId: Id | null;
  eventId: Id | null;
  notes: string;
  /** Path relative to the private documents directory, or null for notes. */
  filePath: string | null;
  originalFileName: string | null;
  fileSize: number | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  lastReviewedAt: IsoDateTime | null;
  tags: string[];
}

export interface StudyGuideSection {
  heading: string;
  body: string;
}

export interface StudyFlashcard {
  front: string;
  back: string;
  sourcePage: number | null;
}

/**
 * Where a saved study aid came from. "gemini" is generated by the app; "import"
 * is a structured study packet the user chose (stored with `model: ""`). Older
 * rows and unknown values read back as "gemini".
 */
export type StudyAidProvider = "gemini" | "import";

/** AI output or an imported packet, saved locally and tied to its material. */
export interface AiStudySet {
  sourceMaterialId: Id;
  title: string;
  summary: string;
  sections: StudyGuideSection[];
  flashcards: StudyFlashcard[];
  sourceNotes: string;
  provider: StudyAidProvider;
  /** The Gemini model name; "" for imported content. */
  model: string;
  generatedAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface PracticeQuestion {
  question: string;
  /** At least two choices; `correctIndex` always points inside this array. */
  options: string[];
  correctIndex: number;
  explanation: string;
  sourcePage: number | null;
}

/** A saved Gemini or imported practice test, tied to its material. */
export interface PracticeTest {
  sourceMaterialId: Id;
  title: string;
  questions: PracticeQuestion[];
  provider: StudyAidProvider;
  /** The Gemini model name; "" for imported content. */
  model: string;
  generatedAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/* ------------------------------------------------------------------ */
/* Practice Sessions & Attempt Persistence (M2 PR 1)                  */
/* ------------------------------------------------------------------ */

export interface PracticeTestVersion {
  id: string;
  sourceMaterialId: string | null;
  historyKey: string;
  sourceMaterialTitle: string;
  versionNumber: number;
  provider: StudyAidProvider;
  model: string;
  title: string;
  contentHash: string;
  createdAt: IsoDateTime;
  isActive: boolean;
}

export interface PracticeTestItem {
  id: string;
  versionId: string;
  ordinal: number;
  questionText: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  sourcePage: number | null;
}

export type PracticeAttemptStatus = "in_progress" | "completed" | "abandoned";

export interface PracticeAttempt {
  id: string;
  versionId: string;
  sourceMaterialId: string | null;
  sourceMaterialTitle: string;
  startedAt: IsoDateTime;
  completedAt: IsoDateTime | null;
  status: PracticeAttemptStatus;
  revision: number;
  totalQuestions: number;
  answeredCount: number;
  correctCount: number;
  incorrectCount: number;
  dontKnowCount: number;
  scorePercent: number | null;
}

export interface PracticeResponse {
  id: string;
  attemptId: string;
  itemId: string;
  selectedIndex: number | null;
  isDontKnow: boolean;
  isCorrect: boolean;
  answeredAt: IsoDateTime;
}

export interface PracticeSessionResponseSummary {
  itemId: string;
  selectedIndex: number | null;
  isDontKnow: boolean;
  isCorrect: boolean;
  answeredAt: IsoDateTime;
}

export interface PracticeSessionState {
  attemptId: string;
  versionId: string;
  status: "in_progress";
  startedAt: IsoDateTime;
  completedAt: null;
  totalQuestions: number;
  answeredCount: number;
  revision: number;
  nextUnansweredOrdinal: number | null;
  responses: PracticeSessionResponseSummary[];
}

export interface PracticeRecordResponseResult {
  attemptId: string;
  itemId: string;
  answeredCount: number;
  revision: number;
  isCorrect: boolean;
  answeredAt: IsoDateTime;
}

export interface PracticeCompletedResult {
  attemptId: string;
  status: "completed";
  startedAt: IsoDateTime;
  completedAt: IsoDateTime;
  totalQuestions: number;
  answeredCount: number;
  revision: number;
  correctCount: number;
  incorrectCount: number;
  dontKnowCount: number;
  unansweredCount: number;
  scorePercent: number;
}

export interface PracticeAbandonResult {
  attemptId: string;
  status: "abandoned";
  revision: number;
  completedAt: IsoDateTime;
}

export interface PracticeSessionStartOrResumeAction {
  action: "start_or_resume";
  operationId: string;
  materialId: string;
  versionId: string;
}

export interface PracticeSessionRecordResponseAction {
  action: "record_response";
  operationId: string;
  attemptId: string;
  itemId: string;
  expectedRevision: number;
  selectedIndex: number | null;
  isDontKnow: boolean;
}

export interface PracticeSessionCompleteAttemptAction {
  action: "complete_attempt";
  operationId: string;
  attemptId: string;
  expectedRevision: number;
}

export interface PracticeSessionRetakeAttemptAction {
  action: "retake_attempt";
  operationId: string;
  expectedAttemptId: string | null;
  materialId: string;
  versionId: string;
}

export interface PracticeSessionAbandonAttemptAction {
  action: "abandon_attempt";
  operationId: string;
  attemptId: string;
  expectedRevision: number;
}

export type PracticeSessionAction =
  | PracticeSessionStartOrResumeAction
  | PracticeSessionRecordResponseAction
  | PracticeSessionCompleteAttemptAction
  | PracticeSessionRetakeAttemptAction
  | PracticeSessionAbandonAttemptAction;

export type PracticeSessionActionResult =
  | PracticeSessionState
  | PracticeRecordResponseResult
  | PracticeCompletedResult
  | PracticeAbandonResult;

export interface CompletedHistoryItem {
  attemptId: string;
  versionId: string;
  versionNumber: number;
  historyKey: string;
  sourceMaterialTitle: string;
  startedAt: IsoDateTime;
  completedAt: IsoDateTime;
  totalQuestions: number;
  answeredCount: number;
  correctCount: number;
  incorrectCount: number;
  dontKnowCount: number;
  unansweredCount: number;
  scorePercent: number;
}

export interface EraseHistoryAction {
  action: "erase_history";
  operationId: string;
  historyKey: string;
}

export interface EraseHistoryResult {
  action: "erase_history";
  historyKey: string;
  erased: boolean;
}

/* ------------------------------------------------------------------ */
/* Card reviews (M2-3 source slice C1)                                 */
/* ------------------------------------------------------------------ */

/** A rating only decides when a card comes back; it is never a score. */
export type CardRating = "again" | "hard" | "good" | "easy";
export type CardFlagReason = "wrong_answer" | "unclear" | "not_in_source";
export type CardItemActionName = "rate" | "suspend" | "resume" | "flag" | "unflag";

interface CardItemActionBase {
  operationId: string;
  materialId: string;
  /** The current saved cards' content hash, from the snapshot. */
  versionContentHash: string;
  itemId: string;
  /** The material's review generation, from the snapshot. */
  expectedGeneration: number;
  /** The card's revision, from the snapshot; 0 when untouched. */
  expectedRevision: number;
}

/** One card action. Exact keys per branch; anything else is refused. */
export type CardItemAction =
  | (CardItemActionBase & { action: "rate"; rating: CardRating })
  | (CardItemActionBase & { action: "suspend" | "resume" | "unflag" })
  | (CardItemActionBase & { action: "flag"; reason: CardFlagReason });

/** Reset a material's card reviews. It carries no item fields. */
export interface CardResetAction {
  action: "reset";
  operationId: string;
  materialId: string;
  expectedGeneration: number;
}

export type CardReviewAction = CardItemAction | CardResetAction;

export interface CardItemResult {
  action: CardItemActionName;
  itemId: string;
  generation: number;
  revision: number;
  dueAt: string | null;
  reviewedAt: string | null;
  suspended: boolean;
  flag: CardFlagReason | null;
}

export interface CardResetResult {
  action: "reset";
  materialId: string;
  /** The new generation. */
  generation: number;
}

export type CardReviewResult = CardItemResult | CardResetResult;

export interface CardReviewItemState {
  revision: number;
  step: number;
  dueAt: string | null;
  lastReviewedAt: string | null;
  reps: number;
  lapses: number;
  suspended: boolean;
  flag: CardFlagReason | null;
}

export interface CardReviewSnapshotItem {
  itemId: string;
  ordinal: number;
  front: string;
  back: string;
  sourcePage: number | null;
}

/** One authoritative read of a material's card reviews. Reads never write. */
export interface CardReviewSnapshot {
  materialId: string;
  /** 0 when no generation row exists. */
  generation: number;
  current:
    | { status: "ok"; versionId: string; contentHash: string; items: CardReviewSnapshotItem[] }
    | { status: "none" }
    | { status: "malformed" };
  /** Keyed by current item ID; absent means untouched (revision 0). */
  states: Record<string, CardReviewItemState>;
}

export interface CardQueueEntry {
  itemId: string;
  kind: "again" | "due" | "new";
  dueAt: string | null;
  ordinal: number;
}

export interface CardRecentReview {
  id: string;
  itemId: string;
  front: string;
  rating: CardRating;
  reviewedAt: string;
  /** True when the card belongs to an earlier version of this material's cards. */
  earlierVersion: boolean;
}

export interface CardRecentReviewCursor {
  reviewedAt: string;
  id: string;
}

/* ------------------------------------------------------------------ */
/* Library-wide card reviews (M2-4 / C2)                               */
/* ------------------------------------------------------------------ */

export type LibraryDueStatusFilter = "all" | "due_today" | "new_only";

export interface LibraryReviewDueInput {
  /** The captured clock: one instant for a whole traversal. */
  nowUtc: string;
  /** The exclusive end of the local day at `nowUtc`. */
  nextLocalMidnightUtc: string;
  topic?: string | null;
  statusFilter?: LibraryDueStatusFilter | null;
  /** Default 50, at most 250. */
  limit?: number;
  cursor?: string | null;
  /** Default 250, at most 250. */
  candidateBatchBudget?: number;
  /** Default 2,500. */
  maxBatchCardsBudget?: number;
  /** Default 2 MiB. */
  maxBatchRawJsonBytesBudget?: number;
}

export interface LibraryReviewOversizeIssue {
  materialId: string;
  title: string;
  code: "PAYLOAD_TOO_LARGE";
  rawBytes: number;
  allowedBytes: number;
  inspectionTarget: string;
}

export interface LibraryReviewMaterialEntry {
  materialId: string;
  title: string;
  topic: string;
  priority: string;
  updatedAt: string;
  cardCount: number;
  againCount: number;
  dayCount: number;
  newCount: number;
  totalDueCount: number;
  retainedCardCount: number;
  earliestDueAt: string | null;
}

/** Counters for one page read only — never whole-library totals. */
export interface LibraryReviewDueSummary {
  scannedCandidates: number;
  evaluatedCandidates: number;
  /** Cards reserved/attempted across raw reads (stays charged when a set fails to parse). */
  attemptedCards: number;
  /** Valid cards parsed and evaluated. */
  evaluatedCards: number;
  rawReads: number;
  rawBytesTransferred: number;
  actionableCount: number;
  againCount: number;
  dayCount: number;
  totalDueCount: number;
  newCount: number;
  /** The candidate stream is exhausted. */
  isComplete: boolean;
  isPageLocal: true;
  issues: LibraryReviewOversizeIssue[];
}

export interface LibraryReviewDueResult {
  summary: LibraryReviewDueSummary;
  materials: LibraryReviewMaterialEntry[];
  nextCursor: string | null;
  issues: LibraryReviewOversizeIssue[];
}

export interface LibraryRecentReviewsInput {
  cursor?: string | null;
  /** Default 20, at most 100; 0 means enrichment only. */
  limit?: number;
  topic?: string | null;
  materialId?: string | null;
  /** Default 2,500 (C2-D9). */
  maxBatchCardsBudget?: number;
  /** Default 2 MiB. */
  maxBatchRawJsonBytesBudget?: number;
  /** At most 250 distinct targets. */
  enrichMaterialIds?: string[] | null;
  /** Skip the event query entirely and only resolve the targets. */
  enrichmentOnly?: boolean;
}

export interface ValidatedCardSchedule {
  schedulerVersion: "simple-v1";
  step: number;
  dueAt: string | null;
  lastReviewedAt: string | null;
  reps: number | null;
  lapses: number | null;
  intervalDays: number | null;
  intervalMinutes: number | null;
  intervalLabel: string | null;
}

export type HistoryContentStatus = "current" | "earlier" | "valid_empty" | "unavailable" | "malformed" | "pending";

export interface LibraryRecentReviewEntry {
  id: string;
  itemId: string;
  materialId: string;
  materialTitle: string;
  topic: string;
  versionId: string;
  contentHash: string;
  ordinal: number;
  front: string;
  back: string;
  sourcePage: number | null;
  rating: CardRating;
  reviewedAt: string;
  schedulerVersion: string;
  priorStateRaw: string | null;
  nextStateRaw: string | null;
  priorState: Record<string, unknown> | null;
  nextState: Record<string, unknown> | null;
  priorSchedule: ValidatedCardSchedule | null;
  nextSchedule: ValidatedCardSchedule | null;
  step: number | null;
  dueAt: string | null;
  intervalDays: number | null;
  intervalMinutes: number | null;
  intervalLabel: string | null;
  /** null while the current content is unread (pending). */
  isEarlierVersion: boolean | null;
  contentStatus: HistoryContentStatus;
  currentVersionId: string | null;
  blockedReason: string | null;
  inspectionTarget: string | null;
}

export interface HistoryMaterialEnrichmentRecord {
  materialId: string;
  contentStatus: HistoryContentStatus;
  currentVersionId: string | null;
  reason: string | null;
  inspectionTarget: string | null;
}

/** Counters for one read call only. */
export interface LibraryRecentReviewsSummary {
  eventsReturned: number;
  rawReads: number;
  rawBytesTransferred: number;
  attemptedCards: number;
  evaluatedCards: number;
  maxBatchCardsBudget: number;
  maxBatchRawJsonBytesBudget: number;
  isPageLocal: true;
}

export interface LibraryRecentReviewsResult {
  rows: LibraryRecentReviewEntry[];
  next: string | null;
  pendingMaterialIds: string[];
  enrichment: HistoryMaterialEnrichmentRecord[] | null;
  summary: LibraryRecentReviewsSummary;
}

export interface PracticeHistoryGroup {
  historyKey: string;
  sourceMaterialTitle: string;
  sourceMaterialId: string | null;
  completedCount: number;
  latestCompletedAt: IsoDateTime | null;
  latestScorePercent: number | null;
  hasActiveMaterial: boolean;
}

/* ------------------------------------------------------------------ */
/* Schedule                                                            */
/* ------------------------------------------------------------------ */

export type EventType =
  | "flight_lesson"
  | "study_session"
  | "ground_school"
  | "instructor_meeting"
  | "test"
  | "medical"
  | "deadline"
  | "personal";
export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  flight_lesson: "Flight Lesson",
  study_session: "Study Session",
  ground_school: "Ground School",
  instructor_meeting: "Instructor Meeting",
  test: "Test",
  medical: "Medical",
  deadline: "Deadline",
  personal: "Personal Commitment",
};
export const EVENT_TYPE_OPTIONS = options(EVENT_TYPE_LABELS);

export type EventStatus = "scheduled" | "completed" | "cancelled" | "rescheduled";
export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  scheduled: "Scheduled",
  completed: "Completed",
  cancelled: "Cancelled",
  rescheduled: "Rescheduled",
};
export const EVENT_STATUS_OPTIONS = options(EVENT_STATUS_LABELS);

export interface PrepItem {
  id: Id;
  eventId: Id;
  title: string;
  done: boolean;
  position: number;
  createdAt: IsoDateTime;
}

export interface ScheduleEvent {
  id: Id;
  title: string;
  eventType: EventType;
  date: IsoDate;
  startTime: string | null;
  endTime: string | null;
  location: string;
  instructor: string;
  notes: string;
  goalId: Id | null;
  estimatedCost: Cents | null;
  actualCost: Cents | null;
  status: EventStatus;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  /** Ids of study materials attached for preparation. */
  materialIds: Id[];
}

/* ------------------------------------------------------------------ */
/* Flight Journal                                                      */
/* ------------------------------------------------------------------ */

export interface JournalEntry {
  id: Id;
  eventId: Id | null;
  date: IsoDate;
  title: string;
  /** Training-flight details. Values are entered from the instructor-approved log entry. */
  aircraftType: string;
  aircraftId: string;
  departureAirport: string;
  arrivalAirport: string;
  instructorName: string;
  totalTime: number | null;
  dualReceived: number | null;
  soloTime: number | null;
  picTime: number | null;
  crossCountryTime: number | null;
  nightTime: number | null;
  actualInstrumentTime: number | null;
  simulatedInstrumentTime: number | null;
  dayLandings: number | null;
  nightLandings: number | null;
  mission: string;
  practiced: string;
  wentWell: string;
  wasDifficult: string;
  instructorFeedback: string;
  questionsForNextTime: string;
  /** Reflective 1–5 self-assessment, not an official proficiency rating. */
  confidence: number | null;
  goalId: Id | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  materialIds: Id[];
}

/* ------------------------------------------------------------------ */
/* Notes — free writing that belongs to nothing else                   */
/* ------------------------------------------------------------------ */

/**
 * A note she wrote for no reason but wanting to keep it.
 *
 * Everywhere else a thought can be typed is attached to something — a lesson,
 * a material, a goal. This is the one that is not: a title she can leave
 * blank, the text, and a pin for the handful worth keeping at the top.
 */
export interface Note {
  id: Id;
  title: string;
  body: string;
  pinned: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/* ------------------------------------------------------------------ */
/* Questions                                                           */
/* ------------------------------------------------------------------ */

export type QuestionStatus = "to_ask" | "asked" | "answered" | "revisit";
export const QUESTION_STATUS_LABELS: Record<QuestionStatus, string> = {
  to_ask: "To Ask",
  asked: "Asked",
  answered: "Answered",
  revisit: "Revisit",
};
export const QUESTION_STATUS_OPTIONS = options(QUESTION_STATUS_LABELS);

export interface Question {
  id: Id;
  text: string;
  topic: Topic;
  eventId: Id | null;
  materialId: Id | null;
  journalId: Id | null;
  /** Provenance kept by database triggers when a linked record is deleted (see NextAction). */
  sourceJournalId?: Id | null;
  sourceMaterialId?: Id | null;
  sourceEventId?: Id | null;
  status: QuestionStatus;
  answer: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  answeredAt: IsoDateTime | null;
}

/* ------------------------------------------------------------------ */
/* Training finances                                                   */
/* ------------------------------------------------------------------ */

export type TransactionType = "contribution" | "expense";

export type ExpenseCategory =
  | "flight_lesson"
  | "aircraft_rental"
  | "instructor"
  | "ground_school"
  | "exam"
  | "medical"
  | "books"
  | "study_materials"
  | "headset"
  | "equipment"
  | "fees"
  | "travel"
  | "other";
export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  flight_lesson: "Flight Lesson",
  aircraft_rental: "Aircraft Rental",
  instructor: "Instructor",
  ground_school: "Ground School",
  exam: "Exam/Test",
  medical: "Medical",
  books: "Books",
  study_materials: "Study Materials",
  headset: "Headset",
  equipment: "Equipment",
  fees: "Applications/Fees",
  travel: "Travel",
  other: "Other",
};
export const EXPENSE_CATEGORY_OPTIONS = options(EXPENSE_CATEGORY_LABELS);

/**
 * How a transaction came to exist. `lesson_cost` rows are created by the
 * "record this lesson's cost" flow and are unique per lesson, which is what
 * keeps that convenience from producing duplicates.
 */
export type TransactionSource = "manual" | "lesson_cost";

export interface Transaction {
  id: Id;
  type: TransactionType;
  amount: Cents;
  date: IsoDate;
  category: ExpenseCategory;
  description: string;
  notes: string;
  eventId: Id | null;
  goalId: Id | null;
  source: TransactionSource;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface FundGoal {
  id: Id;
  title: string;
  target: Cents;
  active: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/* ------------------------------------------------------------------ */
/* Profile                                                             */
/* ------------------------------------------------------------------ */

/** The accent colour the interface uses, chosen from the spec palette. */
export type AccentColor = "berry" | "lavender" | "sky" | "mint";
export const ACCENT_LABELS: Record<AccentColor, string> = {
  berry: "Berry",
  lavender: "Lavender",
  sky: "Sky",
  mint: "Mint",
};
export const ACCENT_ORDER: AccentColor[] = ["berry", "lavender", "sky", "mint"];

export interface Profile {
  id: Id;
  pilotName: string;
  certificateGoal: string;
  currentFocus: string;
  currentMilestoneId: Id | null;

  /* Where and with whom she trains. These pre-fill new lessons. */
  flightSchool: string;
  instructorName: string;
  homeAirport: string;
  aircraftType: string;
  trainingStartedOn: IsoDate | null;

  /** Her own reminder. The certificate itself remains the authority. */
  medicalExpiry: IsoDate | null;

  /** Why she started. Hers to write, shown back to her, never analysed. */
  whyNote: string;
  /** A downscaled data URL, or null. Lives only in her private database. */
  photo: string | null;

  accentColor: AccentColor;

  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/* ------------------------------------------------------------------ */
/* Pilot Toolkit                                                       */
/* ------------------------------------------------------------------ */

export type ReadinessStatus = "not_started" | "learning" | "ready" | "instructor_signed_off";
export const READINESS_STATUS_LABELS: Record<ReadinessStatus, string> = {
  not_started: "Not Started",
  learning: "Learning",
  ready: "Feels Ready",
  instructor_signed_off: "Instructor Signed Off",
};
export const READINESS_STATUS_OPTIONS = options(READINESS_STATUS_LABELS);

export interface ReadinessItem {
  id: Id;
  area: "knowledge" | "flight" | "administration";
  title: string;
  status: ReadinessStatus;
  notes: string;
}

export type CredentialType =
  | "pilot_certificate"
  | "medical"
  | "endorsement"
  | "knowledge_test"
  | "practical_test"
  | "identification"
  | "other";
export const CREDENTIAL_TYPE_LABELS: Record<CredentialType, string> = {
  pilot_certificate: "Pilot Certificate",
  medical: "Medical Certificate",
  endorsement: "Instructor Endorsement",
  knowledge_test: "Knowledge Test",
  practical_test: "Practical Test",
  identification: "Identification",
  other: "Other Record",
};
export const CREDENTIAL_TYPE_OPTIONS = options(CREDENTIAL_TYPE_LABELS);

export interface CredentialRecord {
  id: Id;
  type: CredentialType;
  title: string;
  identifier: string;
  issuedOn: IsoDate | null;
  expiresOn: IsoDate | null;
  notes: string;
  materialId: Id | null;
}

export type SafetyDecision = "go" | "discuss" | "no_go";
export interface SafetyCheck {
  id: Id;
  date: IsoDateTime;
  illnessOkay: boolean;
  medicationOkay: boolean;
  stressOkay: boolean;
  alcoholOkay: boolean;
  fatigueOkay: boolean;
  emotionOkay: boolean;
  weatherReviewed: boolean;
  aircraftReviewed: boolean;
  personalMinimumsMet: boolean;
  decision: SafetyDecision;
  notes: string;
}

export interface QuizAttempt {
  id: Id;
  date: IsoDateTime;
  score: number;
  total: number;
  weakTopics: Topic[];
}

export interface ToolkitState {
  version: 1;
  readinessItems: ReadinessItem[];
  credentials: CredentialRecord[];
  safetyChecks: SafetyCheck[];
  quizAttempts: QuizAttempt[];
  remindersEnabled: boolean;
  reminderLeadDays: number;
  estimatedHourlyCost: Cents;
  additionalTrainingCosts: Cents;
  targetAirline: string;
  careerSummary: string;
  nextCareerStep: string;
}
