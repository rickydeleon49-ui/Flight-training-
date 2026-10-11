/**
 * Skills and feedback evidence (M3): operation and publication ownership for
 * one evidence list (a skill page, or a debrief's "Skill evidence" card), its
 * revision history and the observation form. The controller is
 * framework-free; `useSkillEvidence` is its React adapter. Not loaded through
 * AppDataContext: the list is read on demand and re-read when `dataRevision`
 * advances (a debrief deleted elsewhere, an action completed).
 *
 * The rules are docs/M3_SKILLS_EVIDENCE_SCOPE_2026-10-10.md §8, carried over
 * from the accepted prototype (M3-R1–R10):
 *
 * Reads
 * - Each open(scope) and each first-page refresh starts a new read
 *   generation. A response is published only while its generation is
 *   current, so A -> B -> A never shows B's or the first A's late answer.
 * - A first-page generation change releases any older-page lock; the late
 *   older page is dropped.
 * - STALE_CURSOR (or a refused cursor) restarts the list from the newest page.
 * - Revision history has its own generation and pages to revision 1.
 *
 * Writes (one ownership record per form draft key)
 * - A record keeps the exact create request until it is resolved. A second
 *   submit of the same draft joins the request in flight or returns its
 *   settled result; it never allocates another operation. Acknowledgment
 *   alone does not reset a draft; only startNewDraft(key) does.
 * - A write's notice, error, saving lock and follow-up refresh belong to the
 *   list it was made for. A late answer for list A never clears B's lock,
 *   announces on B, or refreshes B.
 * - An uncertain outcome is resolved before anything new is sent: the same
 *   draft resends the exact request; a changed draft reads the earlier
 *   observation id (present = landed; ERASED = landed and erased, nothing is
 *   recreated; NOT_FOUND is not proof, so the exact request is replayed as a
 *   fence through the serialized writer).
 * - Outcomes are explicit (SaveOutcome); reviseSaved and startNewDraft are
 *   the only ways forward. Item actions (edit, link, addressed, erase,
 *   status, confidence) keep their exact request while the outcome is
 *   unknown, so "Try again" replays it.
 *
 * Confirmed erasure (M3-R10)
 * - When any answer says ERASED, that observation's loaded revisions, cursor
 *   and list entry are dropped at once, its pending history answers become
 *   obsolete, and the summary is re-read (reads only). Ids are never reused,
 *   so an erased id stays filtered for the controller's lifetime. A temporary
 *   read failure is not erasure and keeps what is loaded.
 *
 * Lifecycle
 * - activate()/deactivate() are symmetric, for React effects (StrictMode runs
 *   setup, cleanup, setup on one instance).
 */
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";

import type {
  EvidenceItem,
  EvidencePage,
  EvidencePageInput,
  ObservationHistoryInput,
  ObservationHistoryPage,
  ObservationRevision,
  SkillAttribution,
  SkillEvidenceAction,
  SkillEvidenceOutcome,
  SkillSourceField,
  SkillSummary,
} from "@/domain/types";
import { canonicalJson } from "@/logic/cardIdentity";
import { refusalText } from "@/logic/skillEvidence";

import { useAppData } from "./AppDataContext";

export interface EvidenceClient {
  page(input: EvidencePageInput): Promise<EvidencePage>;
  summary(skillId: string): Promise<SkillSummary | null>;
  act(action: SkillEvidenceAction): Promise<SkillEvidenceOutcome>;
  history(input: ObservationHistoryInput): Promise<ObservationHistoryPage>;
}

/** What one list shows: one skill's evidence, or one debrief's. */
export type EvidenceScope = { kind: "skill"; skillId: string } | { kind: "journal"; journalId: string };

export const scopeKey = (scope: EvidenceScope) => (scope.kind === "skill" ? `skill:${scope.skillId}` : `journal:${scope.journalId}`);

