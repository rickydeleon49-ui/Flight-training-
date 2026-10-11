/**
 * Candidate M3 view controller: owns request identity and publication for
 * the evidence history, the revision history and the observation form.
 * Framework-free, so the same rules hold for any screen that uses it (React
 * adapter in the UI specimen).
 *
 * Rules (scope document §8, "Operation and publication ownership"):
 *
 * Reads
 * - Each open(skillId) and each first-page refresh starts a new read
 *   generation. A response is published only while its generation is
 *   current, so A -> B -> A never shows B's or the first A's late answer.
 * - A first-page generation change releases any older-page ("Show older")
 *   lock; the late older page is dropped.
 * - A STALE_CURSOR (or refused cursor) restarts the list from the newest page
 *   instead of appending a page that could repeat or skip observations.
 * - Revision history has its own generation and pages to revision 1.
 *
 * Writes (one ownership record per form draft key)
 * - A record keeps the exact create request (operation and observation ids
 *   and content) until it is resolved. A second submit of the same content
 *   joins the request in flight, or returns its settled result: it never
 *   allocates another operation. Acknowledgment alone does not reset a draft;
 *   only startNewDraft(key) does.
 * - A write's notices, errors, saving lock and follow-up refresh belong to the
 *   skill it was made for. A late answer for skill A never clears B's lock,
 *   announces on B, or refreshes B.
 * - An uncertain outcome is resolved before anything new is sent:
 *   * same content: the exact original request is resent (the store replays);
 *   * changed content: the earlier observation id is read. Present means the
 *     earlier save landed; ERASED means it landed and was erased, so nothing is
 *     recreated; NOT_FOUND is NOT proof of failure (the write may still be
 *     queued), so the exact original request is replayed as a fence through
 *     the serialized writer before anything else is decided.
 * - Outcomes are explicit (SaveOutcome): this draft saved, an earlier draft
 *   saved (the new wording was NOT saved), still unknown, erased, refused.
 *   The form clears only what was acknowledged and keeps different wording.
 * - reviseSaved(key, draft) explicitly replaces the saved wording with the
 *   current draft (an edit); startNewDraft(key) explicitly starts a fresh
 *   observation.
 *
 * Lifecycle
 * - activate()/deactivate() are symmetric, for React effects (StrictMode runs
 *   setup, cleanup, setup on one instance). deactivate() makes every request
 *   and write callback from before it obsolete; activate() restores
 *   publication for new requests. dispose() is deactivate().
 *
 * DISPOSABLE PROTOTYPE.
 */
import { canonicalJson } from "@/logic/cardIdentity";

import type {
  Attribution,
  EvidenceItem,
  EvidencePage,
  EvidencePageInput,
  ObservationHistoryInput,
  ObservationHistoryPage,
  ObservationRevision,
  SkillEvidenceAction,
  SkillEvidenceOutcome,
  SkillSummary,
  SourceField,
} from "./types";

export interface EvidenceClient {
  page(input: EvidencePageInput): Promise<EvidencePage>;
  summary(skillId: string): Promise<SkillSummary | null>;
  act(action: SkillEvidenceAction): Promise<SkillEvidenceOutcome>;
  history(input: ObservationHistoryInput): Promise<ObservationHistoryPage>;
}

export interface ObservationDraft {
  skillId: string;
  journalId: string;
  sourceField: SourceField;
  wording: string;
  observedOn: string;
  attribution: Attribution;
  instructorName: string;
}

/** What one submission did. Only "saved" means the submitted wording is stored. */
export type SaveOutcome =
  /** The submitted draft, exactly as submitted, is stored. */
  | { kind: "saved"; observationId: string; revision: number }
  /**
   * An earlier submission of this form is stored; the submitted (different)
   * wording was not sent. `justNow` is true when resolving the earlier
   * request is what stored it.
   */
  | { kind: "earlier_saved"; observationId: string; revision: number; justNow: boolean }
  /** Still unknown whether the earlier request landed. The draft is kept; trying again resolves it first. */
  | { kind: "unknown"; code: string; message: string }
  /** The earlier save landed and was erased afterwards; nothing was recreated. */
  | { kind: "erased" }
  /** Definitively refused: nothing was written by this attempt. */
  | { kind: "refused"; code: string; message: string };

export interface HistoryViewState {
  observationId: string;
  status: "loading" | "ready" | "error";
  items: ObservationRevision[];
  currentRevision: number | null;
  nextCursor: string | null;
  loadingMore: boolean;
  error: string | null;
}

