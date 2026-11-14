import type {
  CredentialRecord,
  IsoDate,
  JournalEntry,
  NextAction,
  Profile,
  QuizAttempt,
  ReadinessItem,
  ScheduleEvent,
  StudyReminder,
  ToolkitState,
  Topic,
  Transaction,
} from "@/domain/types";
import { addDays, daysBetween, todayIso } from "@/lib/dates";
import { trainingCostSummary } from "./finance";
import type { FlightLogTotals } from "./flightLog";

export const DEFAULT_READINESS_ITEMS: ReadinessItem[] = [
  { id: "ready-knowledge-test", area: "knowledge", title: "Knowledge test completed and current", status: "not_started", notes: "" },
  { id: "ready-acs", area: "knowledge", title: "Current ACS reviewed with instructor", status: "not_started", notes: "" },
  { id: "ready-planning", area: "knowledge", title: "Cross-country planning and weather discussion", status: "not_started", notes: "" },
  { id: "ready-aircraft", area: "knowledge", title: "Aircraft systems, performance, and limitations", status: "not_started", notes: "" },
  { id: "ready-maneuvers", area: "flight", title: "Applicable maneuvers and takeoffs/landings", status: "not_started", notes: "" },
  { id: "ready-emergencies", area: "flight", title: "Emergency operations and aeronautical decision-making", status: "not_started", notes: "" },
  { id: "ready-navigation", area: "flight", title: "Navigation, diversion, and lost procedures", status: "not_started", notes: "" },
  { id: "ready-mock", area: "flight", title: "Instructor-led mock oral and practical review", status: "not_started", notes: "" },
  { id: "ready-experience", area: "administration", title: "Aeronautical experience reviewed by instructor", status: "not_started", notes: "" },
  { id: "ready-endorsements", area: "administration", title: "Required endorsements reviewed by instructor", status: "not_started", notes: "" },
  { id: "ready-documents", area: "administration", title: "Application and required documents assembled", status: "not_started", notes: "" },
  { id: "ready-signoff", area: "administration", title: "Instructor confirms practical-test readiness", status: "not_started", notes: "" },
];

export const DEFAULT_REMINDER_TIME = "19:00";

/** Keeps a good stored daily reminder; anything else becomes off at 19:00. */
export function normalizeStudyReminder(value: unknown): StudyReminder {
  const v = (value && typeof value === "object" ? value : {}) as Partial<StudyReminder>;
  const time = typeof v.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v.time) ? v.time : DEFAULT_REMINDER_TIME;
  return { enabled: v.enabled === true, time };
}

/** Keeps a real calendar day "YYYY-MM-DD"; anything else is no date. */
export function normalizeCheckrideDate(value: unknown): IsoDate | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const check = new Date(y!, m! - 1, d!);
  return check.getFullYear() === y && check.getMonth() === m! - 1 && check.getDate() === d ? value : null;
}

export const DEFAULT_TOOLKIT_STATE: ToolkitState = {
  version: 1,
  readinessItems: DEFAULT_READINESS_ITEMS,
  credentials: [],
  safetyChecks: [],
  quizAttempts: [],
  remindersEnabled: true,
  studyReminder: { enabled: false, time: DEFAULT_REMINDER_TIME },
  checkrideDate: null,
  reminderLeadDays: 7,
  estimatedHourlyCost: 220_00,
  additionalTrainingCosts: 1_500_00,
  targetAirline: "",
  careerSummary: "",
  nextCareerStep: "Complete private pilot training with strong fundamentals.",
};

/**
 * Deep copy of toolkit data: arrays and plain objects are copied, primitives
 * kept. Toolkit state is JSON-shaped (it is stored as JSON), so this is all it
 * needs; it is deliberately not a general structured clone. Anything else (no
 * such values exist in ToolkitState) is passed through unchanged.
 *
 * Used instead of `structuredClone`, which WebKit only added in Safari 15.4
 * (macOS 12.3) while the app supports macOS 12.0.
 */
export function copyToolkitData<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => copyToolkitData(item)) as T;
  if (value !== null && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return value;
    const copy: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) copy[key] = copyToolkitData(item);
    return copy as T;
  }
  return value;
}

