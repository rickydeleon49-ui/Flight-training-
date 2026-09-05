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

  accentColor: AccentColor;

  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
