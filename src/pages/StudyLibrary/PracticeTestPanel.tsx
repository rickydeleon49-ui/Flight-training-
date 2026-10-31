import { AcsTaskChip } from "./AcsTaskChip";
import { ShortSavedReviewLink } from "./ShortSavedReviewLink";
import { PdfItemLabel } from "./PdfItemLabel";
import { practiceAskContext } from "@/logic/practiceAskContext";
import { AskGeminiPanel } from "./AskGeminiPanel";
import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from "react";

import { AlertIcon, Badge, Button, ConfirmDialog } from "@/components/ui";
import { PracticeSessionError } from "@/data/persistenceErrors";
import type {
  PracticeCompletedResult,
  PracticeSessionAction,
  PracticeSessionState,
  PracticeTest,
  PracticeTestItem,
  PracticeTestVersion,
} from "@/domain/types";
import { attemptReviewPath } from "@/logic/practiceAttemptReview";
import { AppDataContext } from "@/state/AppDataContext";
import "./studyLibrary.css";
import { SourcePageBadge } from "./navigation/SourcePageBadge";

export interface PracticeTestPanelProps {
  entrySummary?: boolean;
  /** Shown instead of Start while study kit drafts wait above (no mis-tap beside Save). */
  startHeld?: string;
  /** Lets adjacent authoring controls follow this panel's live attempt state. */
  onAttemptChange?: (active: boolean) => void;
  practiceTest: PracticeTest;
  materialId?: string;
  materialTitle?: string;
  onComplete?: (result: PracticeCompletedResult) => void;
}

interface DraftSelection {
  choiceIndex: number | null;
  isDontKnow: boolean;
}

/**
 * One intended mutation. Identity is allocated once per intent and Retry
 * resends this exact payload, so an uncertain outcome can never turn into a
 * fresh start, answer, completion, retake or abandonment.
 */
interface SessionIntent {
  payload: PracticeSessionAction;
  /**
   * An answer chosen before its attempt was acknowledged. It is held here —
   * never revealed as saved feedback, never silently lost when a start retry
   * succeeds.
   */
  heldAnswer: {
    responseOperationId: string;
    draft: DraftSelection;
    itemIndex: number;
  } | null;
}

interface LockOwner {
  materialId: string;
  operationId: string;
}

interface HeldStartAnswer {
  held: {
    responseOperationId: string;
    draft: DraftSelection;
    itemIndex: number;
  };
  versionId: string;
  attemptId: string;
}

/**
 * The panel's only authority over what is editable. Every unresolved
 * transition is an explicit phase instead of an inferred combination of
 * booleans, so a failed or uncertain write keeps its lock.
 */
type Phase =
  | "loading"
  | "load_failed"
  | "unavailable"
  | "ready"
  | "write_in_flight"
  | "write_unknown"
  | "refresh_in_flight"
  | "refresh_failed"
  | "completed";

interface PanelState {
  /** Request generation: the only token allowed to publish state or unlock. */
  generation: number;
  materialId: string;
  phase: Phase;
  version: PracticeTestVersion | null;
  items: PracticeTestItem[] | null;
  freshVersionId: string | null;
  attempt: PracticeSessionState | null;
  completedResult: PracticeCompletedResult | null;
  index: number;
  focusIndex: number;
  /** Local selection; never evidence of a saved response. */
  draft: DraftSelection | null;
  changingAnswer: boolean;
  intent: (SessionIntent & { error: string | null }) | null;
  failure: { kind: "load" | "write" | "refresh"; text: string } | null;
  notice: string | null;
}

type PanelAction =
  | { type: "load_started"; generation: number; materialId: string }
  | {
      type: "snapshot_adopted";
      freshVersionId: string | null;
      generation: number;
      version: PracticeTestVersion;
      items: PracticeTestItem[];
      attempt: PracticeSessionState | null;
    }
  | { type: "snapshot_unavailable"; generation: number }
  | { type: "load_failed"; generation: number; text: string }
  | { type: "intent_started"; generation: number; intent: SessionIntent }
  | { type: "intent_unresolved"; generation: number; intent: SessionIntent; text: string }
  | { type: "intent_settled"; generation: number }
  | { type: "notice"; generation: number; text: string }
  | { type: "refresh_started"; generation: number }
  | {
      type: "attempt_adopted";
      generation: number;
      attempt: PracticeSessionState | null;
      version: PracticeTestVersion | null;
      items: PracticeTestItem[] | null;
      /** The start acknowledgement is only half of an answer intent. */
      preserveDraft?: boolean;
    }
  | { type: "refresh_failed"; generation: number; text: string }
  | { type: "completed_acknowledged"; generation: number; result: PracticeCompletedResult }
  | { type: "draft"; generation: number; draft: DraftSelection }
  | { type: "navigated"; generation: number; index: number; focusIndex: number }
  | { type: "changing_answer"; generation: number }
  | { type: "focused"; generation: number; focusIndex: number };

const REFRESH_FAILURE = "Action applied, but refreshing status failed. Click Retry to refresh.";

function initialPanelState(materialId: string, generation: number): PanelState {
  return {
    generation,
    materialId,
    phase: "loading",
    version: null,
    items: null,
    freshVersionId: null,
    attempt: null,
    completedResult: null,
    index: 0,
    focusIndex: 0,
    draft: null,
    changingAnswer: false,
    intent: null,
    failure: null,
    notice: null,
  };
}

/** Next unanswered ordinal, bounded by the frozen items actually displayed. */
function resumeIndex(
  attempt: PracticeSessionState | null,
  items: PracticeTestItem[] | null,
): number {
  const next = attempt?.nextUnansweredOrdinal;
  if (next === null || next === undefined || !items || items.length === 0) return 0;
  return next < items.length ? next : 0;
}

