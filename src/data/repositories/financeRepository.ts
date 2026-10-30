import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/id";
import {
  EXPENSE_CATEGORY_LABELS,
  type Cents,
  type ExpenseCategory,
  type FundGoal,
  type Id,
  type IsoDate,
  type Transaction,
  type TransactionSource,
  type TransactionType,
} from "@/domain/types";
import { toBool, toEnum, toNullableText, toText, type SqlDatabase } from "../db";

interface Row {
  id: string; type: unknown; amount: unknown; date: unknown; category: unknown;
  description: unknown; notes: unknown; event_id: unknown; goal_id: unknown;
  source: unknown; created_at: unknown; updated_at: unknown;
}

const TYPES: Record<TransactionType, true> = { contribution: true, expense: true };
const SOURCES: Record<TransactionSource, true> = { manual: true, lesson_cost: true };

const map = (row: Row): Transaction => ({
  id: row.id,
  type: toEnum<TransactionType>(row.type, TYPES, "expense"),
  amount: Number(row.amount ?? 0),
  date: toText(row.date),
  category: toEnum<ExpenseCategory>(row.category, EXPENSE_CATEGORY_LABELS, "other"),
  description: toText(row.description),
  notes: toText(row.notes),
  eventId: toNullableText(row.event_id),
  goalId: toNullableText(row.goal_id),
  source: toEnum<TransactionSource>(row.source, SOURCES, "manual"),
  createdAt: toText(row.created_at),
  updatedAt: toText(row.updated_at),
});

interface FundGoalRow {
  id: string; title: unknown; target: unknown; active: unknown;
  created_at: unknown; updated_at: unknown;
}

const mapFundGoal = (row: FundGoalRow): FundGoal => ({
  id: row.id,
  title: toText(row.title),
  target: Number(row.target ?? 0),
  active: toBool(row.active),
  createdAt: toText(row.created_at),
  updatedAt: toText(row.updated_at),
});

export type NewTransaction = Partial<Omit<Transaction, "id" | "createdAt" | "updatedAt">> &
  Pick<Transaction, "type" | "amount" | "date">;

/** Raised when a lesson's cost has already been recorded. */
export class DuplicateLessonCostError extends Error {
  constructor(public readonly existing: Transaction) {
    super("This lesson's cost has already been recorded.");
    this.name = "DuplicateLessonCostError";
  }
}

export function financeRepository(db: SqlDatabase) {
  return {
    async list(): Promise<Transaction[]> {
      const rows = await db.select<Row>(
        "SELECT * FROM transactions ORDER BY date DESC, created_at DESC",
      );
      return rows.map(map);
    },

    async listFundGoals(): Promise<FundGoal[]> {
      const rows = await db.select<FundGoalRow>("SELECT * FROM fund_goals ORDER BY created_at");
      return rows.map(mapFundGoal);
    },

    async create(input: NewTransaction): Promise<Transaction> {
      const timestamp = nowIso();
      const transaction: Transaction = {
        id: newId(),
        type: input.type,
        amount: input.amount,
        date: input.date,
        category: input.category ?? "other",
        description: input.description ?? "",
        notes: input.notes ?? "",
        eventId: input.eventId ?? null,
        goalId: input.goalId ?? null,
        source: input.source ?? "manual",
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await db.execute(
        `INSERT INTO transactions (id, type, amount, date, category, description, notes,
           event_id, goal_id, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          transaction.id, transaction.type, transaction.amount, transaction.date,
          transaction.category, transaction.description, transaction.notes,
          transaction.eventId, transaction.goalId, transaction.source,
          transaction.createdAt, transaction.updatedAt,
        ],
      );
      return transaction;
    },

    /**
     * Turn a completed lesson's actual cost into an expense.
     *
     * A lesson may carry several manual expenses, but this convenience may
     * only ever produce one. The check here gives a clear message; a partial
     * unique index in the schema makes the duplicate impossible even if two
     * callers race.
     */
    async recordLessonCost(params: {
      eventId: Id;
      amount: Cents;
      date: IsoDate;
      description: string;
      category?: ExpenseCategory;
      goalId?: Id | null;
    }): Promise<Transaction> {
      // An expense is always a positive whole number of cents; a negative one
      // would quietly reduce what training has cost.
      if (!Number.isSafeInteger(params.amount) || params.amount <= 0) {
        throw new Error("A lesson cost must be more than zero.");
      }
      const existing = await this.findLessonCost(params.eventId);
      if (existing) throw new DuplicateLessonCostError(existing);

      return this.create({
        type: "expense",
        amount: params.amount,
        date: params.date,
        category: params.category ?? "flight_lesson",
        description: params.description,
        eventId: params.eventId,
        goalId: params.goalId ?? null,
        source: "lesson_cost",
      });
    },

    async findLessonCost(eventId: Id): Promise<Transaction | null> {
      const rows = await db.select<Row>(
        "SELECT * FROM transactions WHERE event_id = ? AND source = 'lesson_cost' LIMIT 1",
        [eventId],
      );
      const row = rows[0];
      return row ? map(row) : null;
    },

    async update(id: Id, changes: Partial<Transaction>): Promise<void> {
      const rows = await db.select<Row>("SELECT * FROM transactions WHERE id = ?", [id]);
      const existing = rows[0];
      if (!existing) throw new Error("That transaction no longer exists.");
      const next = { ...map(existing), ...changes, updatedAt: nowIso() };
      await db.execute(
        `UPDATE transactions SET type = ?, amount = ?, date = ?, category = ?,
                description = ?, notes = ?, event_id = ?, goal_id = ?, updated_at = ?
          WHERE id = ?`,
        [
          next.type, next.amount, next.date, next.category, next.description,
          next.notes, next.eventId, next.goalId, next.updatedAt, id,
        ],
      );
    },

    async remove(id: Id): Promise<void> {
      await db.execute("DELETE FROM transactions WHERE id = ?", [id]);
    },

    async saveFundGoal(input: { id?: Id; title: string; target: Cents }): Promise<FundGoal> {
      const timestamp = nowIso();
      if (input.id) {
        await db.execute(
          "UPDATE fund_goals SET title = ?, target = ?, updated_at = ? WHERE id = ?",
          [input.title, input.target, timestamp, input.id],
        );
        const rows = await db.select<FundGoalRow>("SELECT * FROM fund_goals WHERE id = ?", [input.id]);
        const row = rows[0];
        if (!row) throw new Error("That savings target no longer exists.");
        return mapFundGoal(row);
      }

      // Only one target is active at a time; retire any previous one atomically.
      const goal: FundGoal = {
        id: newId(),
        title: input.title,
        target: input.target,
        active: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      if (!db.createFundGoalAtomically) throw new Error("Atomic savings target saves require transaction support.");
      await db.createFundGoalAtomically(goal);
      return goal;
    },

    async removeFundGoal(id: Id): Promise<void> {
      await db.execute("DELETE FROM fund_goals WHERE id = ?", [id]);
    },
  };
}