/** A fresh default toolkit that owns all of its nested objects and arrays. */
export function defaultToolkitState(): ToolkitState {
  return copyToolkitData(DEFAULT_TOOLKIT_STATE);
}

/** A stored amount that is a number of zero or more, or the default. */
function nonNegativeOr(value: unknown, fallback: number): number {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) ? Math.max(0, number) : fallback;
}

/**
 * The reminder window as whole days from 0 to 90. Used for what is saved and
 * for the preview, so the list the student sees is the one the student will get.
 */
export function reminderLeadDays(value: unknown, fallback = 7): number {
  const number = Number(value === "" || value == null ? fallback : value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(90, Math.max(0, Math.floor(number)));
}

/**
 * Fill in defaults and repair stored toolkit state. The result shares nothing
 * with the input or the defaults, so editing it cannot change either.
 */
export function normalizeToolkitState(value: unknown): ToolkitState {
  if (!value || typeof value !== "object") return defaultToolkitState();
  const input = value as Partial<ToolkitState>;
  const storedItems = Array.isArray(input.readinessItems) ? input.readinessItems : [];
  const mergedItems = DEFAULT_READINESS_ITEMS.map(
    (fallback) => storedItems.find((item) => item?.id === fallback.id) ?? fallback,
  );
  const customItems = storedItems.filter(
    (item) => item?.id && !DEFAULT_READINESS_ITEMS.some((fallback) => fallback.id === item.id),
  );

  const { studyGuideNotice, ...rest } = input;
  return copyToolkitData({
    ...DEFAULT_TOOLKIT_STATE,
    ...rest,
    ...(typeof studyGuideNotice === "boolean" ? { studyGuideNotice } : {}),
    studyReminder: normalizeStudyReminder(input.studyReminder),
    checkrideDate: normalizeCheckrideDate(input.checkrideDate),
    version: 1,
    readinessItems: [...mergedItems, ...customItems],
    credentials: Array.isArray(input.credentials) ? input.credentials : [],
    safetyChecks: Array.isArray(input.safetyChecks) ? input.safetyChecks : [],
    quizAttempts: Array.isArray(input.quizAttempts) ? input.quizAttempts : [],
    reminderLeadDays: reminderLeadDays(input.reminderLeadDays),
    estimatedHourlyCost: nonNegativeOr(input.estimatedHourlyCost, 220_00),
    additionalTrainingCosts: nonNegativeOr(input.additionalTrainingCosts, 1_500_00),
  });
}

export function readinessSummary(items: ReadinessItem[]) {
  const signedOff = items.filter((item) => item.status === "instructor_signed_off").length;
  const ready = items.filter(
    (item) => item.status === "ready" || item.status === "instructor_signed_off",
  ).length;
  return { total: items.length, ready, signedOff, percent: items.length ? (ready / items.length) * 100 : 0 };
}

const TRAINING_CATEGORIES = new Set([
  "flight_lesson", "aircraft_rental", "instructor", "ground_school", "exam",
  "medical", "books", "study_materials", "headset", "equipment", "fees",
]);

/**
 * Planning estimate for the rest of private pilot training.
 *
 * The observed hourly rate is lesson cost per flight hour from lessons that
 * have both a recorded cost and logged time (see `trainingCostSummary`). It
 * never divides one-off costs such as a headset, medical or books by flight
 * hours, because those would then be multiplied across every remaining hour;
 * they stay in tracked spending and in the student's own "additional remaining costs".
 */
export function trainingCostForecast(
  totals: FlightLogTotals,
  transactions: Transaction[],
  state: ToolkitState,
  journalEntries: Pick<JournalEntry, "eventId" | "totalTime">[] = [],
) {
  const spent = transactions
    .filter((item) => item.type === "expense" && TRAINING_CATEGORIES.has(item.category))
    .reduce((sum, item) => sum + item.amount, 0);
  const observed = trainingCostSummary(transactions, journalEntries).perFlightHour;
  const observedHourly = observed?.perHour ?? null;
  const hourly = observedHourly ?? state.estimatedHourlyCost;
  const remainingHours = Math.max(0, 40 - totals.totalTime);
  const estimatedRemaining = Math.round(remainingHours * hourly) + state.additionalTrainingCosts;
  return {
    spent,
    observedHourly,
    /** How many lessons the observed rate comes from, or null when the student's estimate is used. */
    observedLessons: observed?.lessonsCounted ?? null,
    hourly,
    remainingHours,
    estimatedRemaining,
    projectedTotal: spent + estimatedRemaining,
  };
}

export interface MedicalDateConflict {
  /** The medical expiry the student entered in Settings. */
  settingsDate: IsoDate;
  /** The student's latest-expiring saved medical record, whose date differs. */
  record: CredentialRecord & { expiresOn: IsoDate };
}

/**
 * Settings and the student's saved medical record giving different expiry dates.
 *
 * Only the latest-expiring medical record is compared: an earlier medical the student
 * kept as a record is history, not a conflict. Nothing is reconciled here;
 * the student is asked which date matches the student's certificate.
 */
export function medicalDateConflict(
  profile: Profile,
  credentials: CredentialRecord[],
): MedicalDateConflict | null {
  if (!profile.medicalExpiry) return null;
  const latest = credentials
    .filter((item): item is MedicalDateConflict["record"] => item.type === "medical" && Boolean(item.expiresOn))
    .sort((a, b) => b.expiresOn.localeCompare(a.expiresOn))[0];
  if (!latest || latest.expiresOn === profile.medicalExpiry) return null;
  return { settingsDate: profile.medicalExpiry, record: latest };
}

/** Which of the student two medical dates the student says matches the student's certificate. */
export interface MedicalDateChoice {
  authority: "record" | "settings";
  /** The two dates and the record exactly as they were shown to the student. */
  settingsDate: IsoDate;
  recordId: string;
  recordDate: IsoDate;
}

export type MedicalReconciliation =
  | { write: "none"; reason: "stale" }
  | { write: "profile"; medicalExpiry: IsoDate }
  | { write: "record"; credentials: CredentialRecord[] };

/**
 * What the student's choice changes, decided against the dates as they are saved now.
 *
 * The student chose between two dates on screen. If either date, or which record is
 * the student's latest medical, has changed since then (an earlier choice, an edit
 * elsewhere, a removed record), the choice no longer answers the question the student
 * saw: nothing is written and the current dates are shown again.
 */
export function reconcileMedicalDates(
  profile: Profile,
  credentials: CredentialRecord[],
  choice: MedicalDateChoice,
): MedicalReconciliation {
  const current = medicalDateConflict(profile, credentials);
  if (
    !current ||
    current.settingsDate !== choice.settingsDate ||
    current.record.id !== choice.recordId ||
    current.record.expiresOn !== choice.recordDate
  ) {
    return { write: "none", reason: "stale" };
  }
  if (choice.authority === "record") return { write: "profile", medicalExpiry: choice.recordDate };
  return {
    write: "record",
    credentials: credentials.map((item) =>
      item.id === choice.recordId ? { ...item, expiresOn: choice.settingsDate } : item,
    ),
  };
}

export interface ReminderItem {
  id: string;
  title: string;
  detail: string;
  date: IsoDate;
  urgent: boolean;
  actionId?: string;
  homeworkId?: string;
}

export function buildReminders(input: {
  actions: NextAction[];
  events: ScheduleEvent[];
  credentials: CredentialRecord[];
  profile: Profile;
  homework?: readonly import("@/domain/homework").HomeworkSnapshot[];
  today?: IsoDate;
  leadDays: number;
}): ReminderItem[] {
  const today = input.today ?? todayIso();
  const through = addDays(today, input.leadDays);
  const reminders: ReminderItem[] = [];
  for (const action of input.actions) {
    if (action.status !== "open" || !action.dueDate || action.dueDate > through) continue;
    const boundHw = input.homework?.find(h => h.assignment.action_id === action.id && !h.assignment.archived);
    const detail = boundHw
      ? (action.dueDate < today ? "Homework overdue" : "Homework due")
      : (action.dueDate < today ? "Action overdue" : "Action due");
    reminders.push({
      id: `action-${action.id}`,
      title: action.title,
      detail,
      date: action.dueDate,
      urgent: action.dueDate < today,
      actionId: action.id,
      homeworkId: boundHw?.assignment.id,
    });
  }
  for (const event of input.events) {
    if (event.status !== "scheduled" || event.date < today || event.date > through) continue;
    reminders.push({ id: `event-${event.id}`, title: event.title, detail: "Scheduled training", date: event.date, urgent: event.date === today });
  }
  const datedRecords = [
    ...input.credentials.filter((item) => item.expiresOn).map((item) => ({ id: `credential-${item.id}`, title: item.title, date: item.expiresOn! })),
    // The medical expiry in Settings and a saved medical record with the same
    // date are one document; it is listed once. Different dates both stay.
    ...(input.profile.medicalExpiry &&
    !input.credentials.some((item) => item.type === "medical" && item.expiresOn === input.profile.medicalExpiry)
      ? [{ id: "profile-medical", title: "Medical certificate", date: input.profile.medicalExpiry }]
      : []),
  ];
  // When the two medical dates disagree, both are shown and both say so.
  const conflict = medicalDateConflict(input.profile, input.credentials);
  const conflicting = conflict ? new Set(["profile-medical", `credential-${conflict.record.id}`]) : new Set<string>();
  for (const item of datedRecords) {
    if (item.date > through) continue;
    const detail = item.date < today ? "Record may be expired" : "Expiration approaching";
    reminders.push({
      id: item.id,
      title: item.title,
      detail: conflicting.has(item.id) ? `${detail} · your two medical dates differ` : detail,
      date: item.date,
      urgent: item.date <= today,
    });
  }
  return reminders.sort((a, b) => a.date.localeCompare(b.date));
}

export interface QuizQuestion {
  id: string;
  topic: Topic;
  prompt: string;
  choices: string[];
  correct: number;
  explanation: string;
}

export const QUIZ_QUESTIONS: QuizQuestion[] = [
  { id: "weather-density", topic: "weather", prompt: "Which combination generally increases density altitude?", choices: ["Low temperature and high pressure", "High temperature and low pressure", "Low humidity and low elevation"], correct: 1, explanation: "Higher temperature and lower pressure reduce air density and increase density altitude." },
  { id: "systems-pitot", topic: "aircraft_systems", prompt: "Which instrument primarily uses both pitot and static pressure?", choices: ["Altimeter", "Airspeed indicator", "Heading indicator"], correct: 1, explanation: "The airspeed indicator compares pitot pressure with static pressure." },
  { id: "aero-stall", topic: "aerodynamics", prompt: "An aerodynamic stall occurs when the wing exceeds its:", choices: ["Critical angle of attack", "Maximum approved bank", "Minimum indicated airspeed"], correct: 0, explanation: "A stall is caused by exceeding the wing's critical angle of attack, not by one fixed airspeed." },
  { id: "comm-emergency", topic: "communications", prompt: "Which transponder code is associated with a general emergency?", choices: ["7500", "7600", "7700"], correct: 2, explanation: "7700 indicates a general emergency; 7600 is lost communications and 7500 indicates unlawful interference." },
  { id: "performance-weight", topic: "performance", prompt: "Increasing aircraft weight generally causes takeoff distance to:", choices: ["Decrease", "Remain unchanged", "Increase"], correct: 2, explanation: "More weight generally requires more lift and acceleration, increasing takeoff distance." },
  { id: "navigation-diversion", topic: "navigation", prompt: "After deciding to divert, the first priority is to:", choices: ["Maintain aircraft control", "Calculate exact fuel burn", "Call the destination FBO"], correct: 0, explanation: "Aircraft control remains the first priority while organizing navigation and communication tasks." },
  { id: "airport-windsock", topic: "airports", prompt: "The small end of a windsock points generally:", choices: ["Into the wind", "Downwind", "Toward magnetic north"], correct: 1, explanation: "The open end faces the wind; the narrow end streams downwind." },
  { id: "emergency-aviate", topic: "emergency_procedures", prompt: "In an abnormal situation, the enduring priority order begins with:", choices: ["Communicate", "Navigate", "Aviate"], correct: 2, explanation: "Maintain aircraft control first, then navigate and communicate as circumstances permit." },
  { id: "weather-fog", topic: "weather", prompt: "Fog is most likely to form when:", choices: ["Temperature and dew point are close together", "The wind is strong and gusty", "The air is very dry"], correct: 0, explanation: "Fog forms when air cools to its dew point, so a small and shrinking temperature-dew point spread is a warning sign." },
  { id: "weather-tstorm-mature", topic: "weather", prompt: "Which thunderstorm stage has strong updrafts and downdrafts together, with rain beginning to fall?", choices: ["Cumulus stage", "Mature stage", "Dissipating stage"], correct: 1, explanation: "The mature stage has both updrafts and downdrafts, and precipitation starts at the surface." },
  { id: "weather-inversion", topic: "weather", prompt: "A temperature inversion is a layer where air temperature:", choices: ["Falls faster than normal with altitude", "Increases with altitude", "Stays the same at every altitude"], correct: 1, explanation: "In an inversion the air gets warmer as you climb, which often traps haze and fog near the ground." },
  { id: "systems-carb-ice", topic: "aircraft_systems", prompt: "Carburetor ice can form:", choices: ["Only when the outside air is below freezing", "Even when the outside air is well above freezing, if humidity is high", "Only while flying in cloud"], correct: 1, explanation: "Fuel vaporization and air expansion cool the carburetor, so ice can form on a mild, humid day." },
  { id: "systems-magneto", topic: "aircraft_systems", prompt: "If the battery and alternator both fail, a piston engine with magnetos will:", choices: ["Keep running", "Stop at once", "Run on one cylinder bank only"], correct: 0, explanation: "Magnetos make their own spark and do not depend on the aircraft electrical system." },
  { id: "systems-static-block", topic: "aircraft_systems", prompt: "If the static port becomes blocked in flight, the altimeter will:", choices: ["Keep reading correctly", "Stay at the altitude where the blockage happened", "Read zero"], correct: 1, explanation: "The trapped static pressure no longer changes, so the altimeter stays frozen at that altitude." },
  { id: "aero-load-60", topic: "aerodynamics", prompt: "In a coordinated, level turn at 60 degrees of bank, the load factor is about:", choices: ["1 G", "2 G", "3 G"], correct: 1, explanation: "At 60 degrees of bank the wings carry about twice the airplane's weight." },
  { id: "aero-bank-stall", topic: "aerodynamics", prompt: "As the bank angle of a level turn increases, the stall speed:", choices: ["Decreases", "Increases", "Stays the same"], correct: 1, explanation: "A steeper bank raises the load factor, which raises stall speed." },
  { id: "aero-ground-effect", topic: "aerodynamics", prompt: "Flying close to the ground (ground effect) generally:", choices: ["Increases induced drag", "Reduces induced drag", "Has no effect on drag"], correct: 1, explanation: "Near the surface the wingtip vortices are disrupted, which reduces induced drag and can make the airplane float." },
  { id: "comm-mayday", topic: "communications", prompt: "Which call is used for a distress situation, meaning grave and imminent danger?", choices: ["MAYDAY", "PAN-PAN", "SECURITE"], correct: 0, explanation: "MAYDAY is for distress. PAN-PAN is for urgency, a serious situation that is not yet a distress." },
  { id: "comm-121-5", topic: "communications", prompt: "The international aviation emergency frequency is:", choices: ["118.0 MHz", "121.5 MHz", "126.7 MHz"], correct: 1, explanation: "121.5 MHz is monitored as the emergency frequency." },
  { id: "comm-ctaf", topic: "communications", prompt: "At an airport with no operating control tower, pilots announce their position and intentions on:", choices: ["The CTAF", "The ATIS", "The ground control frequency"], correct: 0, explanation: "The Common Traffic Advisory Frequency is used to self-announce at non-towered airports." },
  { id: "perf-headwind", topic: "performance", prompt: "Compared with calm wind, a headwind on takeoff generally:", choices: ["Lengthens the ground roll", "Shortens the ground roll", "Does not change the ground roll"], correct: 1, explanation: "A headwind lowers the ground speed needed to reach flying speed, so the ground roll is shorter." },
  { id: "perf-da-climb", topic: "performance", prompt: "At a high density altitude, an airplane's climb performance generally:", choices: ["Decreases", "Increases", "Stays the same"], correct: 0, explanation: "Thinner air reduces both engine power and propeller and wing efficiency." },
  { id: "perf-aft-cg", topic: "performance", prompt: "Moving the center of gravity aft generally makes the airplane:", choices: ["More stable", "Less stable", "No different in stability"], correct: 1, explanation: "An aft center of gravity reduces pitch stability, and an airplane loaded too far aft can be hard to recover from a stall." },
  { id: "nav-latitude", topic: "navigation", prompt: "Lines of latitude measure distance:", choices: ["East or west of the prime meridian", "North or south of the equator", "Above mean sea level"], correct: 1, explanation: "Latitude is measured in degrees north or south of the equator." },
  { id: "nav-variation", topic: "navigation", prompt: "Applying magnetic variation to a true course gives:", choices: ["Magnetic course", "Compass course", "Ground track"], correct: 0, explanation: "True course corrected for variation is magnetic course; deviation is then applied to get compass course." },
  { id: "nav-dead-reckoning", topic: "navigation", prompt: "Dead reckoning navigation relies on:", choices: ["Computed heading, airspeed and elapsed time", "Radio navigation signals only", "Satellite signals only"], correct: 0, explanation: "Dead reckoning predicts position from a known start point using course, speed and time." },
  { id: "airport-runway-number", topic: "airports", prompt: "Runway 27 is lined up with a magnetic heading of about:", choices: ["027 degrees", "270 degrees", "072 degrees"], correct: 1, explanation: "The runway number is the magnetic heading rounded to the nearest 10 degrees, with the last zero dropped." },
  { id: "airport-pattern", topic: "airports", prompt: "Unless otherwise indicated, traffic pattern turns are made to the:", choices: ["Left", "Right", "Side with less traffic"], correct: 0, explanation: "Standard traffic patterns use left turns unless the airport says otherwise." },
  { id: "airport-displaced", topic: "airports", prompt: "Pavement before a displaced threshold (marked with arrows) may be used for:", choices: ["Touchdown", "Takeoff, taxiing and landing rollout, but not touchdown", "Nothing; it is closed"], correct: 1, explanation: "The displaced threshold marks where landing may begin; the earlier pavement is still usable for other movements." },
  { id: "emerg-glide", topic: "emergency_procedures", prompt: "After an engine failure in a single-engine airplane, the first action is to:", choices: ["Start the restart checklist", "Pitch for the best glide speed", "Turn back to the departure airport"], correct: 1, explanation: "Establish best glide speed first so you keep the most time and distance to choose a landing spot and run the checklist." },
  { id: "emerg-disorientation", topic: "emergency_procedures", prompt: "If you feel spatially disoriented in clouds, you should:", choices: ["Trust your body sensations", "Rely on the flight instruments", "Look for the horizon through gaps"], correct: 1, explanation: "The inner ear can give false signals; the instruments tell the true attitude." },
  { id: "emerg-co", topic: "emergency_procedures", prompt: "Headache and drowsiness, with a faint exhaust smell while the cabin heater is on, suggest:", choices: ["Hypoxia from altitude", "Carbon monoxide poisoning", "Normal fatigue"], correct: 1, explanation: "A leaking exhaust can send carbon monoxide into the cabin heat. Shut off the heater, open fresh air and land as soon as practical." },
];

/** Questions in one quiz attempt. */
export const QUIZ_LENGTH = 8;

/** Seeded (mulberry32) Fisher-Yates pick: the same seed always gives the same unique set. */
export function selectQuizQuestions(seed: number, count: number = QUIZ_LENGTH, pool: QuizQuestion[] = QUIZ_QUESTIONS): QuizQuestion[] {
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const copy = [...pool];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy.slice(0, Math.min(count, copy.length));
}

export function makeQuizAttempt(answers: number[], date: string, id: string, questions: QuizQuestion[] = QUIZ_QUESTIONS): QuizAttempt {
  const weakTopics: Topic[] = [];
  let score = 0;
  questions.forEach((question, index) => {
    if (answers[index] === question.correct) score += 1;
    else if (!weakTopics.includes(question.topic)) weakTopics.push(question.topic);
  });
  return { id, date, score, total: questions.length, weakTopics };
}

export function daysUntil(date: IsoDate, today: IsoDate = todayIso()): number {
  return daysBetween(today, date);
}
