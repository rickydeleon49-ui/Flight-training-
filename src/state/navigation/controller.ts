/**
 * Opening a document at a page and saving that request (M4 Slice 1).
 *
 * The production port of the accepted prototype's opener controller, over the
 * real asynchronous boundary: the native (or browser) navigation operations,
 * the native file inspector and the native verified opener. Two kinds of
 * ordering are kept apart:
 *
 * - A local request epoch, increased synchronously when a new intent starts.
 *   It retires all older work in this controller before any new ownership
 *   read or reservation can fail (M4-R37): an older request never publishes
 *   and never sends its commit after that point.
 * - The durable generation, reserved by `begin` in one immediate transaction
 *   with exact read-back (M4-R33/R38). A newer request for the same material
 *   cancels the older generation inside that same reservation; for another
 *   material the older generation is cancelled separately (best effort, since
 *   a failure there must not block the new request).
 *
 * Native cancellation/commit ordering: a JavaScript predicate cannot cross
 * Tauri, so cancellation is a durable write. `cancel` and `commit` are both
 * immediate transactions on the same claim row, so SQLite serializes them:
 * if the cancel lands first the commit is refused as `cancelled`; if the
 * commit landed first it is a genuine earlier save and stays saved, and this
 * controller simply does not publish it. Suppressing the interface never
 * pretends to undo a write that already happened.
 *
 * A failed save after a successful open offers a save-only retry that resends
 * the same generation and never reopens the file. Pages whose numbering has no
 * trustworthy provenance are opened for guidance only and save nothing.
 *
 * Two kinds of request are kept apart (M4S1-R5). `request` is a fresh page
 * asked for now, resolved against whatever file is current. `openSaved` opens
 * a place saved earlier (a bookmark): it carries the content that place was
 * saved against and opens only that content. A replaced file is refused with
 * an explanation; the old coordinate is never re-aimed at the new file.
 *
 * Every external side effect is dispatched only while its request is still
 * current: the epoch is checked after each awaited step and before the next
 * one starts, guidance included (M4S1-R8). An open the operating system has
 * already been handed cannot be taken back; an obsolete one is never started.
 */
import type { InspectedNavigationIdentity, NavigationOperation, NavigationReadingState, NavigationResultByKind } from "@/domain/types";
import { NAVIGATION_ERROR_MESSAGES, NavigationError } from "@/data/navigationTransaction";
import { resolveDestination, type Destination, type LabelMap, type PageProvenance } from "@/logic/navigation";

export interface NavigationPorts {
  /** Native: hash and count the managed file and record that identity. */
  inspect(materialId: string): Promise<InspectedNavigationIdentity>;
  operation<K extends NavigationOperation["kind"]>(op: Extract<NavigationOperation, { kind: K }>): Promise<NavigationResultByKind[K]>;
  /** Native: hand the file to the default reader only if it is still this content. */
  open(materialId: string, expectedContentSha256: string): Promise<void>;
}

export interface OpenIntent {
  materialId: string;
  reference: number | string;
  provenance: PageProvenance;
  labelMap?: LabelMap | null;
  pageLabel?: string | null;
}

/** A place saved earlier, opened only on the content it was saved against. */
export interface SavedDestination {
  materialId: string;
  /** The content the place was saved on; null when that was never known. */
  contentSha256: string | null;
  physicalPage: number;
  pageLabel: string | null;
}

export type NavigationStatus =
  | { kind: "idle"; epoch: number }
  | { kind: "working"; epoch: number; materialId: string; step: "checking" | "opening" | "saving" }
  | { kind: "saved"; epoch: number; materialId: string; destination: Destination; readingState: NavigationReadingState }
  | { kind: "opened_unsaved"; epoch: number; materialId: string; destination: Destination; message: string; canRetry: boolean }
  | { kind: "guidance"; epoch: number; materialId: string; message: string }
  | { kind: "refused"; epoch: number; materialId: string; message: string }
  | { kind: "failed"; epoch: number; materialId: string; message: string; code: string };

type StatusBody = NavigationStatus extends infer S ? (S extends NavigationStatus ? Omit<S, "epoch"> : never) : never;

interface Ticket {
  epoch: number;
  materialId: string;
  generation: number | null;
  /** The older same-material generation this request supersedes in its reservation. */
  supersede: number | null;
  /** Committed, refused, or cancelled: nothing more may be sent for it. */
  settled: boolean;
  destination: Destination | null;
}

const REFUSAL_MESSAGES: Record<string, string> = {
  identity_changed: "The file changed after it was checked, so this page wasn't saved. Open it again to check the new version.",
  out_of_bounds: "That page isn't in this version of the file, so it wasn't saved.",
  identity_unknown: "This document's pages haven't been checked, so the page wasn't saved.",
  superseded: "A newer page request replaced this one, so it wasn't saved.",
  cancelled: "A newer page request replaced this one, so it wasn't saved.",
  replayed: "This page request was already saved.",
  unreserved: "This page request is no longer current, so it wasn't saved.",
};

