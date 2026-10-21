/**
 * The Flight Deck view model.
 *
 * Today's Flight Plan is assembled here rather than in the page component,
 * so what the dashboard shows is testable and there is one place that
 * decides what "most important next" means.
 */
import { daysBetween, todayIso } from "@/lib/dates";
import type {
  Goal,
  JournalEntry,
  Milestone,
  NextAction,
  PrepItem,
  Profile,
  Question,
  ScheduleEvent,
  StudyMaterial,
  Transaction,
  IsoDate,
  ChecklistItem,
  Note,
} from "@/domain/types";
import {
  completedToday,
  groupByCategory,
  mostImportantAction,
  overdueActions,
  planActions,
  type ActionGroup,
} from "./actions";
import { computeDailyPlan, type DailyPlanState } from "./dailyPlan";
import { encouragementMessage } from "./encouragement";
import {
  lessonPreparation,
  lessonsAwaitingDebrief,
  nextLesson,
  type PreparationState,
} from "./preparation";
import { currentMilestone, milestoneProgress, studyFocus, type MilestoneProgress } from "./progress";
import { type RecommendationSources } from "./recommendations";
import { upcomingExpenses } from "./finance";
import { upcomingKeyDates, type KeyDate } from "./keyDates";

export interface DashboardSources {
  profile: Profile;
  actions: NextAction[];
  events: ScheduleEvent[];
  prepItems: PrepItem[];
  materials: StudyMaterial[];
  milestones: Milestone[];
  goals: Goal[];
  checklistItems: ChecklistItem[];
  journalEntries: JournalEntry[];
  questions: Question[];
  transactions: Transaction[];
  today?: IsoDate;
  homework?: readonly import("@/domain/homework").HomeworkSnapshot[];
  notes?: Note[];
  dailyPlan?: DailyPlanState | null;
  hasRecommendations?: boolean;
}

export interface DashboardModel {
  today: IsoDate;
  greeting: string;
  subtitle: string;
  planGroups: ActionGroup[];
  /** Outstanding items on the plan. */
  planCount: number;
  /** Items already ticked off today, shown alongside them. */
  planDoneCount: number;
  hasRecommendations: boolean;
  nextFlight: {
    event: ScheduleEvent;
    preparation: PreparationState;
    materials: StudyMaterial[];
    daysAway: number;
  } | null;
  currentMilestone: {
    milestone: Milestone;
    progress: MilestoneProgress;
    nextAction: NextAction | null;
  } | null;
  studyFocus: {
    material: StudyMaterial;
    nextAction: NextAction | null;
  } | null;
  needsAttention: NextAction[];
  keyDates: KeyDate[];
  /** Her photo and why, shown only once she has written or added one. */
  personal: { photo: string | null; whyNote: string } | null;
  awaitingDebrief: ScheduleEvent[];
  unansweredBeforeLesson: Question[];
  topAction: NextAction | null;
  encouragement: string | null;
  upcomingCost: number | null;
  isEmpty: boolean;
}

/** Time-of-day greeting. Warm, and never more than a few words. */
export function greetingFor(name: string, now: Date = new Date()): string {
  const hour = now.getHours();
  const part = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const trimmed = name.trim();
  return trimmed ? `Good ${part}, ${trimmed}.` : `Good ${part}.`;
}

