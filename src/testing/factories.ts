/**
 * Test data builders.
 *
 * Every builder returns a complete, valid entity so a test only has to state
 * the fields it actually cares about.
 */
import type {
  ChecklistItem,
  FlightSchool,
  Goal,
  JournalEntry,
  Milestone,
  NextAction,
  Note,
  PrepItem,
  Profile,
  Question,
  ScheduleEvent,
  StudyMaterial,
  Transaction,
} from "@/domain/types";

const STAMP = "2026-09-01T00:00:00.000Z";
const id = () => crypto.randomUUID();

export const makeProfile = (overrides: Partial<Profile> = {}): Profile => ({
  id: "profile",
  pilotName: "Ava",
  certificateGoal: "Private Pilot",
  currentFocus: "Landings",
  currentMilestoneId: null,
  flightSchool: "",
  instructorName: "",
  homeAirport: "",
  aircraftType: "",
  trainingStartedOn: null,
  medicalExpiry: null,
  whyNote: "",
  photo: null,
  accentColor: "berry",
  createdAt: STAMP,
  updatedAt: STAMP,
  ...overrides,
});

export const makeAction = (overrides: Partial<NextAction> = {}): NextAction => ({
  id: id(),
  title: "Review crosswind landing notes",
  description: "",
  category: "prepare",
  priority: "important",
  status: "open",
  dueDate: null,
  estimatedMinutes: null,
  relatedType: null,
  relatedId: null,
  materialId: null,
  sourceMaterialId: null,
  createdAt: STAMP,
  updatedAt: STAMP,
  completedAt: null,
  ...overrides,
});

export const makeEvent = (overrides: Partial<ScheduleEvent> = {}): ScheduleEvent => ({
  id: id(),
  title: "Crosswind Landings",
  eventType: "flight_lesson",
  date: "2026-09-10",
  startTime: "10:30",
  endTime: null,
  location: "",
  instructor: "",
  notes: "",
  goalId: null,
  estimatedCost: null,
  actualCost: null,
  status: "scheduled",
  createdAt: STAMP,
  updatedAt: STAMP,
  materialIds: [],
  ...overrides,
});

export const makePrepItem = (overrides: Partial<PrepItem> = {}): PrepItem => ({
  id: id(),
  eventId: "event",
  title: "Weather review",
  done: false,
  position: 0,
  createdAt: STAMP,
  ...overrides,
});

export const makeMaterial = (overrides: Partial<StudyMaterial> = {}): StudyMaterial => ({
  id: id(),
  title: "Crosswind Landing Notes",
  materialType: "lesson_notes",
  topic: "landings",
  reviewStatus: "needs_review",
  priority: "later",
  goalId: null,
  eventId: null,
  notes: "",
  filePath: null,
  originalFileName: null,
  fileSize: null,
  createdAt: STAMP,
  updatedAt: STAMP,
  lastReviewedAt: null,
  tags: [],
  ...overrides,
});

export const makeMilestone = (overrides: Partial<Milestone> = {}): Milestone => ({
  id: id(),
  title: "Build Landing Confidence",
  description: "",
  position: 0,
  status: "in_progress",
  targetDate: null,
  createdAt: STAMP,
  updatedAt: STAMP,
  ...overrides,
});

export const makeGoal = (overrides: Partial<Goal> = {}): Goal => ({
  id: id(),
  milestoneId: null,
  title: "Crosswind landings",
  description: "",
  status: "working_on",
  priority: "important",
  targetDate: null,
  notes: "",
  confidence: null,
  createdAt: STAMP,
  updatedAt: STAMP,
  completedAt: null,
  ...overrides,
});

export const makeChecklistItem = (overrides: Partial<ChecklistItem> = {}): ChecklistItem => ({
  id: id(),
  goalId: "goal",
  title: "Normal approaches",
  done: false,
  position: 0,
  createdAt: STAMP,
  ...overrides,
});

export const makeJournalEntry = (overrides: Partial<JournalEntry> = {}): JournalEntry => ({
  id: id(),
  eventId: null,
  date: "2026-09-01",
  title: "",
  aircraftType: "",
  aircraftId: "",
  departureAirport: "",
  arrivalAirport: "",
  instructorName: "",
  totalTime: null,
  dualReceived: null,
  soloTime: null,
  picTime: null,
  crossCountryTime: null,
  nightTime: null,
  actualInstrumentTime: null,
  simulatedInstrumentTime: null,
  dayLandings: null,
  nightLandings: null,
  mission: "",
  practiced: "",
  wentWell: "",
  wasDifficult: "",
  instructorFeedback: "",
  questionsForNextTime: "",
  confidence: null,
  goalId: null,
  createdAt: STAMP,
  updatedAt: STAMP,
  materialIds: [],
  ...overrides,
});

export const makeQuestion = (overrides: Partial<Question> = {}): Question => ({
  id: id(),
  text: "How should I time the flare?",
  topic: "landings",
  eventId: null,
  materialId: null,
  journalId: null,
  sourceJournalId: null,
  sourceMaterialId: null,
  sourceEventId: null,
  status: "to_ask",
  answer: "",
  createdAt: STAMP,
  updatedAt: STAMP,
  answeredAt: null,
  ...overrides,
});

export const makeNote = (overrides: Partial<Note> = {}): Note => ({
  id: id(),
  title: "",
  body: "Ask about the discovery flight price",
  pinned: false,
  createdAt: STAMP,
  updatedAt: STAMP,
  ...overrides,
});

export const makeTransaction = (overrides: Partial<Transaction> = {}): Transaction => ({
  id: id(),
  type: "expense",
  amount: 0,
  date: "2026-09-01",
  category: "other",
  description: "",
  notes: "",
  eventId: null,
  goalId: null,
  source: "manual",
  createdAt: STAMP,
  updatedAt: STAMP,
  ...overrides,
});

export const makeFlightSchool = (
  overrides: Partial<FlightSchool> = {},
): FlightSchool => ({
  id: id(),
  name: "Skyline Flight Academy",
  hourlyCostCents: 22000,
  aircraftDescription: "Cessna 172S G1000",
  trainingTrack: "Part 61",
  availabilityDescription: "Weekdays and weekends",
  discoveryFlightReflection: "Great instructor rapport, very thorough pre-flight.",
  createdAt: STAMP,
  updatedAt: STAMP,
  ...overrides,
});
