/**
 * Training finance calculations.
 *
 * Every figure here is derived from transactions. Nothing is stored as a
 * running total, so the numbers cannot drift out of step with the ledger.
 * All arithmetic is in whole cents.
 */
import { startOfMonth, todayIso } from "@/lib/dates";
import type {
  Cents,
  ExpenseCategory,
  Id,
  IsoDate,
  JournalEntry,
  ScheduleEvent,
  Transaction,
} from "@/domain/types";

export interface FundSummary {
  totalContributed: Cents;
  totalSpent: Cents;
  /** What is actually available: contributions minus expenses. */
  balance: Cents;
}

export function fundSummary(transactions: Transaction[]): FundSummary {
  let totalContributed = 0;
  let totalSpent = 0;
  for (const transaction of transactions) {
    if (transaction.type === "contribution") totalContributed += transaction.amount;
    else totalSpent += transaction.amount;
  }
  return { totalContributed, totalSpent, balance: totalContributed - totalSpent };
}

/** Expenses dated within the month containing `anchor`. */
export function spentInMonth(transactions: Transaction[], anchor: IsoDate = todayIso()): Cents {
  const month = startOfMonth(anchor).slice(0, 7);
  return transactions
    .filter((t) => t.type === "expense" && t.date.slice(0, 7) === month)
    .reduce((total, t) => total + t.amount, 0);
}

export function spendingByCategory(transactions: Transaction[]): Map<ExpenseCategory, Cents> {
  const totals = new Map<ExpenseCategory, Cents>();
  for (const transaction of transactions) {
    if (transaction.type !== "expense") continue;
    totals.set(transaction.category, (totals.get(transaction.category) ?? 0) + transaction.amount);
  }
  return totals;
}

export interface UpcomingExpense {
  event: ScheduleEvent;
  amount: Cents;
}

/**
 * Estimated costs still ahead of us.
 *
 * A lesson drops off this list once its cost has actually been recorded, so
 * money is never counted as both upcoming and spent.
 */
export function upcomingExpenses(
  events: ScheduleEvent[],
  transactions: Transaction[],
  today: IsoDate = todayIso(),
): UpcomingExpense[] {
  const recordedEventIds = new Set(
    transactions.filter((t) => t.type === "expense" && t.eventId).map((t) => t.eventId as string),
  );

  return events
    .filter(
      (event) =>
        event.date >= today &&
        event.status === "scheduled" &&
        event.estimatedCost != null &&
        event.estimatedCost > 0 &&
        !recordedEventIds.has(event.id),
    )
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((event) => ({ event, amount: event.estimatedCost as Cents }));
}

export const totalUpcoming = (upcoming: UpcomingExpense[]): Cents =>
  upcoming.reduce((total, item) => total + item.amount, 0);

/**
 * Progress toward a savings target, 0–1.
 *
 * This is the one percentage the product allows, because it is real
 * arithmetic against an amount the user chose rather than a guess at how
 * much training is "done".
 */
export function fundGoalProgress(balance: Cents, target: Cents): number {
  if (target <= 0) return 0;
  return Math.max(0, Math.min(1, balance / target));
}

/** Categories whose expense on its own means a lesson or flight was paid for. */
const LESSON_CATEGORIES: ReadonlySet<ExpenseCategory> = new Set(["flight_lesson", "aircraft_rental"]);
/** Instruction counts toward a lesson's cost only when it is linked to that lesson. */
const LINKED_LESSON_CATEGORIES: ReadonlySet<ExpenseCategory> = new Set([
  "flight_lesson",
  "aircraft_rental",
  "instructor",
]);

/** One paid lesson: every lesson expense linked to the same event, or one unlinked expense. */
export interface LessonCost {
  /** The linked lesson, or null for an expense recorded without one. */
  eventId: Id | null;
  cost: Cents;
  transactionIds: Id[];
}

export interface CostPerFlightHour {
  /** Whole cents per hour, rounded. */
  perHour: Cents;
  /** Lessons that have both a cost and logged flight time: the only ones counted. */
  lessonsCounted: number;
  hours: number;
  cost: Cents;
}

/** A lesson with a recorded lesson total and separate lesson expenses, which may count money twice. */
export interface PossibleDoubleCount {
  eventId: Id;
  transactionIds: Id[];
  cost: Cents;
}

export interface TrainingCostSummary {
  lessons: LessonCost[];
  /** Average cost per paid lesson, or null without lesson expenses. */
  averageLesson: Cents | null;
  /**
   * Lesson cost divided by flight time for the same lessons, or null when no
   * lesson has both. The denominator is never another period's hours.
   */
  perFlightHour: CostPerFlightHour | null;
  possibleDoubleCounts: PossibleDoubleCount[];
}

