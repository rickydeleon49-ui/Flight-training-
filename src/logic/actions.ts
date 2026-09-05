/**
 * Next Action logic.
 *
 * The dashboard derives every one of its lists from this module, so there is
 * exactly one definition of "overdue", "due today" and "on the plan".
 */
import { todayIso } from "@/lib/dates";
import {
  ACTION_CATEGORY_ORDER,
  type ActionCategory,
  type Id,
  type IsoDate,
  type NextAction,
  type RelatedType,
} from "@/domain/types";

export const isOpen = (action: NextAction): boolean => action.status === "open";

/** Past its due date and still open. Undated actions are never overdue. */
export const isOverdue = (action: NextAction, today: IsoDate = todayIso()): boolean =>
  isOpen(action) && action.dueDate !== null && action.dueDate < today;

export const isDueToday = (action: NextAction, today: IsoDate = todayIso()): boolean =>
  isOpen(action) && action.dueDate === today;

export const overdueActions = (actions: NextAction[], today: IsoDate = todayIso()): NextAction[] =>
  actions.filter((action) => isOverdue(action, today)).sort(byDueDate);

/**
 * What belongs on Today's Flight Plan: open work that is due today, already
 * overdue, or carries no date at all. Work due later stays out of the way.
 */
export const planActions = (actions: NextAction[], today: IsoDate = todayIso()): NextAction[] =>
  actions.filter(
    (action) => isOpen(action) && (action.dueDate === null || action.dueDate <= today),
  );

const PRIORITY_WEIGHT = { next_up: 0, important: 1, later: 2 } as const;

/** Dated work first, then by priority — undated work sinks to the bottom. */
export function byDueDate(a: NextAction, b: NextAction): number {
  if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
  if (a.dueDate && !b.dueDate) return -1;
  if (!a.dueDate && b.dueDate) return 1;
  return PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority];
}

export interface ActionGroup {
  category: ActionCategory;
  actions: NextAction[];
}

/** Group into the four plan sections, in the product's fixed order. */
export function groupByCategory(actions: NextAction[]): ActionGroup[] {
  return ACTION_CATEGORY_ORDER.map((category) => ({
    category,
    actions: actions.filter((action) => action.category === category).sort(byDueDate),
  })).filter((group) => group.actions.length > 0);
}

export const actionsFor = (
  actions: NextAction[],
  relatedType: RelatedType,
  relatedId: Id,
): NextAction[] =>
  actions.filter(
    (action) => action.relatedType === relatedType && action.relatedId === relatedId,
  );

/**
 * The single most useful thing to do next.
 *
 * Overdue work first, then today's non-negotiables, then whatever is next up.
 * Returns null when there is genuinely nothing waiting rather than inventing
 * busywork.
 */
export function mostImportantAction(
  actions: NextAction[],
  today: IsoDate = todayIso(),
): NextAction | null {
  const open = actions.filter(isOpen);
  const overdue = open.filter((action) => isOverdue(action, today)).sort(byDueDate);
  if (overdue[0]) return overdue[0];

  const plan = planActions(open, today);
  const nonNegotiable = plan
    .filter((action) => action.category === "non_negotiable")
    .sort(byDueDate);
  if (nonNegotiable[0]) return nonNegotiable[0];

  return plan.sort(byDueDate)[0] ?? null;
}

/** Field changes that complete an action. Kept pure so it is easy to test. */
export const completionChanges = (now: string): Partial<NextAction> => ({
  status: "completed",
  completedAt: now,
});

/** Field changes that reopen an action, clearing the completion stamp. */
export const reopenChanges = (): Partial<NextAction> => ({
  status: "open",
  completedAt: null,
});

/**
 * Field changes that move an action to a new day.
 *
 * Rescheduling is a first-class, blameless outcome: nothing is lost and no
 * progress is reset, the work simply gets a realistic new date.
 */
export const rescheduleChanges = (date: IsoDate): Partial<NextAction> => ({
  dueDate: date,
  status: "open",
  completedAt: null,
});
