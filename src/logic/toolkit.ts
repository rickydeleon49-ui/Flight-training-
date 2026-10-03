import type {
  CredentialRecord,
  IsoDate,
  NextAction,
  Profile,
  QuizAttempt,
  ReadinessItem,
  ScheduleEvent,
  ToolkitState,
  Topic,
  Transaction,
} from "@/domain/types";
import { addDays, daysBetween, todayIso } from "@/lib/dates";
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

export const DEFAULT_TOOLKIT_STATE: ToolkitState = {
  version: 1,
  readinessItems: DEFAULT_READINESS_ITEMS,
  credentials: [],
  safetyChecks: [],
  quizAttempts: [],
  remindersEnabled: true,
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

  return copyToolkitData({
    ...DEFAULT_TOOLKIT_STATE,
    ...input,
    version: 1,
    readinessItems: [...mergedItems, ...customItems],
    credentials: Array.isArray(input.credentials) ? input.credentials : [],
    safetyChecks: Array.isArray(input.safetyChecks) ? input.safetyChecks : [],
    quizAttempts: Array.isArray(input.quizAttempts) ? input.quizAttempts : [],
    reminderLeadDays: Math.min(90, Math.max(0, Number(input.reminderLeadDays ?? 7))),
    estimatedHourlyCost: Math.max(0, Number(input.estimatedHourlyCost ?? 220_00)),
    additionalTrainingCosts: Math.max(0, Number(input.additionalTrainingCosts ?? 1_500_00)),
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

export function trainingCostForecast(
  totals: FlightLogTotals,
  transactions: Transaction[],
  state: ToolkitState,
) {
  const spent = transactions
    .filter((item) => item.type === "expense" && TRAINING_CATEGORIES.has(item.category))
    .reduce((sum, item) => sum + item.amount, 0);
  const observedHourly = totals.totalTime > 0 && spent > 0 ? Math.round(spent / totals.totalTime) : null;
  const hourly = observedHourly ?? state.estimatedHourlyCost;
  const remainingHours = Math.max(0, 40 - totals.totalTime);
  const estimatedRemaining = Math.round(remainingHours * hourly) + state.additionalTrainingCosts;
  return { spent, observedHourly, hourly, remainingHours, estimatedRemaining, projectedTotal: spent + estimatedRemaining };
}

export interface ReminderItem {
  id: string;
  title: string;
  detail: string;
  date: IsoDate;
  urgent: boolean;
}

export function buildReminders(input: {
  actions: NextAction[];
  events: ScheduleEvent[];
  credentials: CredentialRecord[];
  profile: Profile;
  today?: IsoDate;
  leadDays: number;
}): ReminderItem[] {
  const today = input.today ?? todayIso();
  const through = addDays(today, input.leadDays);
  const reminders: ReminderItem[] = [];
  for (const action of input.actions) {
    if (action.status !== "open" || !action.dueDate || action.dueDate > through) continue;
    reminders.push({ id: `action-${action.id}`, title: action.title, detail: action.dueDate < today ? "Action overdue" : "Action due", date: action.dueDate, urgent: action.dueDate < today });
  }
  for (const event of input.events) {
    if (event.status !== "scheduled" || event.date < today || event.date > through) continue;
    reminders.push({ id: `event-${event.id}`, title: event.title, detail: "Scheduled training", date: event.date, urgent: event.date === today });
  }
  const datedRecords = [
    ...input.credentials.filter((item) => item.expiresOn).map((item) => ({ id: `credential-${item.id}`, title: item.title, date: item.expiresOn! })),
    ...(input.profile.medicalExpiry ? [{ id: "profile-medical", title: "Medical certificate", date: input.profile.medicalExpiry }] : []),
  ];
  for (const item of datedRecords) {
    if (item.date > through) continue;
    reminders.push({ id: item.id, title: item.title, detail: item.date < today ? "Record may be expired" : "Expiration approaching", date: item.date, urgent: item.date <= today });
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
];

export function makeQuizAttempt(answers: number[], date: string, id: string): QuizAttempt {
  const weakTopics: Topic[] = [];
  let score = 0;
  QUIZ_QUESTIONS.forEach((question, index) => {
    if (answers[index] === question.correct) score += 1;
    else if (!weakTopics.includes(question.topic)) weakTopics.push(question.topic);
  });
  return { id, date, score, total: QUIZ_QUESTIONS.length, weakTopics };
}

export function daysUntil(date: IsoDate, today: IsoDate = todayIso()): number {
  return daysBetween(today, date);
}
