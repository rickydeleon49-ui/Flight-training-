/**
 * Saving the parts of a split, shared by both split dialogs (M2 lineage).
 *
 * The desktop splitter has already written the part files and recorded a
 * receipt. Saving either commits every part with its lineage or nothing.
 * If the save is not acknowledged, the split is read back by its operation
 * id first — a save can land even when its answer never arrives — and only
 * a split that really did not land is cancelled, which removes exactly the
 * files that split wrote.
 */
import type { Repositories } from "@/data/repositories";
import type { SplitBatchSaveResult, SplitPartPresentation, SplitSourceReceipt } from "@/domain/types";

export type SplitSaveOutcome =
  | { saved: true; ids: string[] }
  | { saved: false; cleanupFailed: boolean };

export async function saveSplitParts(
  mutate: <T>(work: (repos: Repositories) => Promise<T>) => Promise<T | null>,
  repositories: Repositories | null,
  refresh: () => Promise<void>,
  receipt: SplitSourceReceipt,
  presentation: SplitPartPresentation[],
): Promise<SplitSaveOutcome> {
  const saved: SplitBatchSaveResult | null = await mutate((repos) =>
    repos.documents.saveSplitBatch(receipt, presentation),
  );
  if (saved) return { saved: true, ids: saved.parts.map((part) => part.id) };
  if (!repositories) return { saved: false, cleanupFailed: true };

  try {
    const landed = await repositories.documents.reconcileSplitBatch(receipt.operationId);
    if (landed.reconciled) {
      await refresh().catch(() => undefined);
      return { saved: true, ids: landed.parts.map((part) => part.id) };
    }
  } catch {
    // Could not read it back; cancelling below is still safe, because a
    // saved split is never touched by a cancel.
  }
  try {
    const cancelled = await repositories.documents.cancelSplitBatch(receipt.operationId);
    if (cancelled.status === "committed") {
      await refresh().catch(() => undefined);
      return { saved: true, ids: receipt.core.plan.map((part) => part.id) };
    }
    return { saved: false, cleanupFailed: false };
  } catch {
    return { saved: false, cleanupFailed: true };
  }
}

/** Explain omitted source pages without overwhelming the completion dialog. */
export function skippedPagesMessage(pages: readonly number[]): string | null {
  if (pages.length === 0) return null;
  if (pages.length === 1) {
    return `Page ${pages[0]} was left out because it's too large by itself (likely a big picture). It's still in your original PDF.`;
  }
  const shown = pages.slice(0, 5);
  const list = pages.length > 5
    ? `${shown.join(", ")} and ${pages.length - 5} more`
    : `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}`;
  return `Pages ${list} were left out because they're too large by themselves (likely big pictures). They're still in your original PDF.`;
}
