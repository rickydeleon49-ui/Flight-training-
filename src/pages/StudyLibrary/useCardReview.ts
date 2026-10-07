/**
 * Card reviews for the material on screen (M2-3 source slice C1).
 *
 * Small, deliberately separate from the practice controller:
 *
 * - Every read belongs to a request; only the newest request for this
 *   material may publish. A route change or unmount makes older reads and
 *   writes stale, so their late results change nothing.
 * - One write at a time per material, under a synchronous lock.
 * - A write whose outcome is unknown keeps its operation ID and exact payload,
 *   so Try again resends the same request and can never apply twice.
 * - Reset additionally offers read-only Check again, which resolves only
 *   through an authoritative receipt read; it never sends a second reset.
 * - After an acknowledged (or replayed) write, the refresh must succeed
 *   before anything that could conflict is allowed again. A write result is
 *   never used as the current generation or revision; only reads are.
 * - Read failures are consumed and shown as sanitized, retryable status.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type {
  CardFlagReason,
  CardItemAction,
  CardQueueEntry,
  CardRating,
  CardRecentReview,
  CardRecentReviewCursor,
  CardResetAction,
  CardReviewAction,
  CardReviewItemState,
  CardReviewResult,
  CardReviewSnapshot,
} from "@/domain/types";
import { CardReviewError } from "@/data/persistenceErrors";
import type { CardReviewRepository } from "@/data/repositories/cardReviewRepository";
import { describeWait, scheduleCard, type CardSchedule } from "@/logic/cardScheduler";
import { currentTimeZone, localDate, nextLocalMidnightUtc, shortLocalDay } from "@/logic/localDay";

/* ------------------------------------------------------------------ */
/* Pure helpers                                                        */
/* ------------------------------------------------------------------ */

export interface CardReviewSummary {
  total: number;
  newCount: number;
  dueNow: number;
  /** Again cards still waiting for their exact instant. */
  againLater: { count: number; nextAt: string | null };
  /** The earliest day-ladder due instant on or after the next local midnight. */
  nextDayAt: string | null;
  /** Every current card is paused or flagged. */
  allPaused: boolean;
}

const excluded = (state: CardReviewItemState | undefined) => Boolean(state && (state.suspended || state.flag !== null));

/** Counts for the summary line, from one authoritative snapshot. Mirrors the due SQL. */
export function summarizeCards(snapshot: CardReviewSnapshot, nowIso: string, boundaryIso: string): CardReviewSummary {
  const summary: CardReviewSummary = {
    total: 0,
    newCount: 0,
    dueNow: 0,
    againLater: { count: 0, nextAt: null },
    nextDayAt: null,
    allPaused: false,
  };
  if (snapshot.current.status !== "ok") return summary;
  let paused = 0;
  for (const item of snapshot.current.items) {
    summary.total += 1;
    const state = snapshot.states[item.itemId];
    if (excluded(state)) {
      paused += 1;
      continue;
    }
    if (!state || state.dueAt === null) {
      summary.newCount += 1;
    } else if (state.step < 0) {
      if (state.dueAt <= nowIso) summary.dueNow += 1;
      else {
        summary.againLater.count += 1;
        if (summary.againLater.nextAt === null || state.dueAt < summary.againLater.nextAt) summary.againLater.nextAt = state.dueAt;
      }
    } else if (state.dueAt < boundaryIso) {
      summary.dueNow += 1;
    } else if (summary.nextDayAt === null || state.dueAt < summary.nextDayAt) {
      summary.nextDayAt = state.dueAt;
    }
  }
  summary.allPaused = summary.total > 0 && paused === summary.total;
  return summary;
}

export interface ReviewSession {
  cards: CardQueueEntry[];
  position: number;
  completed: ReadonlySet<string>;
}

/** Session membership is fixed when it starts: at most 20 unique cards, at most 10 new. */
export function createReviewSession(cards: CardQueueEntry[]): ReviewSession {
  return { cards, position: 0, completed: new Set() };
}

/**
 * Advance only on an acknowledged result for the card being shown. A
 * replayed acknowledgement for a card already completed changes nothing.
 */