export interface ObservationDraft {
  skillId: string;
  journalId: string;
  sourceField: SkillSourceField;
  wording: string;
  observedOn: string;
  attribution: SkillAttribution;
  instructorName: string;
}

/** What one submission did. Only "saved" means the submitted draft is stored. */
export type SaveOutcome =
  /** The submitted draft, exactly as submitted, is stored. */
  | { kind: "saved"; observationId: string; revision: number }
  /** An earlier submission of this form is stored; the submitted (different) draft was not sent. */
  | { kind: "earlier_saved"; observationId: string; revision: number; justNow: boolean }
  /** Still unknown whether the earlier request landed. The draft is kept; trying again resolves it first. */
  | { kind: "unknown"; code: string; message: string }
  /** The earlier save landed and was erased afterwards; nothing was recreated. */
  | { kind: "erased" }
  /** Definitively refused: nothing was written by this attempt. */
  | { kind: "refused"; code: string; message: string };

/** What one item action did. */
export type ActionOutcome =
  | { kind: "earlier_done"; message: string; outcome: SkillEvidenceOutcome }
  | { kind: "done"; outcome: SkillEvidenceOutcome }
  | { kind: "unknown"; message: string }
  | { kind: "refused"; code: string; message: string };

export interface HistoryViewState {
  observationId: string;
  status: "loading" | "ready" | "error";
  /** The reader confirmed this observation was erased: nothing of it is kept. */
  erased: boolean;
  items: ObservationRevision[];
  currentRevision: number | null;
  nextCursor: string | null;
  loadingMore: boolean;
  error: string | null;
}

export interface EvidenceViewState {
  scope: string | null;
  status: "idle" | "loading" | "ready" | "error";
  items: EvidenceItem[];
  nextCursor: string | null;
  loadingMore: boolean;
  /** The skill's summary on a skill page; null on a debrief's list. */
  summary: SkillSummary | null;
  readError: string | null;
  /** A write for THIS list is in flight. */
  saving: boolean;
  notice: null | "saved" | "saved_stale" | "already_saved" | "earlier_saved_now";
  /** "restarted": the list changed while paging, so it was reloaded from the newest. */
  listNotice: null | "restarted";
  writeError: { code: string; message: string } | null;
  history: HistoryViewState | null;
}

const INITIAL: EvidenceViewState = {
  scope: null, status: "idle", items: [], nextCursor: null, loadingMore: false, summary: null,
  readError: null, saving: false, notice: null, listNotice: null, writeError: null, history: null,
};

type CreateRequest = Extract<SkillEvidenceAction, { action: "create_observation" }>;
type EditRequest = Extract<SkillEvidenceAction, { action: "edit_observation" }>;

/** The editable content of an acknowledged observation, as this form last stored it. */
export interface SavedContent {
  skillId: string;
  journalId: string;
  sourceField: SkillSourceField;
  wording: string;
  observedOn: string;
  attribution: SkillAttribution;
  instructorName: string;
}

const contentOf = (request: CreateRequest | EditRequest, previous?: SavedContent): SavedContent => ({
  skillId: request.action === "create_observation" ? request.skillId : previous!.skillId,
  journalId: request.action === "create_observation" ? request.journalId : previous!.journalId,
  sourceField: request.action === "create_observation" ? request.sourceField : previous!.sourceField,
  wording: request.wording, observedOn: request.observedOn, attribution: request.attribution, instructorName: request.instructorName,
});

interface DraftRecord {
  scope: string;
  lifetime: number;
  observationId: string;
  saved: { fingerprint: string; revision: number; content: SavedContent } | null;
  pending: { request: CreateRequest | EditRequest; fingerprint: string } | null;
  blocked: null | "erased" | "conflict";
  flight: Promise<SaveOutcome> | null;
  flightFingerprint: string | null;
}

interface ActionRecord {
  scope: string;
  lifetime: number;
  request: SkillEvidenceAction;
  fingerprint: string;
  flight: Promise<ActionOutcome> | null;
}