/**
 * What training is costing, per lesson.
 *
 * Expenses linked to the same lesson add up to one lesson, so a lesson paid
 * as instruction plus aircraft rental is not counted as two cheaper lessons.
 * An unlinked lesson or rental expense is one lesson on its own. Cost per
 * flight hour pairs each lesson's cost with the total time logged in journal
 * entries linked to that same lesson; lessons missing either side are left
 * out and the count of lessons used is reported. Nothing is hidden: a lesson
 * carrying both a recorded lesson total and separate lesson expenses is
 * reported, not dropped, because only she knows whether they overlap.
 */
export function trainingCostSummary(
  transactions: Transaction[],
  journalEntries: Pick<JournalEntry, "eventId" | "totalTime">[] = [],
): TrainingCostSummary {
  const linked = new Map<Id, Transaction[]>();
  const lessons: LessonCost[] = [];
  for (const t of transactions) {
    if (t.type !== "expense") continue;
    if (t.eventId) {
      if (!LINKED_LESSON_CATEGORIES.has(t.category)) continue;
      const group = linked.get(t.eventId) ?? [];
      group.push(t);
      linked.set(t.eventId, group);
    } else if (LESSON_CATEGORIES.has(t.category)) {
      lessons.push({ eventId: null, cost: t.amount, transactionIds: [t.id] });
    }
  }

  const possibleDoubleCounts: PossibleDoubleCount[] = [];
  for (const [eventId, group] of linked) {
    if (!group.some((t) => LESSON_CATEGORIES.has(t.category))) continue;
    const lesson: LessonCost = {
      eventId,
      cost: group.reduce((sum, t) => sum + t.amount, 0),
      transactionIds: group.map((t) => t.id),
    };
    lessons.push(lesson);
    if (group.some((t) => t.source === "lesson_cost") && group.length > 1) {
      possibleDoubleCounts.push({ eventId, transactionIds: lesson.transactionIds, cost: lesson.cost });
    }
  }

  const hoursByEvent = new Map<Id, number>();
  for (const entry of journalEntries) {
    const time = entry.totalTime;
    if (!entry.eventId || time == null || !Number.isFinite(time) || time <= 0) continue;
    hoursByEvent.set(entry.eventId, (hoursByEvent.get(entry.eventId) ?? 0) + time);
  }
  let pairedCost = 0;
  let pairedHours = 0;
  let lessonsCounted = 0;
  for (const lesson of lessons) {
    const hours = lesson.eventId ? hoursByEvent.get(lesson.eventId) : undefined;
    if (hours === undefined) continue;
    pairedCost += lesson.cost;
    pairedHours += hours;
    lessonsCounted += 1;
  }

  const total = lessons.reduce((sum, lesson) => sum + lesson.cost, 0);
  return {
    lessons,
    averageLesson: lessons.length === 0 ? null : Math.round(total / lessons.length),
    perFlightHour:
      lessonsCounted === 0
        ? null
        : {
            perHour: Math.round(pairedCost / pairedHours),
            lessonsCounted,
            hours: Math.round(pairedHours * 10) / 10,
            cost: pairedCost,
          },
    possibleDoubleCounts,
  };
}

export interface MonthSpending {
  /** 'YYYY-MM'. */
  month: string;
  /** Every expense dated in the month. */
  spent: Cents;
  /** The part of `spent` that paid for lessons, as counted by `trainingCostSummary`. */
  lessons: Cents;
}

/**
 * Recorded spending for the last `months` calendar months, oldest first,
 * ending with the month containing `today`. Months with nothing recorded are
 * listed as zero rather than skipped. Only expenses already recorded count:
 * scheduled estimates stay in `upcomingExpenses`, and expenses dated after
 * the current month are left out of the trend.
 */
export function monthlySpending(
  transactions: Transaction[],
  today: IsoDate = todayIso(),
  months = 6,
): MonthSpending[] {
  const [year, month] = today.split("-").map(Number) as [number, number];
  const keys: string[] = [];
  for (let back = months - 1; back >= 0; back--) {
    const index = year * 12 + (month - 1) - back;
    keys.push(`${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`);
  }
  const rows = new Map(keys.map((key) => [key, { month: key, spent: 0, lessons: 0 }]));
  const lessonIds = new Set(trainingCostSummary(transactions).lessons.flatMap((l) => l.transactionIds));
  for (const t of transactions) {
    if (t.type !== "expense") continue;
    const row = rows.get(t.date.slice(0, 7));
    if (!row) continue;
    row.spent += t.amount;
    if (lessonIds.has(t.id)) row.lessons += t.amount;
  }
  return keys.map((key) => rows.get(key)!);
}