export function buildDashboard(sources: DashboardSources, now: Date = new Date()): DashboardModel {
  const today = sources.today ?? todayIso(now);

  const plan = planActions(sources.actions, today);
  const doneToday = completedToday(sources.actions, today);
  const overdue = overdueActions(sources.actions, today);
  const upcoming = nextLesson(sources.events, today);

  const preparation = upcoming
    ? lessonPreparation(upcoming, {
        prepItems: sources.prepItems,
        questions: sources.questions,
        homework: sources.homework,
      })
    : null;

  const milestone = currentMilestone(sources.milestones, sources.profile.currentMilestoneId);

  const focusMaterial = studyFocus(sources.materials);

  const journalEventIds = new Set(
    sources.journalEntries.map((entry) => entry.eventId).filter((id): id is string => id !== null),
  );

  // A week back, for "what did you actually finish" messaging.
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const completedThisWeek = sources.actions.filter(
    (action) => action.completedAt !== null && new Date(action.completedAt) >= weekAgo,
  ).length;

  const upcomingExpenseTotal = upcomingExpenses(sources.events, sources.transactions, today)
    .reduce((total, item) => total + item.amount, 0);

  const relatedAction = (type: NextAction["relatedType"], id: string): NextAction | null =>
    sources.actions.find(
      (action) => action.status === "open" && action.relatedType === type && action.relatedId === id,
    ) ?? null;

  const isEmpty =
    sources.actions.length === 0 &&
    sources.events.length === 0 &&
    sources.materials.length === 0 &&
    sources.goals.length === 0;

  const focusLabel = sources.profile.currentFocus || milestone?.title || "";

  const hasRecommendations =
    sources.hasRecommendations ??
    (() => {
      const recSources: RecommendationSources = {
        today,
        actions: sources.actions,
        homework: sources.homework,
        events: sources.events,
        prepItems: sources.prepItems,
        materials: sources.materials,
        questions: sources.questions,
        notes: sources.notes ?? [],
        journalEntries: sources.journalEntries,
      };
      const { result } = computeDailyPlan(recSources, sources.dailyPlan ?? null, { today });
      return result.suggested.length > 0;
    })();

  const allOverdueHomework =
    overdue.length > 0 &&
    overdue.every((action) =>
      sources.homework?.some(
        (h) => h.assignment.action_id === action.id && !h.assignment.archived,
      ),
    );

  return {
    today,
    greeting: greetingFor(sources.profile.pilotName, now),
    subtitle: [sources.profile.certificateGoal, focusLabel && `Current focus: ${focusLabel}`]
      .filter(Boolean)
      .join(" • "),
    planGroups: groupByCategory([...plan, ...doneToday]),
    planCount: plan.length,
    planDoneCount: doneToday.length,
    hasRecommendations,
    nextFlight:
      upcoming && preparation
        ? {
            event: upcoming,
            preparation,
            materials: sources.materials.filter((material) =>
              upcoming.materialIds.includes(material.id),
            ),
            daysAway: daysBetween(today, upcoming.date),
          }
        : null,
    currentMilestone: milestone
      ? {
          milestone,
          progress: milestoneProgress(milestone, sources.goals),
          nextAction: relatedAction("goal", milestoneProgress(milestone, sources.goals).workingOn[0]?.id ?? ""),
        }
      : null,
    studyFocus: focusMaterial
      ? { material: focusMaterial, nextAction: relatedAction("material", focusMaterial.id) }
      : null,
    needsAttention: overdue,
    keyDates: upcomingKeyDates(sources.profile, sources.milestones, today),
    // Nothing appears until she has actually put something there.
    personal:
      sources.profile.whyNote.trim() || sources.profile.photo
        ? { photo: sources.profile.photo, whyNote: sources.profile.whyNote.trim() }
        : null,
    awaitingDebrief: lessonsAwaitingDebrief(sources.events, journalEventIds, today),
    unansweredBeforeLesson: upcoming
      ? sources.questions.filter((q) => q.status === "to_ask" && (q.eventId === upcoming.id || q.eventId === null))
      : [],
    topAction: mostImportantAction(sources.actions, today),
    encouragement: encouragementMessage({
      today,
      nextLessonDate: upcoming?.date ?? null,
      nextLessonTitle: upcoming?.title ?? null,
      outstandingPrepCount: preparation?.outstanding.length ?? 0,
      overdueCount: overdue.length,
      allWaitingAreHomework: allOverdueHomework,
      completedThisWeek,
      openActionCount: sources.actions.filter((a) => a.status === "open").length,
      hasRecommendations,
      hasAnyData: !isEmpty,
    }),
    upcomingCost: upcomingExpenseTotal > 0 ? upcomingExpenseTotal : null,
    isEmpty,
  };
}