export interface EvidenceViewState {
  skillId: string | null;
  status: "idle" | "loading" | "ready" | "error";
  items: EvidenceItem[];
  nextCursor: string | null;
  loadingMore: boolean;
  summary: SkillSummary | null;
  readError: string | null;
  /** A write for THIS skill is in flight. */
  saving: boolean;
  /**
   * "saved_stale": the save landed, the refresh did not.
   * "already_saved": an earlier submission had already landed; the new wording was not saved.
   * "earlier_saved_now": resolving an earlier submission saved it just now; the new wording was not saved.
   */
  notice: null | "saved" | "saved_stale" | "already_saved" | "earlier_saved_now";
  /** "restarted": the list changed while paging, so it was reloaded from the newest. */
  listNotice: null | "restarted";
  writeError: { code: string; message: string } | null;
  history: HistoryViewState | null;
}

const INITIAL: EvidenceViewState = {
  skillId: null, status: "idle", items: [], nextCursor: null, loadingMore: false, summary: null,
  readError: null, saving: false, notice: null, listNotice: null, writeError: null, history: null,
};

type CreateRequest = Extract<SkillEvidenceAction, { action: "create_observation" }>;
type EditRequest = Extract<SkillEvidenceAction, { action: "edit_observation" }>;

interface DraftRecord {
  skillId: string;
  /** The controller lifetime the record was made in; deactivate() ends a lifetime. */
  lifetime: number;
  observationId: string;
  /** The content that is acknowledged as stored, and its revision. */
  saved: { fingerprint: string; revision: number } | null;
  /** A request whose outcome is not settled yet: in flight, or unknown after a failure. */
  pending: { request: CreateRequest | EditRequest; fingerprint: string } | null;
  /** Further sends are refused until startNewDraft(): the observation was erased, or its ids clash. */
  blocked: null | "erased" | "conflict";
  flight: Promise<SaveOutcome> | null;
  /** The fingerprint of the submission that started `flight`. */
  flightFingerprint: string | null;
}

/** Refusals that prove the request wrote nothing. Anything else is an unknown outcome. */
const DEFINITIVE = new Set([
  "INVALID_ARGUMENT", "LIMIT_EXCEEDED", "NOT_FOUND", "SOURCE_MISSING", "SKILL_RETIRED", "BUILTIN_READ_ONLY",
  "DUPLICATE_LABEL", "STALE_REVISION", "OPERATION_CONFLICT", "ERASED",
]);

const codeOf = (error: unknown) => (error as { code?: string } | null)?.code ?? "STORAGE_FAILURE";
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const ERASED_MESSAGE = "Your earlier save went through but was erased afterwards, so it wasn't saved again. Your wording is still here.";
const CONFLICT_MESSAGE = "This save clashed with an earlier one, so nothing was saved. Your wording is still here; save it as a new observation.";

