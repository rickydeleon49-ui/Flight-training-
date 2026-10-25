/**
 * Hiding what is about to be deleted.
 *
 * Delete is deferred rather than undone: confirming hides the record and
 * schedules the real removal a few seconds later, so "Undo" only has to
 * cancel a timer. Nothing has to be reconstructed from a copy, which is the
 * part of an undo feature that quietly loses attachments and child rows.
 *
 * The trade is that quitting inside the undo window leaves the record in
 * place. That errs toward keeping her data, which is the right direction.
 */
import type { AppData } from "@/state/AppDataContext";
import type { Id } from "@/domain/types";

/** The same list back when nothing was pending, so React sees no change. */
function keep<T extends { id: Id }>(list: T[], pending: ReadonlySet<Id>): T[] {
  const kept = list.filter((record) => !pending.has(record.id));
  return kept.length === list.length ? list : kept;
}

/**
 * A copy of `data` with every pending record removed, so the interface looks
 * exactly as it will once the deletion goes through.
 */
export function hidePending(data: AppData, pending: ReadonlySet<Id>): AppData {
  if (pending.size === 0) return data;

  // The toolkit's own lists live one level down.
  const toolkit = {
    ...data.toolkit,
    readinessItems: keep(data.toolkit.readinessItems, pending),
    credentials: keep(data.toolkit.credentials, pending),
    safetyChecks: keep(data.toolkit.safetyChecks, pending),
  };

  return {
    ...data,
    milestones: keep(data.milestones, pending),
    goals: keep(data.goals, pending),
    checklistItems: keep(data.checklistItems, pending),
    actions: keep(data.actions, pending),
    materials: keep(data.materials, pending),
    events: keep(data.events, pending),
    prepItems: keep(data.prepItems, pending),
    journalEntries: keep(data.journalEntries, pending),
    questions: keep(data.questions, pending),
    notes: keep(data.notes, pending),
    transactions: keep(data.transactions, pending),
    fundGoals: keep(data.fundGoals, pending),
    flightSchools: keep(data.flightSchools, pending),
    // A study aid belongs to its material and is keyed by it.
    aiStudySets: data.aiStudySets.filter((set) => !pending.has(set.sourceMaterialId)),
    toolkit,
  };
}