export function acknowledgeInSession(session: ReviewSession, itemId: string): ReviewSession {
  const shown = session.cards[session.position];
  if (!shown || shown.itemId !== itemId || session.completed.has(itemId)) return session;
  return { cards: session.cards, position: session.position + 1, completed: new Set([...session.completed, itemId]) };
}

function priorSchedule(state: CardReviewItemState | undefined): CardSchedule | null {
  if (!state || state.dueAt === null || state.lastReviewedAt === null) return null;
  return { schedulerVersion: "simple-v1", step: state.step, reps: state.reps, lapses: state.lapses, lastReviewedAt: state.lastReviewedAt, dueAt: state.dueAt };
}

/** The wait each rating would set right now, for the rating buttons. */
export function ratingWaits(state: CardReviewItemState | undefined, nowIso: string): Record<CardRating, string> | null {
  try {
    const prior = priorSchedule(state);
    const wait = (rating: CardRating) => {
      const next = scheduleCard(prior, rating, nowIso);
      return describeWait(Date.parse(next.dueAt) - Date.parse(next.lastReviewedAt));
    };
    return { again: wait("again"), hard: wait("hard"), good: wait("good"), easy: wait("easy") };
  } catch {
    return null;
  }
}

/** "back in 10 minutes", "tomorrow", "on Thu 8 Oct": when a saved card comes back. */
export function describeReturn(dueAt: string, nowIso: string, timeZone: string): string {
  const ms = Date.parse(dueAt) - Date.parse(nowIso);
  if (ms < 24 * 60 * 60 * 1000 && localDate(dueAt, timeZone) === localDate(nowIso, timeZone)) {
    return `in ${describeWait(Math.max(60_000, Math.ceil(ms / 60_000) * 60_000))}`;
  }
  const tomorrow = localDate(nextLocalMidnightUtc(nowIso, timeZone), timeZone);
  if (localDate(dueAt, timeZone) === tomorrow) return "tomorrow";
  return `on ${shortLocalDay(dueAt, timeZone)}`;
}

/* ------------------------------------------------------------------ */
/* The hook                                                            */
/* ------------------------------------------------------------------ */

export interface CardReviewClock {
  now: () => string;
  timeZone: () => string;
  newOperationId: () => string;
}

const systemClock: CardReviewClock = {
  now: () => new Date().toISOString(),
  timeZone: () => currentTimeZone(),
  newOperationId: () => crypto.randomUUID(),
};

export type CardReadState =
  | { phase: "loading" }
  | { phase: "failed" }
  | { phase: "ready"; snapshot: CardReviewSnapshot };

/** What the last write or refusal means for her, in plain terms. */
export type CardReviewNotice =
  | { kind: "saved"; text: string }
  | { kind: "reset-done" }
  | { kind: "stale" }
  | { kind: "clock" }
  | { kind: "paused-or-flagged" }
  | { kind: "not-saved" };

export interface PendingWrite {
  action: CardReviewAction;
  /** `sending` while in flight; `unknown` when the outcome could not be confirmed. */
  status: "sending" | "unknown";
}

export type ItemActionKind =
  | { action: "suspend" | "resume" | "unflag" }
  | { action: "flag"; reason: CardFlagReason };

const STALE = new Set(["STALE_GENERATION", "STALE_REVISION", "STALE_CONTENT", "MALFORMED_CARDS", "NOT_FOUND"]);
const DEFINITIVE = new Set([
  ...STALE,
  "INVALID_ARGUMENT",
  "OPERATION_CONFLICT",
  "OPERATION_ERASED",
  "CARD_SUSPENDED",
  "CARD_FLAGGED",
  "CLOCK_BEHIND_LAST_REVIEW",
  "INVALID_STATE",
  "NOT_READY",
  "UNSUPPORTED_DRIVER",
]);

/** Definitive refusals were not applied; anything else might have been. */
function isDefinitive(error: unknown): error is CardReviewError {
  return error instanceof CardReviewError && DEFINITIVE.has(error.code);
}