function panelReducer(state: PanelState, action: PanelAction): PanelState {
  // A load always owns a new generation; a different material starts over.
  if (action.type === "load_started") {
    if (action.generation < state.generation) return state;
    if (action.materialId !== state.materialId) {
      return initialPanelState(action.materialId, action.generation);
    }
    // A retry keeps the held intent: no load may clear a newer pending mutation.
    return { ...state, generation: action.generation, phase: "loading", failure: null };
  }

  if (action.generation !== state.generation) return state;

  switch (action.type) {
    case "snapshot_adopted": {
      const replacedAttempt = action.attempt?.attemptId !== state.attempt?.attemptId;
      return {
        ...state,
        phase: "ready",
        version: action.version,
        items: action.items,
        freshVersionId: action.freshVersionId,
        attempt: action.attempt,
        completedResult: null,
        index: replacedAttempt ? resumeIndex(action.attempt, action.items) : state.index,
        focusIndex: 0,
        draft: null,
        changingAnswer: false,
        failure: null,
      };
    }
    case "snapshot_unavailable":
      return {
        ...state,
        phase: "unavailable",
        version: null,
        items: null,
        attempt: null,
        completedResult: null,
        index: 0,
        focusIndex: 0,
        draft: null,
        changingAnswer: false,
        intent: null,
        failure: null,
        notice: null,
      };
    case "load_failed":
      return {
        ...state,
        phase: "load_failed",
        version: null,
        items: null,
        attempt: null,
        draft: null,
        changingAnswer: false,
        failure: { kind: "load", text: action.text },
      };
    case "intent_started":
      return {
        ...state,
        phase: "write_in_flight",
        intent: { ...action.intent, error: null },
        changingAnswer: false,
        failure: null,
        notice: null,
      };
    case "intent_unresolved":
      return {
        ...state,
        phase: "write_unknown",
        intent: { ...action.intent, error: action.text },
        failure: { kind: "write", text: action.text },
      };
    case "intent_settled":
      return { ...state, intent: null };
    case "notice":
      return { ...state, notice: action.text };
    case "refresh_started":
      return { ...state, phase: "refresh_in_flight", failure: null };
    case "attempt_adopted": {
      // M2UI-R8: one adoption path for null, current and replaced state.
      if (action.attempt === null) {
        return {
          ...state,
          phase: "ready",
          attempt: null,
          completedResult: null,
          version: action.version ?? state.version,
          items: action.items ?? state.items,
          index: 0,
          focusIndex: 0,
          draft: null,
          changingAnswer: false,
          intent: null,
          failure: null,
        };
      }
      const items = action.items ?? state.items;
      if (action.preserveDraft) {
        // Half of one answer intent: the attempt is acknowledged, the answer
        // still needs applying. Position and held selection stay as they are,
        // and the view settles so a held answer that can no longer be applied
        // cannot strand the panel in a spinner with no way to answer again.
        // When the same tick continues into the response write, that transition
        // is batched over this one.
        return {
          ...state,
          phase: "ready",
          attempt: action.attempt,
          version: action.version ?? state.version,
          items,
          failure: null,
          notice: null,
        };
      }
      const replacedAttempt = action.attempt.attemptId !== state.attempt?.attemptId;
      return {
        ...state,
        phase: "ready",
        attempt: action.attempt,
        // An acknowledged current attempt replaces any earlier result view.
        completedResult: null,
        version: action.version ?? state.version,
        items,
        index: replacedAttempt ? resumeIndex(action.attempt, items) : state.index,
        draft: null,
        changingAnswer: false,
        intent: null,
        failure: null,
      };
    }
    case "refresh_failed":
      // The write is acknowledged, so its identity is no longer pending; the
      // failed read keeps everything else locked.
      return {
        ...state,
        phase: "refresh_failed",
        intent: null,
        failure: { kind: "refresh", text: action.text },
      };
    case "completed_acknowledged":
      return {
        ...state,
        phase: "completed",
        completedResult: action.result,
        intent: null,
        failure: null,
        notice: null,
      };
    case "draft":
      return { ...state, draft: action.draft, changingAnswer: false, notice: null };
    case "navigated":
      return {
        ...state,
        index: action.index,
        focusIndex: action.focusIndex,
        draft: null,
        changingAnswer: false,
        notice: null,
      };
    case "changing_answer":
      return { ...state, changingAnswer: true, draft: null, notice: null };
    case "focused":
      return { ...state, focusIndex: action.focusIndex };
    default:
      return state;
  }
}

/** Typed refusals are settled outcomes; anything else has an unknown result. */
function settledRefusalText(error: unknown): string | null {
  if (error instanceof PracticeSessionError) {
    if (
      error.code === "OPERATION_CONFLICT" ||
      error.code === "INVALID_STATE" ||
      error.code === "NOT_FOUND" ||
      error.code === "INVALID_ARGUMENT"
    ) {
      return error.message;
    }
  }
  return null;
}

function failureText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return "The operation could not be completed.";
}

function pendingLabel(intent: SessionIntent | null): string {
  switch (intent?.payload.action) {
    case "start_or_resume":
      return "Starting your practice attempt…";
    case "complete_attempt":
      return "Submitting your score…";
    case "retake_attempt":
      return "Starting your retake…";
    case "abandon_attempt":
      return "Closing this attempt…";
    default:
      return "Saving your answer…";
  }
}