/** Refusals that prove the request wrote nothing. Anything else is an unknown outcome. */
const DEFINITIVE = new Set([
  "INVALID_ARGUMENT", "LIMIT_EXCEEDED", "NOT_FOUND", "SOURCE_MISSING", "SKILL_RETIRED", "BUILTIN_READ_ONLY",
  "DUPLICATE_LABEL", "STALE_REVISION", "OPERATION_CONFLICT", "ERASED",
]);

const codeOf = (error: unknown) => (error as { code?: string } | null)?.code ?? "STORAGE_FAILURE";
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const READ_FAILED = "We couldn't load this right now. Your saved observations are safe.";
const ERASED_MESSAGE = "Your earlier save went through but was erased afterwards, so it wasn't saved again. Your wording is still here.";
const CONFLICT_MESSAGE = "This save clashed with an earlier one, so nothing was saved. Your wording is still here; save it as a new observation.";
const UNCONFIRMED = "We couldn't confirm that save. Your wording is still here; try again and we'll check what happened first.";
const ERASED_HISTORY = "This observation was erased.";

/** The observation an action is about, if any. */
const observationOf = (action: SkillEvidenceAction): string | null => ("observationId" in action ? action.observationId : null);

export function createEvidenceController(
  client: EvidenceClient,
  options: { newId: () => string; pageSize?: number; historyPageSize?: number },
) {
  let state = INITIAL;
  let current: EvidenceScope | null = null;
  let generation = 0;
  let historyGeneration = 0;
  let active = true;
  let lifetime = 0;
  const listeners = new Set<() => void>();
  const drafts = new Map<string, DraftRecord>();
  const actions = new Map<string, ActionRecord>();
  /** Observations confirmed erased. Ids are never reused, so they stay filtered. */
  const erased = new Set<string>();
  const visible = (items: EvidenceItem[]) => (erased.size === 0 ? items : items.filter((item) => !erased.has(item.id)));

  const publish = (next: Partial<EvidenceViewState>) => {
    if (!active) return;
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };

  /** A write is in flight for this list (in this lifetime). */
  const savingFor = (scope: string | null) =>
    scope !== null &&
    ([...drafts.values()].some((d) => d.flight !== null && d.lifetime === lifetime && d.scope === scope) ||
      [...actions.values()].some((a) => a.flight !== null && a.lifetime === lifetime && a.scope === scope));
  /** The record's list is the one on screen, in this lifetime. */
  const owns = (record: { scope: string; lifetime: number }) => active && record.lifetime === lifetime && state.scope === record.scope;

  const pageInput = (scope: EvidenceScope, cursor?: string): EvidencePageInput => ({
    ...(scope.kind === "skill" ? { skillId: scope.skillId } : { journalId: scope.journalId }),
    ...(cursor ? { cursor } : {}),
    limit: options.pageSize,
  });

  async function readFirstPage(scope: EvidenceScope, mine: number): Promise<void> {
    try {
      const [page, summary] = await Promise.all([
        client.page(pageInput(scope)),
        scope.kind === "skill" ? client.summary(scope.skillId) : Promise.resolve(null),
      ]);
      if (mine !== generation) return;
      publish({ status: "ready", items: visible(page.items), nextCursor: page.nextCursor, summary, readError: null });
    } catch (error) {
      if (mine !== generation) return;
      publish({ status: "error", readError: READ_FAILED });
      throw error;
    }
  }

  /** A new first-page generation: older pages become obsolete and their lock is released. */
  function newFirstPageGeneration(): number {
    generation += 1;
    publish({ loadingMore: false });
    return generation;
  }

  /** Refresh after a write this list owns. Read-only; never resends. */
  async function refreshAfterWrite(record: { scope: string; lifetime: number }): Promise<void> {
    if (!owns(record) || !current) return;
    const mine = newFirstPageGeneration();
    try {
      await readFirstPage(current, mine);
    } catch {
      if (mine === generation && owns(record)) publish({ status: "ready", readError: null, notice: "saved_stale" });
    }
  }

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
      if (!DEFINITIVE.has(code)) return { kind: "unknown", code, message: UNCONFIRMED };
      record.pending = null;
      if (code === "ERASED") {
        record.blocked = "erased";
        return { kind: "erased" };
      }
      if (code === "OPERATION_CONFLICT") {
        record.blocked = "conflict";
        return { kind: "refused", code, message: CONFLICT_MESSAGE };
      }
      return { kind: "refused", code, message: refusalText(code, messageOf(error)) };
    }
    const result = outcome.result as { action?: string; observationId?: string; revision?: unknown };
    if (
      result.action !== pending.request.action || result.observationId !== record.observationId ||
      typeof result.revision !== "number" || !Number.isSafeInteger(result.revision) || result.revision < 1
    ) {
      // An answer that does not describe this request is not an acknowledgment.
      return { kind: "unknown", code: "STORAGE_FAILURE", message: UNCONFIRMED };
    }
    record.saved = { fingerprint: pending.fingerprint, revision: result.revision, content: contentOf(pending.request, record.saved?.content) };
    record.pending = null;
    return { kind: "stored", revision: result.revision, replayed: outcome.status === "replayed" };
  }

  /**
   * Resolve an unknown earlier request before deciding about a changed draft.
   * Only a positive read decides without writing; absence is fenced by
   * replaying the exact earlier request.
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
        // The observation id was minted for this request and is never reused, so its presence means this create landed.
        record.saved = { fingerprint: pending.fingerprint, revision: 1, content: contentOf(pending.request, record.saved?.content) };
        record.pending = null;
        return { kind: "earlier_saved", observationId: record.observationId, revision: 1, justNow: false };
      }
    }
    const sent = await send(record);
    if (sent.kind === "stored") return { kind: "earlier_saved", observationId: record.observationId, revision: sent.revision, justNow: !sent.replayed };
    if (sent.kind === "refused") {
      return { kind: "refused", code: sent.code, message: `Your earlier save didn't go through (${sent.message}) Your new wording is still here; save again to send it.` };
    }
    return sent;
  }

  const erasedView = (observationId: string): HistoryViewState => ({
    observationId, status: "error", erased: true, items: [], currentRevision: null, nextCursor: null, loadingMore: false, error: ERASED_HISTORY,
  });

  /**
   * The store confirmed this observation is erased: forget everything loaded
   * about it and re-read the summary. Reads only; never resends a write.
   */
  function evictErased(observationId: string): void {
    erased.add(observationId);
    if (!active) return;
    const showingIt = state.history?.observationId === observationId;
    if (showingIt) historyGeneration += 1;
    const wasListed = state.items.some((item) => item.id === observationId);
    publish({ items: visible(state.items), history: showingIt ? erasedView(observationId) : state.history });
    const scope = current;
    if (!scope || scope.kind !== "skill" || !wasListed) return;
    const mine = generation;
    client.summary(scope.skillId).then(
      (summary) => {
        if (mine === generation && current === scope) publish({ summary });
      },
      () => undefined, // a failed summary re-read leaves the last one; the list is already correct
    );
  }

  async function settle(record: DraftRecord, outcome: SaveOutcome): Promise<SaveOutcome> {
    if (outcome.kind === "erased" && record.lifetime === lifetime) evictErased(record.observationId);
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

  function fly(record: DraftRecord, fingerprint: string, work: () => Promise<SaveOutcome>): Promise<SaveOutcome> {
    const flight = (async () => {
      if (owns(record)) publish({ saving: true, writeError: null, notice: null });
      const outcome = await work();
      return settle(record, outcome);
    })().finally(() => {
      record.flight = null;
      record.flightFingerprint = null;
      if (active && record.lifetime === lifetime) publish({ saving: savingFor(state.scope) });
    });
    record.flight = flight;
    record.flightFingerprint = fingerprint;
    return flight;
  }

  function newRecord(draftKey: string, draft: ObservationDraft, fingerprint: string): DraftRecord {
    const observationId = options.newId();
    const record: DraftRecord = {
      scope: state.scope ?? "", lifetime, observationId, saved: null, blocked: null, flight: null, flightFingerprint: null,
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

    /** Show one list. Earlier requests become obsolete; another list's notices do not carry over. */
    async open(scope: EvidenceScope): Promise<void> {
      const mine = ++generation;
      historyGeneration += 1;
      current = scope;
      const key = scopeKey(scope);
      publish({ ...INITIAL, scope: key, status: "loading", saving: savingFor(key) });
      await readFirstPage(scope, mine).catch(() => undefined);
    },

    /** Next page; ignored while one is loading or when there is none. A stale cursor restarts from the newest. */
    async loadMore(): Promise<void> {
      if (state.loadingMore || !state.nextCursor || !current) return;
      const mine = generation;
      const scope = current;
      const cursor = state.nextCursor;
      publish({ loadingMore: true });
      try {
        const page = await client.page(pageInput(scope, cursor));
        if (mine !== generation) return;
        publish({ items: visible([...state.items, ...page.items]), nextCursor: page.nextCursor, loadingMore: false });
      } catch (error) {
        if (mine !== generation) return;
        const code = codeOf(error);
        if (code === "STALE_CURSOR" || code === "INVALID_ARGUMENT") {
          const restart = newFirstPageGeneration();
          publish({ listNotice: "restarted" });
          await readFirstPage(scope, restart).catch(() => undefined);
          return;
        }
        publish({ loadingMore: false, readError: READ_FAILED });
      }
    },

    /** Reads again. Never resends a write. */
    async retryRead(): Promise<void> {
      if (!current) return;
      const mine = newFirstPageGeneration();
      publish({ status: "loading", readError: null, listNotice: null });
      try {
        await readFirstPage(current, mine);
        if (mine === generation && state.notice === "saved_stale") publish({ notice: "saved" });
      } catch {
        // state already says error
      }
    },

    /** Quietly re-read the first page (something changed elsewhere). Read-only; keeps loaded content on failure. */
    async reload(): Promise<void> {
      if (!current || state.status === "idle") return;
      const mine = newFirstPageGeneration();
      await readFirstPage(current, mine).catch(() => undefined);
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

    /** Boolean view: true only when the submitted draft, exactly as submitted, is stored. */
    async submitObservation(draftKey: string, draft: ObservationDraft): Promise<boolean> {
      return (await api.saveObservation(draftKey, draft)).kind === "saved";
    },

    /** Explicitly replace the saved observation's content with this draft (an edit at the saved revision). */
    reviseSaved(draftKey: string, draft: ObservationDraft): Promise<SaveOutcome> {
      const record = drafts.get(draftKey);
      if (!record || record.lifetime !== lifetime || record.blocked || record.flight || (!record.saved && !record.pending)) {
        return Promise.resolve({ kind: "refused", code: "INVALID_ARGUMENT", message: "There is no saved observation to update." });
      }
      const fingerprint = canonicalJson(draft);
      if (record.pending && record.pending.fingerprint !== fingerprint) return api.saveObservation(draftKey, draft);
      if (!record.pending) {
        const saved = record.saved!.content;
        if (saved.skillId !== draft.skillId || saved.journalId !== draft.journalId || saved.sourceField !== draft.sourceField) {
          return Promise.resolve({ kind: "refused", code: "INVALID_ARGUMENT", message: "The skill and debrief source of a saved observation stay fixed. Save these changes as a new observation." });
        }
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

    /** Explicitly start a fresh observation under this key. */
    startNewDraft(draftKey: string): boolean {
      const record = drafts.get(draftKey);
      if (record?.flight) return false;
      if (record?.pending) return false; // an unknown request must be resolved first
      drafts.delete(draftKey);
      return true;
    },

    /** What this draft key last stored (acknowledged), for an accurate "not saved yet" message. */
    savedContent(draftKey: string): SavedContent | null {
      const record = drafts.get(draftKey);
      return record && record.lifetime === lifetime && record.saved ? { ...record.saved.content } : null;
    },

    /** The ids a draft would send now (for tests and diagnostics). */
    draftIdentity(draftKey: string) {
      const d = drafts.get(draftKey);
      if (!d) return null;
      return { operationId: d.pending?.request.operationId ?? null, observationId: d.observationId };
    },

    /**
     * Run one item action (edit, link, unlink, addressed, erase, status,
     * confidence) under `key`. While its outcome is unknown the exact request
     * is kept, so trying again with the same intent replays it; a different
     * intent waits for nothing and starts a new request only after a
     * definitive answer. `build` mints a request with a fresh operation id.
     */
    runAction(key: string, intent: unknown, build: (operationId: string) => SkillEvidenceAction): Promise<ActionOutcome> {
      const fingerprint = canonicalJson(intent);
      let record = actions.get(key);
      if (record && record.lifetime !== lifetime && !record.flight) {
        actions.delete(key);
        record = undefined;
      }
      const changed = record !== undefined && record.fingerprint !== fingerprint;
      const forCurrentIntent = (outcome: ActionOutcome): ActionOutcome =>
        changed && outcome.kind === "done"
          ? { kind: "earlier_done", outcome: outcome.outcome, message: "Your earlier change was saved. These new changes have not been sent; review them and save again." }
          : outcome;
      if (record?.flight) return record.flight.then(forCurrentIntent);
      if (!record) {
        record = { scope: state.scope ?? "", lifetime, request: build(options.newId()), fingerprint, flight: null };
        actions.set(key, record);
      }
      const mine = record;
      const flight = (async (): Promise<ActionOutcome> => {
        if (owns(mine)) publish({ saving: true, writeError: null, notice: null });
        let outcome: ActionOutcome;
        try {
          const done = await client.act(mine.request);
          if (actions.get(key) === mine) actions.delete(key);
          outcome = { kind: "done", outcome: done };
        } catch (error) {
          const code = codeOf(error);
          if (DEFINITIVE.has(code)) {
            if (actions.get(key) === mine) actions.delete(key);
            const observationId = observationOf(mine.request);
            if (code === "ERASED" && observationId && mine.lifetime === lifetime) evictErased(observationId);
            outcome = { kind: "refused", code, message: refusalText(code, messageOf(error)) };
          } else {
            outcome = { kind: "unknown", message: refusalText(code) };
          }
        }
        if (owns(mine)) {
          if (outcome.kind === "done") {
            const erasedNow = mine.request.action === "erase_observation" ? observationOf(mine.request) : null;
            if (erasedNow) evictErased(erasedNow);
            publish({ notice: "saved", writeError: null });
            await refreshAfterWrite(mine);
          } else {
            publish({ notice: null, writeError: { code: outcome.kind === "refused" ? outcome.code : "STORAGE_FAILURE", message: outcome.message } });
            // Something it named is gone: re-read (reads only) so the list stops showing it.
            if (outcome.kind === "refused" && outcome.code === "NOT_FOUND" && current) {
              const reread = newFirstPageGeneration();
              await readFirstPage(current, reread).catch(() => undefined);
            }
          }
        }
        return outcome;
      })().finally(() => {
        mine.flight = null;
        if (active && mine.lifetime === lifetime) publish({ saving: savingFor(state.scope) });
      });
      mine.flight = flight;
      return flight.then(forCurrentIntent);
    },

    /** Open one observation's revision history (newest first). */
    async openHistory(observationId: string): Promise<void> {
      const mine = ++historyGeneration;
      if (erased.has(observationId)) {
        publish({ history: erasedView(observationId) });
        return;
      }
      publish({ history: { observationId, status: "loading", erased: false, items: [], currentRevision: null, nextCursor: null, loadingMore: false, error: null } });
      try {
        const page = await client.history({ observationId, limit: options.historyPageSize });
        if (mine !== historyGeneration || erased.has(observationId)) return;
        publish({ history: { observationId, status: "ready", erased: false, items: page.items, currentRevision: page.currentRevision, nextCursor: page.nextCursor, loadingMore: false, error: null } });
      } catch (error) {
        if (mine !== historyGeneration) return;
        if (codeOf(error) === "ERASED") {
          evictErased(observationId);
          return;
        }
        publish({ history: { observationId, status: "error", erased: false, items: [], currentRevision: null, nextCursor: null, loadingMore: false, error: "We couldn't load its earlier versions right now." } });
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
        if (mine !== historyGeneration || !state.history || erased.has(view.observationId)) return;
        publish({ history: { ...state.history, items: [...state.history.items, ...page.items], nextCursor: page.nextCursor, loadingMore: false, error: null } });
      } catch (error) {
        if (mine !== historyGeneration || !state.history) return;
        if (codeOf(error) === "ERASED") {
          evictErased(view.observationId);
          return;
        }
        // A temporary failure is not erasure: keep the loaded versions and cursor for retry.
        publish({ history: { ...state.history, loadingMore: false, error: "We couldn't load older versions right now." } });
      }
    },

    closeHistory() {
      historyGeneration += 1;
      publish({ history: null });
    },

    clearNotices() {
      publish({ notice: null, writeError: null, listNotice: null });
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

const newId = () => crypto.randomUUID();

/**
 * One evidence list for a screen. The controller lives as long as its client;
 * the lifecycle effect is declared before the load effect, so a StrictMode
 * replay restores publication before loading. Re-reads (read-only) when
 * `dataRevision` advances.
 */
export function useSkillEvidence(scope: EvidenceScope | null, client?: EvidenceClient | null) {
  const { repositories, dataRevision } = useAppData();
  const resolved = client ?? repositories?.skillEvidence ?? null;
  const controller = useMemo(() => (resolved ? createEvidenceController(resolved, { newId, pageSize: 20, historyPageSize: 20 }) : null), [resolved]);
  const empty = useMemo(() => createEvidenceController(NO_CLIENT, { newId }), []);
  const live = controller ?? empty;
  const state = useSyncExternalStore(live.subscribe, live.getState);
  const key = scope ? scopeKey(scope) : null;

  useEffect(() => {
    live.activate();
    return () => live.deactivate();
  }, [live]);
  useEffect(() => {
    if (scope && controller) void controller.open(scope);
    // The key stands for the scope's content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller, key]);
  const seenRevision = useRef(dataRevision);
  useEffect(() => {
    if (seenRevision.current === dataRevision) return;
    seenRevision.current = dataRevision;
    void controller?.reload();
  }, [controller, dataRevision]);

  // The route changes during render; the load effect runs afterwards. Never
  // expose the previous route's summary, actions or evidence in that interval.
  const shown = state.scope === key ? state : { ...INITIAL, scope: key, status: key ? "loading" as const : "idle" as const };
  return { state: shown, controller: live, available: controller !== null };
}

const NO_CLIENT: EvidenceClient = {
  page: () => Promise.reject(new Error("Skill evidence isn't available.")),
  summary: () => Promise.reject(new Error("Skill evidence isn't available.")),
  act: () => Promise.reject(Object.assign(new Error("Skill evidence isn't available."), { code: "INVALID_ARGUMENT" })),
  history: () => Promise.reject(new Error("Skill evidence isn't available.")),
};