export function useCardReview(
  materialId: string | undefined,
  repository: CardReviewRepository | undefined,
  options: { contentKey?: string; clock?: CardReviewClock } = {},
) {
  const clock = options.clock ?? systemClock;
  const [read, setRead] = useState<CardReadState & { materialId: string | undefined }>({ phase: "loading", materialId });
  const [recent, setRecent] = useState<{
    rows: CardRecentReview[];
    next: CardRecentReviewCursor | null;
    failed: boolean;
    loading: boolean;
  }>({
    rows: [],
    next: null,
    failed: false,
    loading: false,
  });
  const [session, setSession] = useState<ReviewSession | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [pending, setPending] = useState<PendingWrite | null>(null);
  const [resetPending, setResetPending] = useState<PendingWrite | null>(null);
  const [resetCheck, setResetCheck] = useState<"idle" | "checking" | "not-confirmed">("idle");
  const [locked, setLocked] = useState(false);
  const [notice, setNotice] = useState<CardReviewNotice | null>(null);
  const [starting, setStarting] = useState(false);
  const [sessionUnavailable, setSessionUnavailable] = useState(false);

  /** Bumped by unmount and material change: every older async step becomes stale. */
  const scope = useRef(0);
  /** Id of the read request allowed to publish. */
  const currentRead = useRef(0);
  /** A read is in flight: Retry is synchronously locked. */
  const reading = useRef(false);
  /** Synchronous start lock: two synchronous starts allocate only one queue read. */
  const startingLock = useRef(false);
  /** Id/generation of the session start request allowed to publish. */
  const currentStart = useRef(0);
  /** History-list epoch independent of material scope. Bumped on reset intent, first-page refresh, and scope change. */
  const historyEpoch = useRef(0);
  /** Synchronous history page lock with request ownership. */
  const pagingLock = useRef(false);
  /** Id of the history page request allowed to publish. */
  const currentHistoryRequest = useRef(0);
  /** Current recent state ref for synchronous cursor access. */
  const recentRef = useRef(recent);
  recentRef.current = recent;
  /** Active session ref. */
  const sessionRef = useRef<ReviewSession | null>(null);
  sessionRef.current = session;
  /** One write at a time for this material. */
  const writing = useRef(false);
  /** An acknowledged result for the shown card, applied once a refresh succeeds. */
  const awaitingAdvance = useRef<string | null>(null);
  /** The latest authoritative snapshot, for building deliberate actions. */
  const latest = useRef<CardReviewSnapshot | null>(null);

  const lastContentKey = useRef(options.contentKey);
  const lastMaterialId = useRef(materialId);
  if (options.contentKey !== lastContentKey.current || materialId !== lastMaterialId.current) {
    lastContentKey.current = options.contentKey;
    lastMaterialId.current = materialId;
    scope.current += 1;
    currentStart.current += 1;
    startingLock.current = false;
    historyEpoch.current += 1;
    pagingLock.current = false;
    currentHistoryRequest.current += 1;
    writing.current = false;
    awaitingAdvance.current = null;
    latest.current = null;
    sessionRef.current = null;
  }

  const refresh = useCallback(async (): Promise<boolean> => {
    if (!materialId || !repository) return false;
    const owner = scope.current;
    const request = ++currentRead.current;
    reading.current = true;
    setRead((previous) => (previous.phase === "ready" && previous.materialId === materialId ? previous : { phase: "loading", materialId }));
    try {
      const [snapshot, page] = await Promise.all([repository.getCardReviewSnapshot(materialId), repository.getRecentReviews(materialId)]);
      if (scope.current !== owner || currentRead.current !== request) return false;
      reading.current = false;
      latest.current = snapshot;
      // Authoritative first-page refresh invalidates old pending page publications.
      historyEpoch.current += 1;
      pagingLock.current = false;
      currentHistoryRequest.current += 1;
      const nextRecent = { rows: page.rows, next: page.next, failed: false, loading: false };
      recentRef.current = nextRecent;
      setRead({ phase: "ready", snapshot, materialId });
      setRecent(nextRecent);
      setLocked(false);
      const advance = awaitingAdvance.current;
      awaitingAdvance.current = null;
      if (advance) {
        setSession((current) => {
          const next = current ? acknowledgeInSession(current, advance) : current;
          sessionRef.current = next;
          return next;
        });
        setRevealed(false);
      }
      return true;
    } catch {
      // Consumed on purpose: shown as sanitized, retryable status.
      if (scope.current !== owner || currentRead.current !== request) return false;
      reading.current = false;
      setRead((previous) => (previous.phase === "ready" && awaitingAdvance.current ? previous : { phase: "failed", materialId }));
      return false;
    }
  }, [materialId, repository]);

  useEffect(() => {
    scope.current += 1;
    currentStart.current += 1;
    startingLock.current = false;
    historyEpoch.current += 1;
    pagingLock.current = false;
    currentHistoryRequest.current += 1;
    writing.current = false;
    awaitingAdvance.current = null;
    latest.current = null;
    sessionRef.current = null;
    const emptyRecent = { rows: [], next: null, failed: false, loading: false };
    recentRef.current = emptyRecent;
    setRecent(emptyRecent);
    setSession(null);
    setStarting(false);
    setSessionUnavailable(false);
    setPending(null);
    setResetPending(null);
    setResetCheck("idle");
    setLocked(false);
    setNotice(null);
    setRevealed(false);
    void refresh();
    return () => {
      scope.current += 1;
      currentRead.current += 1;
      currentStart.current += 1;
      startingLock.current = false;
      historyEpoch.current += 1;
      pagingLock.current = false;
      currentHistoryRequest.current += 1;
      reading.current = false;
      writing.current = false;
    };
  }, [refresh, options.contentKey]);

  /** Read-only retry of the snapshot and recent reviews. */
  const retryReads = useCallback(() => {
    if (reading.current) return;
    void refresh();
  }, [refresh]);

  /** After an acknowledged write: confirm, then require a successful refresh. */
  const afterAcknowledged = useCallback(
    async (owner: number, result: CardReviewResult) => {
      if (result.action === "reset") {
        setNotice({ kind: "reset-done" });
        currentStart.current += 1;
        startingLock.current = false;
        setStarting(false);
        sessionRef.current = null;
        setSession(null);
      } else {
        const text =
          result.action === "rate" && result.dueAt
            ? `Saved: back ${describeReturn(result.dueAt, clock.now(), clock.timeZone())}`
            : result.action === "suspend"
              ? "Paused. It stays out of reviews until you resume it."
              : result.action === "resume"
                ? "Resumed. It's back in your reviews."
                : result.action === "flag"
                  ? "Flagged. It stays out of reviews until you unflag it."
                  : "Unflagged. It's back in your reviews.";
        setNotice({ kind: "saved", text });
        awaitingAdvance.current = result.itemId;
      }
      setLocked(true);
      const ok = await refresh();
      if (scope.current !== owner) return;
      if (!ok) setLocked(true);
    },
    [clock, refresh],
  );

  const handleRefusal = useCallback(
    async (owner: number, error: CardReviewError) => {
      if (scope.current !== owner) return;
      if (STALE.has(error.code)) {
        setNotice({ kind: "stale" });
        currentStart.current += 1;
        startingLock.current = false;
        setStarting(false);
        sessionRef.current = null;
        setSession(null);
      } else if (error.code === "CLOCK_BEHIND_LAST_REVIEW") {
        setNotice({ kind: "clock" });
      } else if (error.code === "CARD_SUSPENDED" || error.code === "CARD_FLAGGED") {
        setNotice({ kind: "paused-or-flagged" });
        void refresh();
      } else {
        setNotice({ kind: "not-saved" });
      }
    },
    [refresh],
  );

  /** Send one item action (new or a Try again of the same payload). */
  const send = useCallback(
    async (action: CardItemAction) => {
      if (!repository || writing.current) return;
      writing.current = true;
      const owner = scope.current;
      setPending({ action, status: "sending" });
      try {
        const result = await repository.saveAction(action);
        if (scope.current !== owner) return;
        setPending(null);
        writing.current = false;
        await afterAcknowledged(owner, result);
      } catch (error) {
        if (scope.current !== owner) return;
        writing.current = false;
        if (isDefinitive(error)) {
          setPending(null);
          await handleRefusal(owner, error);
        } else {
          setPending({ action, status: "unknown" });
        }
      }
    },
    [afterAcknowledged, handleRefusal, repository],
  );

  const blocked = locked || pending !== null || resetPending !== null;

  const buildItemAction = useCallback(
    (itemId: string, kind: { action: "rate"; rating: CardRating } | ItemActionKind): CardItemAction | null => {
      const snapshot = latest.current;
      if (!snapshot || snapshot.current.status !== "ok" || !materialId) return null;
      if (!snapshot.current.items.some((item) => item.itemId === itemId)) return null;
      return {
        operationId: clock.newOperationId(),
        materialId,
        versionContentHash: snapshot.current.contentHash,
        itemId,
        expectedGeneration: snapshot.generation,
        expectedRevision: snapshot.states[itemId]?.revision ?? 0,
        ...kind,
      } as CardItemAction;
    },
    [clock, materialId],
  );

  const rate = useCallback(
    (rating: CardRating) => {
      if (blocked || writing.current || !session || !revealed) return;
      const shown = session.cards[session.position];
      if (!shown) return;
      const action = buildItemAction(shown.itemId, { action: "rate", rating });
      if (action) void send(action);
    },
    [blocked, buildItemAction, revealed, send, session],
  );

  const itemAction = useCallback(
    (itemId: string, kind: ItemActionKind) => {
      if (blocked || writing.current) return;
      const action = buildItemAction(itemId, kind);
      if (action) void send(action);
    },
    [blocked, buildItemAction, send],
  );

  const tryAgain = useCallback(() => {
    if (pending?.status === "unknown" && pending.action.action !== "reset") void send(pending.action);
  }, [pending, send]);

  const reveal = useCallback(() => {
    if (session && session.cards[session.position]) setRevealed(true);
  }, [session]);

  /** Fix the session's cards from a fresh read: due cards first, then new ones. */
  const startSession = useCallback(async () => {
    if (!materialId || !repository || blocked || startingLock.current) return;
    startingLock.current = true;
    const owner = scope.current;
    const request = ++currentStart.current;
    setStarting(true);
    setSessionUnavailable(false);
    setNotice(null);
    try {
      const snapshot = await repository.getCardReviewSnapshot(materialId);
      if (scope.current !== owner || currentStart.current !== request) return;
      latest.current = snapshot;
      setRead({ phase: "ready", snapshot, materialId });
      if (snapshot.current.status !== "ok") return;
      const now = clock.now();
      const cards = await repository.getDueQueue({
        materialId,
        currentVersionId: snapshot.current.versionId,
        currentItemIds: snapshot.current.items.map((item) => item.itemId),
        nowUtc: now,
        nextLocalMidnightUtc: nextLocalMidnightUtc(now, clock.timeZone()),
      });
      if (scope.current !== owner || currentStart.current !== request) return;
      if (sessionRef.current && (sessionRef.current.position > 0 || sessionRef.current.completed.size > 0)) {
        return;
      }
      const newSession = createReviewSession(cards);
      sessionRef.current = newSession;
      setSession(newSession);
      setRevealed(false);
    } catch {
      if (scope.current === owner && currentStart.current === request) setSessionUnavailable(true);
    } finally {
      if (scope.current === owner && currentStart.current === request) {
        startingLock.current = false;
        setStarting(false);
      }
    }
  }, [blocked, clock, materialId, repository]);

  const endSession = useCallback(() => {
    currentStart.current += 1;
    startingLock.current = false;
    setStarting(false);
    sessionRef.current = null;
    setSession(null);
    setRevealed(false);
  }, []);

  /* ----------------------------- reset ----------------------------- */

  const sendReset = useCallback(
    async (action: CardResetAction) => {
      if (!repository || writing.current) return;
      historyEpoch.current += 1;
      pagingLock.current = false;
      currentHistoryRequest.current += 1;
      const loadingCleared = { ...recentRef.current, loading: false };
      recentRef.current = loadingCleared;
      setRecent(loadingCleared);
      writing.current = true;
      const owner = scope.current;
      setResetPending({ action, status: "sending" });
      setResetCheck("idle");
      try {
        const result = await repository.saveAction(action);
        if (scope.current !== owner) return;
        writing.current = false;
        setResetPending(null);
        await afterAcknowledged(owner, result);
      } catch (error) {
        if (scope.current !== owner) return;
        writing.current = false;
        if (isDefinitive(error)) {
          setResetPending(null);
          await handleRefusal(owner, error);
        } else {
          setResetPending({ action, status: "unknown" });
        }
      }
    },
    [afterAcknowledged, handleRefusal, repository],
  );

  /** A deliberate reset, built from the latest authoritative generation. */
  const confirmReset = useCallback(() => {
    if (blocked || writing.current || !materialId) return;
    const snapshot = latest.current;
    if (!snapshot) return;
    historyEpoch.current += 1;
    pagingLock.current = false;
    currentHistoryRequest.current += 1;
    const loadingCleared = { ...recentRef.current, loading: false };
    recentRef.current = loadingCleared;
    setRecent(loadingCleared);
    void sendReset({ action: "reset", operationId: clock.newOperationId(), materialId, expectedGeneration: snapshot.generation });
  }, [blocked, clock, materialId, sendReset]);

  /** Resend exactly the same reset request; it cannot reset twice. */
  const tryResetAgain = useCallback(() => {
    if (resetPending?.status === "unknown" && resetPending.action.action === "reset") {
      historyEpoch.current += 1;
      pagingLock.current = false;
      currentHistoryRequest.current += 1;
      const loadingCleared = { ...recentRef.current, loading: false };
      recentRef.current = loadingCleared;
      setRecent(loadingCleared);
      void sendReset(resetPending.action);
    }
  }, [resetPending, sendReset]);

  /**
   * Read-only: the receipt of this exact request decides. A changed
   * generation alone never counts as this reset's acknowledgement.
   */
  const checkResetAgain = useCallback(async () => {
    if (!repository || resetPending?.status !== "unknown" || resetCheck === "checking") return;
    const owner = scope.current;
    const action = resetPending.action;
    setResetCheck("checking");
    try {
      const status = await repository.getOperationStatus(action);
      if (scope.current !== owner) return;
      if (status.state === "applied" && status.sameRequest && status.result?.action === "reset") {
        setResetPending(null);
        setResetCheck("idle");
        await afterAcknowledged(owner, status.result);
      } else if (status.state === "absent") {
        setResetCheck("not-confirmed");
      } else {
        // Erased or a different request under this ID: definitively not this reset.
        setResetPending(null);
        setResetCheck("idle");
        setNotice({ kind: "not-saved" });
        void refresh();
      }
    } catch {
      if (scope.current === owner) setResetCheck("not-confirmed");
    }
  }, [afterAcknowledged, refresh, repository, resetCheck, resetPending]);

  const loadMoreRecent = useCallback(async () => {
    const cursor = recentRef.current.next;
    if (!materialId || !repository || !cursor || pagingLock.current) return;
    pagingLock.current = true;
    const owner = scope.current;
    const epoch = historyEpoch.current;
    const request = ++currentHistoryRequest.current;
    setRecent((current) => {
      const nextRecent = { ...current, loading: true, failed: false };
      recentRef.current = nextRecent;
      return nextRecent;
    });
    try {
      const page = await repository.getRecentReviews(materialId, cursor);
      if (scope.current !== owner || historyEpoch.current !== epoch || currentHistoryRequest.current !== request) return;
      pagingLock.current = false;
      setRecent((current) => {
        const existingIds = new Set(current.rows.map((r) => r.id));
        const newRows = page.rows.filter((r) => !existingIds.has(r.id));
        const nextRecent = {
          rows: [...current.rows, ...newRows],
          next: page.next,
          failed: false,
          loading: false,
        };
        recentRef.current = nextRecent;
        return nextRecent;
      });
    } catch {
      if (scope.current !== owner || historyEpoch.current !== epoch || currentHistoryRequest.current !== request) return;
      pagingLock.current = false;
      setRecent((current) => {
        const nextRecent = { ...current, failed: true, loading: false };
        recentRef.current = nextRecent;
        return nextRecent;
      });
    }
  }, [materialId, repository]);

  const readState: CardReadState = read.materialId === materialId ? read : { phase: "loading" };
  return {
    read: readState,
    recent,
    session,
    revealed,
    pending,
    resetPending,
    resetCheck,
    locked,
    blocked,
    notice,
    starting,
    sessionUnavailable,
    clock,
    retryReads,
    startSession,
    endSession,
    reveal,
    rate,
    itemAction,
    tryAgain,
    confirmReset,
    tryResetAgain,
    checkResetAgain,
    loadMoreRecent,
    dismissNotice: () => setNotice(null),
  };
}

export type CardReviewController = ReturnType<typeof useCardReview>;