export function PracticeTestPanel({
  entrySummary = false,
  startHeld,
  practiceTest,
  materialId: propMaterialId,
  materialTitle: _materialTitle,
  onComplete,
  onAttemptChange,
}: PracticeTestPanelProps) {
  const appData = useContext(AppDataContext);
  const repositories = appData?.repositories?.practiceSessions;
  const materialId = propMaterialId || practiceTest.sourceMaterialId;

  const [state, dispatch] = useReducer(
    panelReducer,
    undefined,
    () => initialPanelState(materialId, 1),
  );
  const [confirmingAbandon, setConfirmingAbandon] = useState(false);
  const [continuedOlderAttempt, setContinuedOlderAttempt] = useState<string | null>(null);
  useEffect(() => {
    onAttemptChange?.(state.attempt !== null && state.completedResult === null);
  }, [onAttemptChange, state.attempt, state.completedResult]);

  // Synchronous authority. React state cannot be read before the next render,
  // so two events inside one render are gated by these refs instead.
  const generationRef = useRef(state.generation);
  const busyRef = useRef(false);
  const intentRef = useRef<SessionIntent | null>(null);
  const busyOwnerRef = useRef<LockOwner | null>(null);
  const intentOwnerRef = useRef<{ intent: SessionIntent; materialId: string } | null>(null);
  const activeMaterialRef = useRef(materialId);
  const heldStartRef = useRef<HeldStartAnswer | null>(null);
  const mountedRef = useRef(true);
  const renderedRef = useRef(state);
  renderedRef.current = state;

  // On a different material/repository lifetime, detach old intent and lock.
  if (activeMaterialRef.current !== materialId) {
    activeMaterialRef.current = materialId;
    intentOwnerRef.current = null;
    intentRef.current = null;
    busyOwnerRef.current = null;
    busyRef.current = false;
    heldStartRef.current = null;
  }

  const acquireBusy = useCallback((owner: LockOwner) => {
    busyOwnerRef.current = owner;
    busyRef.current = true;
  }, []);

  const releaseBusy = useCallback((owner: LockOwner) => {
    if (
      busyOwnerRef.current &&
      busyOwnerRef.current.materialId === owner.materialId &&
      busyOwnerRef.current.operationId === owner.operationId
    ) {
      busyOwnerRef.current = null;
      busyRef.current = false;
    }
  }, []);

  const setIntent = useCallback((intent: SessionIntent, matId: string) => {
    intentOwnerRef.current = { intent, materialId: matId };
    intentRef.current = intent;
  }, []);

  const clearIntent = useCallback((owner: LockOwner) => {
    if (
      intentOwnerRef.current &&
      intentOwnerRef.current.materialId === owner.materialId &&
      intentOwnerRef.current.intent.payload.operationId === owner.operationId
    ) {
      intentOwnerRef.current = null;
      intentRef.current = null;
    }
  }, []);

  const isBusy = useCallback(() => busyOwnerRef.current !== null, []);
  const hasPendingIntent = useCallback(
    () =>
      intentOwnerRef.current !== null &&
      intentOwnerRef.current.materialId === materialId,
    [materialId],
  );
  const getActiveIntent = useCallback(
    () =>
      intentOwnerRef.current && intentOwnerRef.current.materialId === materialId
        ? intentOwnerRef.current.intent
        : null,
    [materialId],
  );

  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const questionHeadingRef = useRef<HTMLHeadingElement>(null);
  const navigationFrom = useRef<number | null>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const actionButtonRef = useRef<HTMLButtonElement | null>(null);

  const isCurrent = useCallback((generation: number) => {
    return mountedRef.current && generation === generationRef.current;
  }, []);

  const nextGeneration = useCallback(() => {
    generationRef.current += 1;
    return generationRef.current;
  }, []);

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  const loadSnapshot = useCallback(
    async (reason: "initial" | "retry" | "reconcile", refreshedNotice?: string): Promise<void> => {
      if (!materialId || !repositories) return;
      const generation = nextGeneration();
      dispatch({ type: "load_started", generation, materialId });
      try {
        // Both authoritative reads settle before anything becomes editable.
        const [active, attempt] = await Promise.all([
          repositories.getActiveVersion(materialId),
          repositories.getCurrentAttempt(materialId),
        ]);
        if (!isCurrent(generation)) return;
        if (!active || active.items.length === 0) {
          dispatch({ type: "snapshot_unavailable", generation });
          return;
        }
        // Resume the attempt's frozen questions, never pair its responses with
        // another version. A changed set gets a deliberate choice before resume.
        let frozen = active;
        if (attempt && attempt.versionId !== active.version.id) {
          const [version, items] = await Promise.all([
            repositories.getVersion(attempt.versionId), repositories.getItems(attempt.versionId),
          ]);
          if (!version || items.length === 0) throw new Error("Missing practice attempt questions");
          frozen = { version, items };
        }
        if (!isCurrent(generation)) return;
        const content = (items: PracticeTestItem[]) => JSON.stringify(items.map(item => [
          item.questionText, item.options, item.correctIndex, item.explanation, item.sourcePage,
        ]));
        dispatch({
          type: "snapshot_adopted",
          generation,
          version: frozen.version,
          items: frozen.items,
          freshVersionId: attempt && content(frozen.items) !== content(active.items) ? active.version.id : null,
          attempt,
        });
        if (refreshedNotice) {
          // Only reachable once the authoritative read really succeeded.
          dispatch({ type: "notice", generation, text: refreshedNotice });
        }
      } catch (error) {
        if (!isCurrent(generation)) return;
        if (reason === "reconcile") {
          dispatch({ type: "refresh_failed", generation, text: REFRESH_FAILURE });
          return;
        }
        dispatch({ type: "load_failed", generation, text: failureText(error) });
      }
    },
    [dispatch, isCurrent, materialId, nextGeneration, repositories],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
    };
  }, []);

  useEffect(() => {
    void loadSnapshot("initial");
  }, [loadSnapshot]);

  /**
   * The single adoption transition (M2UI-R8). A valid null is authoritative
   * state, not a failed read, and clears everything derived from the old
   * attempt. A replaced attempt refreshes its own frozen items before editing.
   * Returns the adopted content so a continuation never guesses from stale
   * render state.
   */
  const adoptAttempt = useCallback(
    async (
      attempt: PracticeSessionState | null,
      generation: number,
      preserveDraft = false,
    ): Promise<{ version: PracticeTestVersion | null; items: PracticeTestItem[] | null }> => {
      if (!repositories || !isCurrent(generation)) return { version: null, items: null };
      let version: PracticeTestVersion | null = null;
      let items: PracticeTestItem[] | null = null;
      if (attempt) {
        const known = renderedRef.current;
        if (known.version?.id === attempt.versionId && known.items && known.items.length > 0) {
          version = known.version;
          items = known.items;
        } else {
          const [fetchedVersion, fetchedItems] = await Promise.all([
            repositories.getVersion(attempt.versionId),
            repositories.getItems(attempt.versionId),
          ]);
          if (!isCurrent(generation)) return { version: null, items: null };
          version = fetchedVersion;
          items = fetchedItems;
        }
        if (!version || !items || items.length === 0) {
          throw new Error("Missing or incomplete replacement practice test version");
        }
      }
      if (!attempt && renderedRef.current.freshVersionId) {
        const active = await repositories.getActiveVersion(materialId);
        if (!active || active.items.length === 0) throw new Error("Missing current practice questions");
        version = active.version;
        items = active.items;
      }
      if (!isCurrent(generation)) return { version: null, items: null };
      dispatch({ type: "attempt_adopted", generation, attempt, version, items, preserveDraft });
      return { version, items };
    },
    [dispatch, isCurrent, repositories, materialId],
  );

  const runIntentRef = useRef<
    | ((intent: SessionIntent, generation: number, owner: LockOwner) => Promise<void>)
    | null
  >(null);

  const refreshCurrentAttempt = useCallback(
    async (generation: number): Promise<void> => {
      if (!repositories || !materialId || !isCurrent(generation)) return;
      dispatch({ type: "refresh_started", generation });
      try {
        const attempt = await repositories.getCurrentAttempt(materialId);
        if (!isCurrent(generation)) return;
        const adopted = await adoptAttempt(
          attempt,
          generation,
          Boolean(heldStartRef.current),
        );
        if (!isCurrent(generation)) return;

        if (heldStartRef.current) {
          const pending = heldStartRef.current;
          heldStartRef.current = null;
          if (
            attempt &&
            attempt.attemptId === pending.attemptId &&
            adopted.version?.id === pending.versionId
          ) {
            const item = adopted.items?.[pending.held.itemIndex];
            if (item) {
              const responseIntent: SessionIntent = {
                payload: {
                  action: "record_response",
                  operationId: pending.held.responseOperationId,
                  attemptId: attempt.attemptId,
                  itemId: item.id,
                  expectedRevision: attempt.revision,
                  selectedIndex: pending.held.draft.choiceIndex,
                  isDontKnow: pending.held.draft.isDontKnow,
                },
                heldAnswer: null,
              };
              const responseOwner: LockOwner = {
                materialId,
                operationId: pending.held.responseOperationId,
              };
              setIntent(responseIntent, materialId);
              acquireBusy(responseOwner);
              dispatch({ type: "intent_started", generation, intent: responseIntent });
              await runIntentRef.current?.(responseIntent, generation, responseOwner);
              return;
            }
          }
          dispatch({
            type: "notice",
            generation,
            text: "The practice content changed while starting. Choose your answer again.",
          });
        }
      } catch {
        if (isCurrent(generation)) {
          dispatch({ type: "refresh_failed", generation, text: REFRESH_FAILURE });
        }
      }
    },
    [
      acquireBusy,
      adoptAttempt,
      dispatch,
      isCurrent,
      materialId,
      repositories,
      setIntent,
    ],
  );

  // -------------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------------

  const runIntent = useCallback(
    async (intent: SessionIntent, generation: number, owner: LockOwner): Promise<void> => {
      if (!repositories || !isCurrent(generation)) {
        releaseBusy(owner);
        return;
      }

      let result: unknown;
      try {
        result = await repositories.saveSessionAction(intent.payload);
      } catch (error) {
        releaseBusy(owner);
        if (!isCurrent(generation)) return;
        const settled = settledRefusalText(error);
        if (settled) {
          clearIntent(owner);
          dispatch({ type: "intent_settled", generation });
          // Stay blocked while the current state is re-read; announce the
          // refresh only if that read succeeds, otherwise read recovery shows.
          void loadSnapshot(
            "reconcile",
            `${settled} The practice state was refreshed; choose the action again.`,
          );
          return;
        }
        // Unknown outcome: identity stays pending and keeps every conflicting
        // action locked until it is deliberately retried with the same payload.
        dispatch({ type: "intent_unresolved", generation, intent, text: failureText(error) });
        return;
      }

      if (!isCurrent(generation)) {
        releaseBusy(owner);
        return;
      }

      const payload = intent.payload;

      if (payload.action === "complete_attempt") {
        clearIntent(owner);
        releaseBusy(owner);
        const completed = result as PracticeCompletedResult;
        dispatch({ type: "completed_acknowledged", generation, result: completed });
        onCompleteRef.current?.(completed);
        return;
      }

      if (payload.action === "start_or_resume") {
        const acknowledged = result as PracticeSessionState;
        const held = intent.heldAnswer;
        clearIntent(owner);
        releaseBusy(owner);
        let adopted: { version: PracticeTestVersion | null; items: PracticeTestItem[] | null };
        try {
          adopted = await adoptAttempt(acknowledged, generation, Boolean(held));
        } catch {
          if (!isCurrent(generation)) return;
          if (held) {
            heldStartRef.current = {
              held,
              versionId: payload.versionId,
              attemptId: acknowledged.attemptId,
            };
          }
          dispatch({ type: "refresh_failed", generation, text: REFRESH_FAILURE });
          return;
        }

        if (!isCurrent(generation) || !held) return;
        // The held answer applies only against the acknowledged attempt and
        // its own frozen item — never another version or revision.
        const item =
          adopted.version?.id === payload.versionId
            ? adopted.items?.[held.itemIndex]
            : undefined;
        if (!item) {
          dispatch({
            type: "notice",
            generation,
            text: "The practice content changed while starting. Choose your answer again.",
          });
          return;
        }
        const responseIntent: SessionIntent = {
          payload: {
            action: "record_response",
            operationId: held.responseOperationId,
            attemptId: acknowledged.attemptId,
            itemId: item.id,
            expectedRevision: acknowledged.revision,
            selectedIndex: held.draft.choiceIndex,
            isDontKnow: held.draft.isDontKnow,
          },
          heldAnswer: null,
        };
        const responseOwner: LockOwner = {
          materialId,
          operationId: held.responseOperationId,
        };
        setIntent(responseIntent, materialId);
        acquireBusy(responseOwner);
        dispatch({ type: "intent_started", generation, intent: responseIntent });
        await runIntent(responseIntent, generation, responseOwner);
        return;
      }

      if (payload.action === "retake_attempt") {
        const acknowledged = result as PracticeSessionState;
        clearIntent(owner);
        releaseBusy(owner);
        try {
          await adoptAttempt(acknowledged, generation);
          if (!isCurrent(generation)) return;
          // A receipt can be historical: reconcile the actual current attempt
          // before editing is unlocked.
          await refreshCurrentAttempt(generation);
        } catch {
          if (isCurrent(generation)) {
            dispatch({ type: "refresh_failed", generation, text: REFRESH_FAILURE });
          }
        }
        return;
      }

      // record_response / abandon_attempt: acknowledged, then re-read state.
      clearIntent(owner);
      releaseBusy(owner);
      await refreshCurrentAttempt(generation);
    },
    [
      acquireBusy,
      adoptAttempt,
      clearIntent,
      dispatch,
      isCurrent,
      loadSnapshot,
      materialId,
      refreshCurrentAttempt,
      releaseBusy,
      repositories,
      setIntent,
    ],
  );

  runIntentRef.current = runIntent;

  /** Allocates one intent; a second event in the same render cannot get past this. */
  const beginIntent = useCallback(
    async (intent: SessionIntent): Promise<void> => {
      if (isBusy() || hasPendingIntent()) return;
      const generation = generationRef.current;
      const owner: LockOwner = {
        materialId,
        operationId: intent.payload.operationId,
      };
      setIntent(intent, materialId);
      acquireBusy(owner);
      dispatch({ type: "intent_started", generation, intent });
      await runIntent(intent, generation, owner);
    },
    [acquireBusy, dispatch, hasPendingIntent, isBusy, materialId, runIntent, setIntent],
  );

  /** Resends the exact unresolved payload; never allocates a new identity. */
  const retryPending = useCallback(async (): Promise<void> => {
    const intent = getActiveIntent();
    if (!intent || isBusy()) return;
    if (renderedRef.current.phase !== "write_unknown") return;
    const generation = generationRef.current;
    const owner: LockOwner = {
      materialId,
      operationId: intent.payload.operationId,
    };
    acquireBusy(owner);
    dispatch({ type: "intent_started", generation, intent });
    await runIntent(intent, generation, owner);
  }, [acquireBusy, dispatch, getActiveIntent, isBusy, materialId, runIntent]);

  /** Read-only recovery; an acknowledged write is never resent here. */
  const retryRefresh = useCallback(async (): Promise<void> => {
    if (isBusy() || hasPendingIntent()) return;
    if (renderedRef.current.phase !== "refresh_failed") return;
    await refreshCurrentAttempt(generationRef.current);
  }, [hasPendingIntent, isBusy, refreshCurrentAttempt]);

  // -------------------------------------------------------------------------
  // Derived render data
  // -------------------------------------------------------------------------

  const questions: PracticeTestItem[] = state.items ?? [];
  const totalQuestions = questions.length;
  const question = questions[state.index];
  const currentItem = questions[state.index];

  const confirmedResponse =
    currentItem && state.attempt
      ? state.attempt.responses.find((r) => r.itemId === currentItem.id)
      : undefined;

  const canEdit = state.phase === "ready";

  // Durable feedback only: an unsaved draft never inherits saved correctness.
  const revealed =
    !state.changingAnswer && state.draft === null && confirmedResponse !== undefined;

  const shownChoice = state.draft ? state.draft.choiceIndex : confirmedResponse?.selectedIndex ?? null;
  const shownDontKnow = state.draft ? state.draft.isDontKnow : confirmedResponse?.isDontKnow ?? false;
  const isCorrect = revealed && confirmedResponse !== undefined && confirmedResponse.isCorrect;

  const answeredCount = state.attempt?.answeredCount ?? 0;
  const showContinue = state.draft !== null || confirmedResponse !== undefined;

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  const submitAnswer = useCallback(
    (choiceIndex: number | null, isDontKnow: boolean): void => {
      if (busyRef.current || intentRef.current) return;
      const current = renderedRef.current;
      if (current.phase !== "ready") return;
      const item = current.items?.[current.index];
      if (!item) return;

      const draft: DraftSelection = { choiceIndex, isDontKnow };
      dispatch({ type: "draft", generation: current.generation, draft });

      const responseOperationId = crypto.randomUUID();

      if (!current.attempt) {
        if (!current.version) return;
        void beginIntent({
          payload: {
            action: "start_or_resume",
            operationId: crypto.randomUUID(),
            materialId: current.materialId,
            versionId: current.version.id,
          },
          heldAnswer: { responseOperationId, draft, itemIndex: current.index },
        });
        return;
      }

      void beginIntent({
        payload: {
          action: "record_response",
          operationId: responseOperationId,
          attemptId: current.attempt.attemptId,
          itemId: item.id,
          expectedRevision: current.attempt.revision,
          selectedIndex: choiceIndex,
          isDontKnow,
        },
        heldAnswer: null,
      });
    },
    [beginIntent, dispatch],
  );

  const handleSelectOption = useCallback(
    (optionIndex: number) => {
      submitAnswer(optionIndex, false);
    },
    [submitAnswer],
  );

  const handleDontKnow = useCallback(() => {
    submitAnswer(null, true);
  }, [submitAnswer]);

  const handleChangeAnswer = useCallback(() => {
    if (busyRef.current || intentRef.current) return;
    if (renderedRef.current.phase !== "ready") return;
    dispatch({ type: "changing_answer", generation: generationRef.current });
  }, [dispatch]);

  const goToIndex = useCallback(
    (nextIndex: number, focusIndex = 0) => {
      if (busyRef.current || intentRef.current) return;
      if (renderedRef.current.phase !== "ready") return;
      if (nextIndex !== renderedRef.current.index) navigationFrom.current = renderedRef.current.index;
      dispatch({
        type: "navigated",
        generation: generationRef.current,
        index: nextIndex,
        focusIndex,
      });
    },
    [dispatch],
  );

  const handleComplete = useCallback(() => {
    if (busyRef.current || intentRef.current) return;
    const current = renderedRef.current;
    if (current.phase !== "ready") return;
    if (!current.attempt) {
      void loadSnapshot("retry");
      return;
    }
    void beginIntent({
      payload: {
        action: "complete_attempt",
        operationId: crypto.randomUUID(),
        attemptId: current.attempt.attemptId,
        expectedRevision: current.attempt.revision,
      },
      heldAnswer: null,
    });
  }, [beginIntent, loadSnapshot]);

  const handleContinue = useCallback(() => {
    const current = renderedRef.current;
    if (current.index + 1 < totalQuestions) {
      goToIndex(current.index + 1);
      return;
    }
    handleComplete();
  }, [goToIndex, handleComplete, totalQuestions]);

  const handleRetake = useCallback(() => {
    if (busyRef.current || intentRef.current) return;
    const current = renderedRef.current;
    if (current.phase !== "completed" || !current.version) return;
    const inProgress =
      current.attempt && current.attempt.status === "in_progress" && !current.completedResult
        ? current.attempt
        : null;
    void beginIntent({
      payload: {
        action: "retake_attempt",
        operationId: crypto.randomUUID(),
        // A completed attempt has no current attempt to expect, as accepted
        // by the contract.
        expectedAttemptId: inProgress ? inProgress.attemptId : null,
        materialId: current.materialId,
        versionId: current.freshVersionId ?? current.version.id,
      },
      heldAnswer: null,
    });
  }, [beginIntent]);

  const handleAbandon = useCallback(() => {
    setConfirmingAbandon(false);
    if (busyRef.current || intentRef.current) return;
    const current = renderedRef.current;
    if (current.phase !== "ready" || !current.attempt) return;
    void beginIntent({
      payload: {
        action: "abandon_attempt",
        operationId: crypto.randomUUID(),
        attemptId: current.attempt.attemptId,
        expectedRevision: current.attempt.revision,
      },
      heldAnswer: null,
    });
  }, [beginIntent]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent, optionIndex: number) => {
      if (!canEdit || busyRef.current || intentRef.current || revealed) return;
      const count = question?.options.length ?? 0;
      let next: number | null = null;

      switch (event.key) {
        case "ArrowDown":
        case "ArrowRight":
          event.preventDefault();
          next = (optionIndex + 1) % count;
          break;
        case "ArrowUp":
        case "ArrowLeft":
          event.preventDefault();
          next = (optionIndex - 1 + count) % count;
          break;
        case "Home":
          event.preventDefault();
          next = 0;
          break;
        case "End":
          event.preventDefault();
          next = count - 1;
          break;
        case "Enter":
        case " ":
        case "Spacebar":
          event.preventDefault();
          handleSelectOption(optionIndex);
          return;
      }

      if (next !== null) {
        dispatch({ type: "focused", generation: generationRef.current, focusIndex: next });
        optionRefs.current[next]?.focus();
      }
    },
    [canEdit, dispatch, handleSelectOption, question, revealed],
  );

  // Focus follows the authoritative phase, not a pending click. These are layout
  // effects on purpose: the choice that just became revealed is disabled in the
  // same commit, and a browser blurs a disabled element. A passive effect would
  // leave a frame where focus sits on <body> before the action button takes it.
  useLayoutEffect(() => {
    if (revealed && !state.completedResult) actionButtonRef.current?.focus();
  }, [revealed, state.completedResult]);

  useLayoutEffect(() => {
    if (navigationFrom.current === null || navigationFrom.current === state.index) return;
    navigationFrom.current = null;
    const heading = questionHeadingRef.current;
    heading?.focus({ preventScroll: true });
    heading?.scrollIntoView?.({
      block: "start",
      behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }, [state.index]);

  // -------------------------------------------------------------------------
  // Shared notices — reachable from the question view AND the result view (R7)
  // -------------------------------------------------------------------------

  const notices = (
    <>
      {state.notice ? (
        <div className="ai-disclaimer" role="note">
          <AlertIcon size={16} />
          <p className="tiny">{state.notice}</p>
        </div>
      ) : null}

      {state.phase === "load_failed" && state.failure ? (
        <div className="stack stack--2">
          <div className="ai-disclaimer" role="alert">
            <AlertIcon size={16} />
            <p className="tiny">{state.failure.text}</p>
          </div>
          <div>
            <Button size="small" variant="secondary" onClick={() => void loadSnapshot("retry")}>
              Retry
            </Button>
          </div>
        </div>
      ) : null}

      {state.phase === "write_unknown" && state.intent?.error ? (
        <div className="stack stack--2">
          <div className="ai-disclaimer" role="alert">
            <AlertIcon size={16} />
            <p className="tiny">{state.intent.error}</p>
          </div>
          <div>
            <Button size="small" variant="secondary" onClick={() => void retryPending()}>
              Retry
            </Button>
          </div>
        </div>
      ) : null}

      {state.phase === "refresh_failed" && state.failure?.kind === "refresh" ? (
        <div className="stack stack--2">
          <div className="ai-disclaimer" role="alert">
            <AlertIcon size={16} />
            <p className="tiny">{state.failure.text}</p>
          </div>
          <div>
            <Button size="small" variant="secondary" onClick={() => void retryRefresh()}>
              Retry refresh
            </Button>
          </div>
        </div>
      ) : null}

      {state.phase === "write_in_flight" || state.phase === "refresh_in_flight" ? (
        <div className="ai-disclaimer" role="status">
          <AlertIcon size={16} />
          <p className="tiny">
            {state.phase === "refresh_in_flight"
              ? "Confirming your saved state…"
              : pendingLabel(state.intent)}
          </p>
        </div>
      ) : null}
    </>
  );

  // -------------------------------------------------------------------------
  // Settled non-editable phases
  // -------------------------------------------------------------------------

  if (appData?.status === "loading" || state.phase === "loading") {
    return (
      <div className="stack stack--3" role="status">
        <p className="dim">Loading practice test…</p>
      </div>
    );
  }

  if (state.phase === "load_failed") {
    return <div className="stack stack--3">{notices}</div>;
  }

  if (state.phase === "unavailable") {
    return (
      <div className="stack stack--3">
        <div className="ai-disclaimer" role="note">
          <AlertIcon size={16} />
          <p className="tiny">
            No saved practice test is available for this material yet. Create or regenerate the
            practice test to start practicing — practice questions come only from your saved
            content, never from unsaved fallbacks.
          </p>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Completed result: immutable, and still shows pending recovery (R7)
  // -------------------------------------------------------------------------

  if (state.completedResult !== null) {
    const result = state.completedResult;
    const disclaimer = `Practice result from your material (${result.scorePercent}%). Not an official FAA knowledge test score or certification of flight readiness.`;
    // Only an acknowledged completion of the attempt this panel ran, on its own
    // frozen version, links to that exact attempt's review.
    const reviewHistoryKey =
      state.phase === "completed" &&
      result.attemptId &&
      state.attempt?.attemptId === result.attemptId &&
      state.version?.id === state.attempt.versionId
        ? state.version.historyKey
        : null;
    return (
      <div className="stack stack--4" role="status">
        {notices}
        <div className="stack stack--2">
          <p className="eyebrow">Practice test complete</p>
          <h3 className="ai-guide__title">
            {result.correctCount} of {result.totalQuestions} correct
          </h3>
        </div>

        <div className="row row--wrap row--gap-2">
          <Badge tone="complete">{result.correctCount} correct</Badge>
          <Badge tone="overdue">{result.incorrectCount} incorrect</Badge>
          <Badge tone="neutral">{result.dontKnowCount} don’t know</Badge>
          <Badge tone="due">{result.unansweredCount} unanswered</Badge>
        </div>

        <div className="ai-disclaimer" role="note">
          <AlertIcon size={16} />
          <p className="tiny">{disclaimer}</p>
        </div>

        <div className="row row--wrap row--gap-2">
          <Button onClick={handleRetake} disabled={state.phase !== "completed"}>
            Retake this test
          </Button>
          {reviewHistoryKey && (
            <a
              href={`#${attemptReviewPath(reviewHistoryKey, result.attemptId, "missed")}`}
              className="button button--secondary"
            >
              {entrySummary ? "Short saved review" : "Review missed or skipped questions"}
            </a>
          )}
          {materialId && (
            <a
              href={`#/study/history/${encodeURIComponent(materialId)}`}
              className="button button--secondary"
            >
              View practice history
            </a>
          )}
        </div>
      </div>
    );
  }

  if (state.attempt && state.freshVersionId && state.attempt.versionId !== state.freshVersionId && continuedOlderAttempt !== state.attempt.attemptId) {
    return <div className="stack stack--4">
      {notices}
      <p>The questions have changed since you started this attempt.</p>
      <p className="small muted">Starting fresh marks the earlier attempt abandoned and keeps its saved answers.</p>
      <div><Button variant="primary" disabled={!canEdit} onClick={() => {
        if (!state.attempt || !state.freshVersionId) return;
        void beginIntent({ payload: {
          action: "retake_attempt", operationId: crypto.randomUUID(), materialId,
          versionId: state.freshVersionId, expectedAttemptId: state.attempt.attemptId,
        }, heldAnswer: null });
      }}>Start a fresh test</Button></div>
      <div><Button variant="secondary" disabled={!canEdit} onClick={() => setContinuedOlderAttempt(state.attempt!.attemptId)}>Continue earlier attempt</Button></div>
    </div>;
  }

  if (!question) return <div className="stack stack--3">{notices}</div>;

  const chosenOptionText = shownDontKnow
    ? "I don't know"
    : shownChoice !== null && shownChoice !== undefined && question.options[shownChoice]
      ? question.options[shownChoice]
      : "Not answered";
  const correctOptionText = question.options[question.correctIndex] ?? "";
  const askGeminiContext = practiceAskContext(question, chosenOptionText, correctOptionText);
  const currentMaterial = appData?.data?.materials?.find((m) => m.id === materialId);

  return (
    <div className="stack stack--3" aria-labelledby="practice-test-title">
      {notices}

      {entrySummary ? <div className="row row--wrap">
        {!state.attempt && startHeld ? <p className="small muted">{startHeld}</p> : !state.attempt ? <Button variant="primary" disabled={!canEdit} onClick={() => {
          if (state.version) void beginIntent({ payload: { action: "start_or_resume", operationId: crypto.randomUUID(), materialId, versionId: state.version.id }, heldAnswer: null });
        }}>Start practice test</Button> : null}
        <ShortSavedReviewLink materialId={materialId} />
      </div> : null}

      {/* Deliberate start/resume: an attempt is acknowledged before an answer sticks. */}
      <div className="ai-disclaimer" role="status">
        <AlertIcon size={16} />
        <p className="tiny">
          {state.attempt
            ? `Resuming your attempt — ${answeredCount} of ${totalQuestions} answered. Feedback appears after each answer is saved.`
            : "New attempt — your first answer starts it, and saves only once it is confirmed."}
        </p>
      </div>

      {totalQuestions > 1 && (
        <div className="practice-nav-pills" role="navigation" aria-label="Question selector">
          {questions.map((itm, qIdx) => {
            const resp = state.attempt?.responses.find((r) => r.itemId === itm.id);
            let pillClass = "practice-pill";
            if (resp) pillClass += resp.isCorrect ? " practice-pill--correct" : " practice-pill--incorrect";
            if (qIdx === state.index) pillClass += " practice-pill--current";

            return (
              <button
                key={itm.id ?? qIdx}
                type="button"
                className={pillClass}
                disabled={!canEdit}
                aria-label={`Question ${qIdx + 1}, ${resp ? (resp.isDontKnow ? "not quite, don’t know" : resp.isCorrect ? "correct" : "not quite") : "unanswered"}`}
                aria-current={qIdx === state.index ? "true" : undefined}
                onClick={() => goToIndex(qIdx)}
              >
                {qIdx + 1}
              </button>
            );
          })}
        </div>
      )}

      <div className="row row--between">
        <h3 ref={questionHeadingRef} tabIndex={-1} id="practice-test-title" className="ai-guide__title">
          Question {state.index + 1} of {totalQuestions}
        </h3>
        <SourcePageBadge source={question.pageSource} page={question.sourcePage} materialId={materialId} />
      </div>

      <PdfItemLabel sectionLabelled={practiceTest.questions.every((item) => item.pdfProvenance?.status === "valid")} provenance={question.pdfProvenance} origin={question.origin} />
      <p className="small ai-copy">{question.questionText}</p>
      <AcsTaskChip code={question.acsTask} />

      <div className="stack stack--2" role="radiogroup" aria-label="Answer choices">
        {question.options.map((option, optionIndex) => {
          const isChosen = shownChoice === optionIndex && !shownDontKnow;
          const isTheCorrectAnswer = optionIndex === question.correctIndex;
          let tone: "default" | "correct" | "incorrect" = "default";
          let ariaLabel = option;

          if (revealed) {
            if (isTheCorrectAnswer) {
              tone = "correct";
              ariaLabel = `${option} (Correct answer)`;
            } else if (isChosen) {
              tone = "incorrect";
              ariaLabel = `${option} (Your answer, incorrect)`;
            }
          }

          const isRadioDisabled = !canEdit || revealed;

          return (
            <button
              key={optionIndex}
              ref={(el) => {
                optionRefs.current[optionIndex] = el;
              }}
              type="button"
              role="radio"
              aria-checked={isChosen}
              aria-label={ariaLabel}
              tabIndex={isRadioDisabled ? -1 : optionIndex === state.focusIndex ? 0 : -1}
              disabled={isRadioDisabled}
              className={`practice-option practice-option--${tone}`}
              onClick={() => handleSelectOption(optionIndex)}
              onFocus={() =>
                dispatch({ type: "focused", generation: generationRef.current, focusIndex: optionIndex })
              }
              onKeyDown={(e) => handleKeyDown(e, optionIndex)}
            >
              {option}
            </button>
          );
        })}
      </div>

      {!revealed && (
        <div className="row row--between">
          <Button size="small" variant="ghost" disabled={!canEdit} onClick={handleDontKnow}>
            I don’t know
          </Button>

          {state.index + 1 < totalQuestions && (
            <Button
              size="small"
              variant="ghost"
              disabled={!canEdit}
              onClick={() => goToIndex(state.index + 1)}
            >
              Skip for now →
            </Button>
          )}
        </div>
      )}

      {revealed && (
        <div className="stack stack--2" role="region" aria-live="polite" aria-label="Question result">
          <div className="row row--wrap row--gap-2" style={{ alignItems: "center" }}>
            <Badge tone={shownDontKnow ? "due" : isCorrect ? "complete" : "overdue"}>
              {shownDontKnow ? "Marked as don’t know" : isCorrect ? "Correct" : "Not quite"}
            </Badge>
            <Button size="small" variant="ghost" disabled={!canEdit} onClick={handleChangeAnswer}>
              Change answer
            </Button>
          </div>

          <p className="tiny dim ai-copy">{question.explanation}</p>

          <AskGeminiPanel
            key={`${state.version?.id}:${question.id}`}
            materialId={materialId}
            relativePath={currentMaterial?.filePath ?? null}
            context={askGeminiContext}
            sourcePage={question.sourcePage ?? null}
            contextNoun="question"
            initialQuestion="Why is that the correct answer?"
          />
        </div>
      )}

      {showContinue && (
        <div className="row row--between" style={{ marginTop: "var(--space-2)" }}>
          <Button
            ref={actionButtonRef}
            variant="primary"
            disabled={!canEdit || confirmedResponse === undefined}
            onClick={handleContinue}
          >
            {state.index + 1 < totalQuestions ? "Continue" : "See score"}
          </Button>

          {answeredCount > 0 && answeredCount < totalQuestions && (
            <Button size="small" variant="secondary" disabled={!canEdit} onClick={handleComplete}>
              Complete test now ({totalQuestions - answeredCount} unanswered)
            </Button>
          )}
        </div>
      )}

      {state.attempt && (
        <div
          style={{
            marginTop: "var(--space-4)",
            borderTop: "1px dashed var(--border-subtle)",
            paddingTop: "var(--space-2)",
          }}
        >
          <Button
            size="small"
            variant="ghost"
            disabled={!canEdit}
            onClick={() => setConfirmingAbandon(true)}
          >
            Abandon attempt
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmingAbandon}
        title="Abandon this practice attempt?"
        message="This will mark the current in-progress attempt as abandoned. Completed attempts remain in your history."
        confirmLabel="Abandon attempt"
        destructive={true}
        pending={state.phase === "write_in_flight" || state.phase === "write_unknown"}
        pendingLabel="Abandoning…"
        onConfirm={handleAbandon}
        onCancel={() => setConfirmingAbandon(false)}
      />
    </div>
  );
}
