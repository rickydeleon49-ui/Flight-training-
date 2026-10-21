/**
 * Next Action logic.
 *
 * The dashboard derives every one of its lists from this module, so there is
 * exactly one definition of "overdue", "due today" and "on the plan".
 */
import { describeRelativeDate, todayIso } from "@/lib/dates";
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
 * What belongs on Today's Flight Plan: open work due today, plus undated
 * work. Overdue items are deliberately excluded — they belong to Needs
 * Attention, where they get their own reschedule and complete controls, so
 * nothing appears twice on the same screen.
 */
export const planActions = (actions: NextAction[], today: IsoDate = todayIso()): NextAction[] =>
  actions.filter(
    (action) => isOpen(action) && (action.dueDate === null || action.dueDate === today),
  );

/**
 * Work finished today.
 *
 * These stay on Today's Plan rather than vanishing the moment they are
 * ticked, so what she has already done today is visible to her.
 */
export const completedToday = (
  actions: NextAction[],
  today: IsoDate = todayIso(),
): NextAction[] =>
  actions.filter(
    (action) =>
      action.status === "completed" &&
      action.completedAt !== null &&
      todayIso(new Date(action.completedAt)) === today,
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

/**
 * Group into the four plan sections, in the product's fixed order.
 * Within a section, outstanding work comes before anything already done.
 */
export function groupByCategory(actions: NextAction[]): ActionGroup[] {
  return ACTION_CATEGORY_ORDER.map((category) => ({
    category,
    actions: actions
      .filter((action) => action.category === category)
      .sort((a, b) => {
        if (isOpen(a) !== isOpen(b)) return isOpen(a) ? -1 : 1;
        return byDueDate(a, b);
      }),
  })).filter((group) => group.actions.length > 0);
}

export const actionsFor = (
  actions: NextAction[],
  relatedType: RelatedType,
  relatedId: Id,
): NextAction[] =>
  actions.filter(
    (action) =>
      (action.relatedType === relatedType && action.relatedId === relatedId) ||
      (relatedType === "material" && action.materialId === relatedId),
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

/**
 * How an action's timing should read.
 *
 * Completed work never reports its due date: once something is done, saying
 * it was "2 days overdue" is both untrue of its current state and exactly
 * the reproach the product refuses to make.
 */
export function actionTiming(
  action: NextAction,
  today: IsoDate = todayIso(),
): { text: string; tone: "overdue" | "due" | "plain" | "done" } | null {
  if (action.status === "completed") return { text: "Done", tone: "done" };
  if (action.status === "dismissed") return null;
  if (action.dueDate === null) return null;
  if (action.dueDate < today) {
    return { text: describeRelativeDate(action.dueDate, today), tone: "overdue" };
  }
  if (action.dueDate === today) return { text: "Today", tone: "due" };
  return { text: describeRelativeDate(action.dueDate, today), tone: "plain" };
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

/** Bound actions always open the next activity's evidence flow. */
export function homeworkActionTarget(actionId: string, homework: readonly import("@/domain/homework").HomeworkSnapshot[] = []): string | null {
  const assignment = homework.find(h => h.assignment.action_id === actionId);
  if (!assignment) return null;
  const next = assignment.activities.filter(a => !a.record.removed_at && a.record.state !== "completed").sort((a,b) => a.record.position - b.record.position)[0];
  return `/study/homework/${assignment.assignment.id}${next ? `?activity=${next.record.id}` : ""}`;
}