export function createEvidenceController(client: EvidenceClient, options: { newId: () => string; pageSize?: number; historyPageSize?: number }) {
  let state = INITIAL;
  let generation = 0;
  let historyGeneration = 0;
  let active = true;
  let lifetime = 0;
  const listeners = new Set<() => void>();
  const drafts = new Map<string, DraftRecord>();

  const publish = (next: Partial<EvidenceViewState>) => {
    if (!active) return;
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };

  /** A write is in flight for this skill (in this lifetime). */
  const savingFor = (skillId: string | null) =>
    skillId !== null && [...drafts.values()].some((d) => d.flight !== null && d.lifetime === lifetime && d.skillId === skillId);
  /** The record's skill is the one on screen, in this lifetime. */
  const owns = (record: DraftRecord) => active && record.lifetime === lifetime && state.skillId === record.skillId;

  async function readFirstPage(skillId: string, mine: number): Promise<void> {
    try {
      const [page, summary] = await Promise.all([
        client.page({ skillId, limit: options.pageSize }),
        client.summary(skillId),
      ]);
      if (mine !== generation) return;
      publish({ status: "ready", items: page.items, nextCursor: page.nextCursor, summary, readError: null });
    } catch (error) {
      if (mine !== generation) return;
      publish({ status: "error", readError: messageOf(error) });
      throw error;
    }
  }

  /** A new first-page generation: older pages become obsolete and their lock is released. */
  function newFirstPageGeneration(): number {
    generation += 1;
    publish({ loadingMore: false });
    return generation;
  }

  /** Refresh after a write this skill owns. Read-only; never resends. */
  async function refreshAfterWrite(record: DraftRecord): Promise<void> {
    if (!owns(record)) return;
    const mine = newFirstPageGeneration();
    try {
      await readFirstPage(record.skillId, mine);
    } catch {
      if (mine === generation && owns(record)) publish({ status: "ready", readError: null, notice: "saved_stale" });
    }
  }

  /** Send one request of a record. Settles the record and returns what happened to THAT request. */
  async function send(record: DraftRecord): Promise<
    | { kind: "stored"; revision: number; replayed: boolean }
    | { kind: "erased" }
    | { kind: "refused"; code: string; message: string }
    | { kind: "unknown"; code: string; message: string }
  > {
    const pending = record.pending!;
    let outcome: SkillEvidenceOutcome;
    try {
      outcome = await client.act(pending.request);
    } catch (error) {
      const code = codeOf(error);
      if (!DEFINITIVE.has(code)) return { kind: "unknown", code, message: messageOf(error) };
      record.pending = null;
      if (code === "ERASED") {
        record.blocked = "erased";
        return { kind: "erased" };
      }
      if (code === "OPERATION_CONFLICT") {
        record.blocked = "conflict";
        return { kind: "refused", code, message: CONFLICT_MESSAGE };
      }
      return { kind: "refused", code, message: messageOf(error) };
    }
    const result = outcome.result as { action?: string; observationId?: string; revision?: unknown };
    if (
      result.action !== pending.request.action || result.observationId !== record.observationId ||
      typeof result.revision !== "number" || !Number.isSafeInteger(result.revision) || result.revision < 1
    ) {
      // An answer that does not describe this request is not an acknowledgment.
      return { kind: "unknown", code: "STORAGE_FAILURE", message: "The app couldn't confirm that save." };
    }
    record.saved = { fingerprint: pending.fingerprint, revision: result.revision };
    record.pending = null;
    return { kind: "stored", revision: result.revision, replayed: outcome.status === "replayed" };
  }

  /**
   * Resolve an unknown earlier request before deciding about different
   * content. Only a positive read decides without writing; absence is fenced
   * by replaying the exact earlier request.
   */
  async function resolveEarlier(record: DraftRecord): Promise<SaveOutcome> {
    const pending = record.pending!;
    if (pending.request.action === "create_observation") {
      let present: boolean | null = null;
      try {
        const page = await client.history({ observationId: record.observationId, limit: 1 });
        present = page.items.length > 0;
      } catch (error) {
        const code = codeOf(error);
        if (code === "ERASED") {
          record.pending = null;
          record.blocked = "erased";
          return { kind: "erased" };
        }
        if (code !== "NOT_FOUND") {
          return { kind: "unknown", code, message: "We couldn't check your earlier save. Your wording is still here; try again." };
        }
        present = false;
      }
      if (present) {
        // The observation id was minted for this request and can never be reused, so its presence means this create landed.
        record.saved = { fingerprint: pending.fingerprint, revision: 1 };
        record.pending = null;
        return { kind: "earlier_saved", observationId: record.observationId, revision: 1, justNow: false };
      }
    }
    // Not found (or an earlier edit): replay the exact earlier request as a fence.
    const sent = await send(record);
    if (sent.kind === "stored") return { kind: "earlier_saved", observationId: record.observationId, revision: sent.revision, justNow: !sent.replayed };
    if (sent.kind === "refused") {
      return { kind: "refused", code: sent.code, message: `Your earlier save didn't go through (${sent.message}) Your new wording is still here; save again to send it.` };
    }
    return sent;
  }

  /** Publish a settled outcome where it belongs, then refresh that skill's list if something is stored. */
  async function settle(record: DraftRecord, outcome: SaveOutcome): Promise<SaveOutcome> {
    if (record.saved === null && record.pending === null && record.blocked === null) {
      // Definitively refused before anything was stored: the next submission is a fresh request.
      for (const [key, value] of drafts) if (value === record) drafts.delete(key);
    }
    if (!owns(record)) return outcome;
    if (outcome.kind === "saved" || outcome.kind === "earlier_saved") {
      const notice = outcome.kind === "saved" ? "saved" : outcome.justNow ? "earlier_saved_now" : "already_saved";
      publish({ notice, writeError: null });
      await refreshAfterWrite(record);
    } else if (outcome.kind === "erased") {
      publish({ notice: null, writeError: { code: "ERASED", message: ERASED_MESSAGE } });
    } else {
      publish({ notice: null, writeError: { code: outcome.code, message: outcome.message } });
    }
    return outcome;
  }

  /** Run one write for a record with ownership of its flight and the saving lock. */
  function fly(record: DraftRecord, fingerprint: string, work: () => Promise<SaveOutcome>): Promise<SaveOutcome> {
    const flight = (async () => {
      if (owns(record)) publish({ saving: true, writeError: null, notice: null });
      const outcome = await work();
      return settle(record, outcome);
    })().finally(() => {
      record.flight = null;
      record.flightFingerprint = null;
      if (active && record.lifetime === lifetime) publish({ saving: savingFor(state.skillId) });
    });
    record.flight = flight;
    record.flightFingerprint = fingerprint;
    return flight;
  }

  function newRecord(draftKey: string, draft: ObservationDraft, fingerprint: string): DraftRecord {
    const observationId = options.newId();
    const record: DraftRecord = {
      skillId: draft.skillId, lifetime, observationId, saved: null, blocked: null, flight: null, flightFingerprint: null,
      pending: { fingerprint, request: { action: "create_observation", operationId: options.newId(), observationId, ...draft } },
    };
    drafts.set(draftKey, record);
    return record;
  }

  const api = {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    /** Show one skill's evidence. Earlier requests become obsolete; another skill's notices do not carry over. */
    async open(skillId: string): Promise<void> {
      const mine = ++generation;
      historyGeneration += 1;
      publish({ ...INITIAL, skillId, status: "loading", saving: savingFor(skillId) });
      await readFirstPage(skillId, mine).catch(() => undefined);
    },

    /** Next page; ignored while one is loading or when there is none. A stale cursor restarts from the newest. */
    async loadMore(): Promise<void> {
      if (state.loadingMore || !state.nextCursor || !state.skillId) return;
      const mine = generation;
      const skillId = state.skillId;
      const cursor = state.nextCursor;
      publish({ loadingMore: true });
      try {
        const page = await client.page({ skillId, cursor, limit: options.pageSize });
        if (mine !== generation) return;
        publish({ items: [...state.items, ...page.items], nextCursor: page.nextCursor, loadingMore: false });
      } catch (error) {
        if (mine !== generation) return;
        const code = codeOf(error);
        if (code === "STALE_CURSOR" || code === "INVALID_ARGUMENT") {
          const restart = newFirstPageGeneration();
          publish({ listNotice: "restarted" });
          await readFirstPage(skillId, restart).catch(() => undefined);
          return;
        }
        publish({ loadingMore: false, readError: messageOf(error) });
      }
    },

    /** Reads again. Never resends a write. */
    async retryRead(): Promise<void> {
      if (!state.skillId) return;
      const mine = newFirstPageGeneration();
      publish({ status: "loading", readError: null, listNotice: null });
      try {
        await readFirstPage(state.skillId, mine);
        if (mine === generation && state.notice === "saved_stale") publish({ notice: "saved" });
      } catch {
        // state already says error
      }
    },

    /** Save the draft under its key. See SaveOutcome; only "saved" means these words are stored. */
    saveObservation(draftKey: string, draft: ObservationDraft): Promise<SaveOutcome> {
      const fingerprint = canonicalJson(draft);
      let record = drafts.get(draftKey);
      if (record && record.lifetime !== lifetime) {
        drafts.delete(draftKey);
        record = undefined;
      }
      if (record?.flight) {
        // The same content joins the request in flight; different content waits for it to settle, then is decided.
        if (record.flightFingerprint === fingerprint) return record.flight;
        return record.flight.then(() => api.saveObservation(draftKey, draft));
      }
      if (!record) {
        const fresh = newRecord(draftKey, draft, fingerprint);
        return fly(fresh, fingerprint, async () => {
          const sent = await send(fresh);
          return sent.kind === "stored" ? { kind: "saved", observationId: fresh.observationId, revision: sent.revision } : sent;
        });
      }
      const existing = record;
      if (existing.blocked === "erased") return settle(existing, { kind: "erased" });
      if (existing.blocked === "conflict") return settle(existing, { kind: "refused", code: "OPERATION_CONFLICT", message: CONFLICT_MESSAGE });
      if (existing.pending) {
        if (existing.pending.fingerprint === fingerprint) {
          // Try again with the same content: resend the exact request; the store replays it if it landed.
          return fly(existing, fingerprint, async () => {
            const sent = await send(existing);
            return sent.kind === "stored" ? { kind: "saved", observationId: existing.observationId, revision: sent.revision } : sent;
          });
        }
        return fly(existing, fingerprint, () => resolveEarlier(existing));
      }
      const saved = existing.saved!;
      if (saved.fingerprint === fingerprint) return Promise.resolve({ kind: "saved", observationId: existing.observationId, revision: saved.revision });
      return settle(existing, { kind: "earlier_saved", observationId: existing.observationId, revision: saved.revision, justNow: false });
    },

    /**
     * Boolean view for older callers: true only when the submitted draft,
     * exactly as submitted, is stored. Screens use saveObservation's outcome.
     */
    async submitObservation(draftKey: string, draft: ObservationDraft): Promise<boolean> {
      return (await api.saveObservation(draftKey, draft)).kind === "saved";
    },

    /**
     * Explicitly replace the saved observation's wording with this draft (an
     * edit with the saved revision as its expected revision). Retries of the
     * same content reuse the same request.
     */
    reviseSaved(draftKey: string, draft: ObservationDraft): Promise<SaveOutcome> {
      const record = drafts.get(draftKey);
      if (!record || record.lifetime !== lifetime || record.blocked || record.flight || (!record.saved && !record.pending)) {
        return Promise.resolve({ kind: "refused", code: "INVALID_ARGUMENT", message: "There is no saved observation to update." });
      }
      const fingerprint = canonicalJson(draft);
      if (record.pending && record.pending.fingerprint !== fingerprint) return api.saveObservation(draftKey, draft);
      if (!record.pending) {
        if (record.saved!.fingerprint === fingerprint) return Promise.resolve({ kind: "saved", observationId: record.observationId, revision: record.saved!.revision });
        record.pending = {
          fingerprint,
          request: {
            action: "edit_observation", operationId: options.newId(), observationId: record.observationId, expectedRevision: record.saved!.revision,
            wording: draft.wording, observedOn: draft.observedOn, attribution: draft.attribution, instructorName: draft.instructorName,
          },
        };
      }
      return fly(record, fingerprint, async () => {
        const sent = await send(record);
        return sent.kind === "stored" ? { kind: "saved", observationId: record.observationId, revision: sent.revision } : sent;
      });
    },

    /** Explicitly start a fresh observation under this key (after a save, or to leave an erased one behind). */
    startNewDraft(draftKey: string): boolean {
      const record = drafts.get(draftKey);
      if (record?.flight) return false;
      if (record?.pending) return false; // an unknown request must be resolved first
      drafts.delete(draftKey);
      return true;
    },

    /** The ids a draft would send now (for tests and diagnostics). */
    draftIdentity(draftKey: string) {
      const d = drafts.get(draftKey);
      if (!d) return null;
      return { operationId: d.pending?.request.operationId ?? null, observationId: d.observationId };
    },

    /** Open one observation's revision history (newest first). */
    async openHistory(observationId: string): Promise<void> {
      const mine = ++historyGeneration;
      publish({ history: { observationId, status: "loading", items: [], currentRevision: null, nextCursor: null, loadingMore: false, error: null } });
      try {
        const page = await client.history({ observationId, limit: options.historyPageSize });
        if (mine !== historyGeneration) return;
        publish({ history: { observationId, status: "ready", items: page.items, currentRevision: page.currentRevision, nextCursor: page.nextCursor, loadingMore: false, error: null } });
      } catch (error) {
        if (mine !== historyGeneration) return;
        const message = codeOf(error) === "ERASED" ? "This observation was erased." : "We couldn't load its earlier versions right now.";
        publish({ history: { observationId, status: "error", items: [], currentRevision: null, nextCursor: null, loadingMore: false, error: message } });
      }
    },

    /** The next (older) revision page of the open history. */
    async loadOlderHistory(): Promise<void> {
      const view = state.history;
      if (!view || view.loadingMore || !view.nextCursor) return;
      const mine = historyGeneration;
      publish({ history: { ...view, loadingMore: true } });
      try {
        const page = await client.history({ observationId: view.observationId, cursor: view.nextCursor, limit: options.historyPageSize });
        if (mine !== historyGeneration || !state.history) return;
        publish({ history: { ...state.history, items: [...state.history.items, ...page.items], nextCursor: page.nextCursor, loadingMore: false } });
      } catch (error) {
        if (mine !== historyGeneration || !state.history) return;
        const message = codeOf(error) === "ERASED" ? "This observation was erased." : "We couldn't load older versions right now.";
        publish({ history: { ...state.history, loadingMore: false, error: message } });
      }
    },

    closeHistory() {
      historyGeneration += 1;
      publish({ history: null });
    },

    /** React effect setup: publication resumes for requests made from now on. */
    activate() {
      active = true;
    },

    /** React effect cleanup: every request and write callback from before now is obsolete. */
    deactivate() {
      active = false;
      lifetime += 1;
      generation += 1;
      historyGeneration += 1;
    },

    dispose() {
      api.deactivate();
    },
  };
  return api;
}

export type EvidenceController = ReturnType<typeof createEvidenceController>;
