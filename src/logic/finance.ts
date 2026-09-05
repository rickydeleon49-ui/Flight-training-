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
  IsoDate,
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

/** Average of expenses in lesson-related categories, or null without data. */
export function averageLessonCost(transactions: Transaction[]): Cents | null {
  const lessons = transactions.filter(
    (t) =>
      t.type === "expense" &&
      (t.category === "flight_lesson" || t.category === "aircraft_rental"),
  );
  if (lessons.length === 0) return null;
  const total = lessons.reduce((sum, t) => sum + t.amount, 0);
  return Math.round(total / lessons.length);
}

export const countPaidLessons = (transactions: Transaction[]): number =>
  transactions.filter((t) => t.type === "expense" && t.category === "flight_lesson").length;