export const SAVED_PLACE_MESSAGES = {
  changed:
    "This file has changed since you saved this place, so it wasn't opened there. The place is marked as possibly moved. Use Open at page to find it in the new version.",
  unknown: "This place was saved before its file was checked, so it can't be matched to this file and wasn't opened. Use Open at page to find it.",
} as const;

function messageOf(error: unknown): { code: string; message: string } {
  if (error instanceof NavigationError) return { code: error.code, message: error.message };
  return { code: "STORAGE_FAILURE", message: NAVIGATION_ERROR_MESSAGES.STORAGE_FAILURE };
}

export class NavigationController {
  private epoch = 0;
  private active: Ticket | null = null;
  private disposed = false;
  private current: NavigationStatus = { kind: "idle", epoch: 0 };
  private readonly listeners = new Set<() => void>();

  constructor(private readonly ports: NavigationPorts) {}

  status(): NavigationStatus {
    return this.current;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Open a material at a page and save it as the last requested page. Resolves
   * with the published status, or null when a newer intent retired this one.
   */
  async request(intent: OpenIntent): Promise<NavigationStatus | null> {
    return this.run(intent, undefined);
  }

  /**
   * Open a saved place on the content it was saved against. If the file is no
   * longer that content (or that was never known) it is refused and explained;
   * nothing is opened and the old page is not saved against the new file.
   */
  async openSaved(saved: SavedDestination): Promise<NavigationStatus | null> {
    const intent: OpenIntent = { materialId: saved.materialId, reference: saved.physicalPage, provenance: "physical_index", pageLabel: saved.pageLabel };
    return this.run(intent, saved.contentSha256);
  }

  /** `savedOn` is undefined for a fresh request, or the saved place's content. */
  private async run(intent: OpenIntent, savedOn: string | null | undefined): Promise<NavigationStatus | null> {
    const ticket = this.enter(intent.materialId);
    const { materialId } = intent;
    this.publish(ticket, { kind: "working", materialId, step: "checking" });

    let identity: InspectedNavigationIdentity;
    try {
      identity = await this.ports.inspect(materialId);
    } catch (error) {
      return this.finish(ticket, { kind: "failed", materialId, ...messageOf(error) });
    }
    if (!this.isCurrent(ticket)) return null;
    // The inspection has recorded the current identity and reconciled saved
    // places against it, so a changed file's places already read as drifted.
    if (savedOn === null) return this.finish(ticket, { kind: "refused", materialId, message: SAVED_PLACE_MESSAGES.unknown });
    if (savedOn !== undefined && savedOn !== identity.contentSha256) {
      return this.finish(ticket, { kind: "refused", materialId, message: SAVED_PLACE_MESSAGES.changed });
    }

    const record = resolveDestination({
      materialId,
      reference: intent.reference,
      identity,
      provenance: intent.provenance,
      labelMap: intent.labelMap ?? null,
      ...(intent.pageLabel !== undefined ? { pageLabel: intent.pageLabel } : {}),
    });
    if (record.status !== "resolved") return this.finish(ticket, { kind: "refused", materialId, message: record.guidance });
    const destination = record.destination;
    ticket.destination = destination;

    try {
      ticket.generation = (await this.ports.operation({ kind: "begin", materialId, supersedeGeneration: ticket.supersede })).generation;
      ticket.supersede = null;
    } catch (error) {
      ticket.settled = true;
      return this.finish(ticket, { kind: "failed", materialId, ...messageOf(error) });
    }
    if (!this.isCurrent(ticket)) {
      this.cancelQuietly(ticket);
      return null;
    }

    this.publish(ticket, { kind: "working", materialId, step: "opening" });
    try {
      await this.ports.open(materialId, destination.contentSha256);
    } catch (error) {
      this.cancelQuietly(ticket);
      return this.finish(ticket, { kind: "failed", materialId, ...messageOf(error) });
    }
    if (!this.isCurrent(ticket)) {
      this.cancelQuietly(ticket);
      return null;
    }
    return this.save(ticket);
  }

  /** Resend the same generation's save, without reopening the file. */
  async retrySave(): Promise<NavigationStatus | null> {
    const ticket = this.active;
    const status = this.current;
    if (!ticket || !this.isCurrent(ticket) || ticket.settled || ticket.generation === null) return null;
    if (status.kind !== "opened_unsaved" || !status.canRetry || status.epoch !== ticket.epoch) return null;
    return this.save(ticket);
  }

  /**
   * Open a document whose page reference has no trustworthy numbering. It is
   * opened as it is, with guidance, and no position is saved.
   */
  async openForGuidance(materialId: string, guidance: string, saved?: SavedDestination): Promise<NavigationStatus | null> {
    const ticket = this.enter(materialId);
    ticket.settled = true;
    this.publish(ticket, { kind: "working", materialId, step: "checking" });
    let identity: InspectedNavigationIdentity;
    try {
      identity = await this.ports.inspect(materialId);
    } catch (error) {
      return this.finish(ticket, { kind: "failed", materialId, ...messageOf(error) });
    }
    if (saved && (saved.contentSha256 !== identity.contentSha256 || saved.physicalPage < 1 || saved.physicalPage > identity.totalPages)) return this.finish(ticket, {kind:"refused", materialId, message:"Position unverified"});
    // Retired while the file was being checked: the open is never dispatched.
    if (!this.isCurrent(ticket)) return null;
    this.publish(ticket, { kind: "working", materialId, step: "opening" });
    try {
      await this.ports.open(materialId, identity.contentSha256);
    } catch (error) {
      return this.finish(ticket, { kind: "failed", materialId, ...messageOf(error) });
    }
    return this.finish(ticket, { kind: "guidance", materialId, message: guidance });
  }

  /** Retire the current request (navigating away, closing the panel). */
  abort(): void {
    if (this.disposed) return;
    const ticket = this.enter(null);
    this.publish(ticket, { kind: "idle" });
  }

  /** Abort and stop publishing for good (unmount). */
  dispose(): void {
    if (this.disposed) return;
    this.enter(null);
    this.disposed = true;
    this.listeners.clear();
  }

  /* ---------------------------------------------------------------- */

  /** A new local epoch; older work is retired before anything can fail. */
  private enter(materialId: string | null): Ticket {
    const previous = this.active;
    const ticket: Ticket = {
      epoch: ++this.epoch,
      materialId: materialId ?? "",
      generation: null,
      supersede: null,
      settled: materialId === null,
      destination: null,
    };
    this.active = materialId === null ? null : ticket;
    const pending = previous ? this.takeOutstanding(previous) : null;
    if (pending) {
      // Same material: cancelled durably inside the new reservation. Another
      // material (or none): cancelled on its own now.
      if (materialId !== null && pending.materialId === materialId) ticket.supersede = pending.generation;
      else this.sendCancel(pending.materialId, pending.generation);
    }
    return ticket;
  }

  /** The durable generation a retired request still holds, if any. */
  private takeOutstanding(ticket: Ticket): { materialId: string; generation: number } | null {
    if (!ticket.settled && ticket.generation !== null) {
      ticket.settled = true;
      return { materialId: ticket.materialId, generation: ticket.generation };
    }
    if (ticket.generation === null && ticket.supersede !== null) {
      const generation = ticket.supersede;
      ticket.supersede = null;
      return { materialId: ticket.materialId, generation };
    }
    return null;
  }

  private isCurrent(ticket: Ticket): boolean {
    return !this.disposed && ticket.epoch === this.epoch;
  }

  private async save(ticket: Ticket): Promise<NavigationStatus | null> {
    const destination = ticket.destination!;
    const { materialId } = ticket;
    this.publish(ticket, { kind: "working", materialId, step: "saving" });
    let verdict: NavigationResultByKind["commit"];
    try {
      verdict = await this.ports.operation({
        kind: "commit",
        materialId,
        generation: ticket.generation!,
        contentSha256: destination.contentSha256,
        physicalPage: destination.physicalPage,
        pageLabel: destination.pageLabel,
      });
    } catch (error) {
      if (!this.isCurrent(ticket)) return null;
      const { message } = messageOf(error);
      return this.finish(ticket, { kind: "opened_unsaved", materialId, destination, message: `Opened, but the page wasn't saved. ${message}`, canRetry: true });
    }
    ticket.settled = true;
    // A save that landed after a newer intent began is kept, but not shown.
    if (!this.isCurrent(ticket)) return null;
    if (verdict.committed && verdict.readingState) {
      return this.finish(ticket, { kind: "saved", materialId, destination, readingState: verdict.readingState });
    }
    const message = REFUSAL_MESSAGES[verdict.reason ?? ""] ?? NAVIGATION_ERROR_MESSAGES.STORAGE_FAILURE;
    return this.finish(ticket, { kind: "opened_unsaved", materialId, destination, message, canRetry: false });
  }

  private cancelQuietly(ticket: Ticket): void {
    if (ticket.settled || ticket.generation === null) return;
    ticket.settled = true;
    this.sendCancel(ticket.materialId, ticket.generation);
  }

  private sendCancel(materialId: string, generation: number): void {
    // Best effort: a refused or failed cancel cannot make an older request
    // current again, because it can no longer send its commit.
    void this.ports.operation({ kind: "cancel", materialId, generation }).catch(() => undefined);
  }

  private finish(ticket: Ticket, body: StatusBody): NavigationStatus | null {
    if (!this.isCurrent(ticket)) return null;
    // Ended before its own reservation: the older generation it was going to
    // supersede is cancelled on its own instead.
    const pending = ticket.generation === null ? this.takeOutstanding(ticket) : null;
    if (pending) this.sendCancel(pending.materialId, pending.generation);
    return this.publish(ticket, body);
  }

  private publish(ticket: Ticket, body: StatusBody): NavigationStatus | null {
    if (!this.isCurrent(ticket)) return null;
    this.current = { ...body, epoch: ticket.epoch } as NavigationStatus;
    for (const listener of this.listeners) listener();
    return this.current;
  }
}
