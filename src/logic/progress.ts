/**
 * Evidence-based progress.
 *
 * The product forbids invented completion percentages, so nothing here
 * returns one. Progress is reported as the things that actually happened:
 * lessons flown, materials reviewed, checklist items ticked, entries written.
 */
import type {
  ChecklistItem,
  Goal,
  GoalStatus,
  JournalEntry,
  Milestone,
  ScheduleEvent,
  StudyMaterial,
} from "@/domain/types";

export interface GoalEvidence {
  lessonsRecorded: number;
  journalEntries: number;
  materialsReviewed: number;
  materialsTotal: number;
  checklistDone: number;
  checklistTotal: number;
  confidence: number | null;
  lastPracticed: string | null;
}

export function goalEvidence(
  goal: Goal,
  sources: {
    journalEntries: JournalEntry[];
    materials: StudyMaterial[];
    checklistItems: ChecklistItem[];
    events: ScheduleEvent[];
  },
): GoalEvidence {
  const entries = sources.journalEntries.filter((entry) => entry.goalId === goal.id);
  const materials = sources.materials.filter((material) => material.goalId === goal.id);
  const checklist = sources.checklistItems.filter((item) => item.goalId === goal.id);
  const lessons = sources.events.filter(
    (event) =>
      event.goalId === goal.id &&
      event.eventType === "flight_lesson" &&
      event.status === "completed",
  );

  // The most recent evidence of practice, from either lessons or the journal.
  const dates = [...lessons.map((l) => l.date), ...entries.map((e) => e.date)].sort();

  return {
    lessonsRecorded: lessons.length,
    journalEntries: entries.length,
    materialsReviewed: materials.filter(
      (m) => m.reviewStatus === "confident" || m.lastReviewedAt !== null,
    ).length,
    materialsTotal: materials.length,
    checklistDone: checklist.filter((item) => item.done).length,
    checklistTotal: checklist.length,
    confidence: goal.confidence,
    lastPracticed: dates[dates.length - 1] ?? null,
  };
}

/** True when a goal has anything at all to show. */
export const hasEvidence = (evidence: GoalEvidence): boolean =>
  evidence.lessonsRecorded > 0 ||
  evidence.journalEntries > 0 ||
  evidence.materialsTotal > 0 ||
  evidence.checklistTotal > 0 ||
  evidence.confidence !== null;

export interface MilestoneProgress {
  /** Counts by goal status — the honest version of a progress bar. */
  counts: Record<GoalStatus, number>;
  total: number;
  completed: Goal[];
  workingOn: Goal[];
}

export function milestoneProgress(milestone: Milestone, goals: Goal[]): MilestoneProgress {
  const scoped = goals.filter((goal) => goal.milestoneId === milestone.id);
  const counts: Record<GoalStatus, number> = {
    not_started: 0, working_on: 0, comfortable: 0, completed: 0, paused: 0,
  };
  for (const goal of scoped) counts[goal.status] += 1;

  return {
    counts,
    total: scoped.length,
    completed: scoped.filter((g) => g.status === "completed" || g.status === "comfortable"),
    workingOn: scoped.filter((g) => g.status === "working_on"),
  };
}

/** The milestone the user is currently pursuing. */
export function currentMilestone(
  milestones: Milestone[],
  currentMilestoneId: string | null,
): Milestone | null {
  if (currentMilestoneId) {
    const chosen = milestones.find((m) => m.id === currentMilestoneId);
    if (chosen) return chosen;
  }
  // Fall back to the first one in progress, then the first unfinished one.
  return (
    milestones.find((m) => m.status === "in_progress") ??
    milestones.find((m) => m.status !== "completed") ??
    null
  );
}

/** The material most worth opening next: Next Up first, then what is in progress. */
export function studyFocus(materials: StudyMaterial[]): StudyMaterial | null {
  const candidates = materials.filter((m) => m.reviewStatus !== "reference_only");
  const weight = (material: StudyMaterial): number => {
    let score = 0;
    if (material.priority === "next_up") score -= 100;
    else if (material.priority === "important") score -= 50;
    if (material.reviewStatus === "studying") score -= 20;
    else if (material.reviewStatus === "needs_review") score -= 10;
    return score;
  };
  return [...candidates].sort((a, b) => weight(a) - weight(b))[0] ?? null;
}
