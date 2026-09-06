import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

import { getDatabase } from "@/data";
import { createRepositories, type Repositories } from "@/data/repositories";
import { initializeAirlineStarterPack } from "@/data/starter";
import type {
  ChecklistItem,
  FundGoal,
  Goal,
  JournalEntry,
  Milestone,
  NextAction,
  PrepItem,
  Profile,
  Question,
  ScheduleEvent,
  StudyMaterial,
  AiStudySet,
  Transaction,
  ToolkitState,
} from "@/domain/types";
import { DEFAULT_TOOLKIT_STATE } from "@/logic/toolkit";
import { hidePending } from "@/logic/pendingDeletes";
import type { Id } from "@/domain/types";

/**
 * Everything the application knows about, held in memory.
 *
 * A personal training record is small — hundreds of rows, not millions — so
 * loading it once keeps every cross-cutting view (a dashboard that needs
 * lessons, actions, materials and money at the same time) simple and fast.
 * All reads and writes still go through repositories.
 */
export interface AppData {
  profile: Profile;
  milestones: Milestone[];
  goals: Goal[];
  checklistItems: ChecklistItem[];
  actions: NextAction[];
  materials: StudyMaterial[];
  aiStudySets: AiStudySet[];
  tags: string[];
  events: ScheduleEvent[];
  prepItems: PrepItem[];
  journalEntries: JournalEntry[];
  questions: Question[];
  transactions: Transaction[];
  fundGoals: FundGoal[];
  toolkit: ToolkitState;
}

type Status = "loading" | "ready" | "error";

/** How long "Undo" stays available after a deletion is confirmed. */
export const UNDO_WINDOW_MS = 7000;

interface PendingDelete {
  /** Records to hide while the window is open. */
  ids: Id[];
  /** What the undo bar says was removed, e.g. "Crosswind landings". */
  label: string;
  run: (repos: Repositories) => Promise<unknown>;
}

interface AppDataContextValue {
  status: Status;
  /** Fatal load error. Mutation problems surface through `lastError`. */
  error: string | null;
  data: AppData;
  repositories: Repositories | null;
  /** Run a write and refresh. Returns null if the write failed. */
  mutate: <T>(work: (repos: Repositories) => Promise<T>) => Promise<T | null>;
  refresh: () => Promise<void>;
  /**
   * Delete after a short pause, so it can be taken back.
   *
   * The record disappears from the interface at once and is removed for real
   * when the window closes. See logic/pendingDeletes.
   */
  deleteWithUndo: (request: PendingDelete) => void;
  /** What is currently deletable-back, if anything. */
  pendingDelete: { label: string } | null;
  undoDelete: () => void;
  lastError: string | null;
  clearError: () => void;
}

const EMPTY_PROFILE: Profile = {
  id: "profile",
  pilotName: "",
  certificateGoal: "Private Pilot",
  currentFocus: "",
  currentMilestoneId: null,
  flightSchool: "",
  instructorName: "",
  homeAirport: "",
  aircraftType: "",
  trainingStartedOn: null,
  medicalExpiry: null,
  whyNote: "",
  photo: null,
  accentColor: "berry",
  createdAt: "",
  updatedAt: "",
};

export const EMPTY_DATA: AppData = {
  profile: EMPTY_PROFILE,
  milestones: [],
  goals: [],
  checklistItems: [],
  actions: [],
  materials: [],
  aiStudySets: [],
  tags: [],
  events: [],
  prepItems: [],
  journalEntries: [],
  questions: [],
  transactions: [],
  fundGoals: [],
  toolkit: DEFAULT_TOOLKIT_STATE,
};

const AppDataContext = createContext<AppDataContextValue | null>(null);

async function loadAll(repositories: Repositories): Promise<AppData> {
  const [
    profile, milestones, goals, checklistItems, actions, materials, aiStudySets, tags,
    events, prepItems, journalEntries, questions, transactions, fundGoals, toolkit,
  ] = await Promise.all([
    repositories.profile.get(),
    repositories.milestones.list(),
    repositories.goals.list(),
    repositories.goals.listChecklistItems(),
    repositories.actions.list(),
    repositories.documents.list(),
    repositories.documents.listAiStudySets(),
    repositories.documents.listTags(),
    repositories.schedule.list(),
    repositories.schedule.listPrepItems(),
    repositories.journal.list(),
    repositories.questions.list(),
    repositories.finance.list(),
    repositories.finance.listFundGoals(),
    repositories.toolkit.get(),
  ]);

  return {
    profile, milestones, goals, checklistItems, actions, materials, aiStudySets, tags,
    events, prepItems, journalEntries, questions, transactions, fundGoals, toolkit,
  };
}

/**
 * Turn whatever was thrown into something worth reading.
 *
 * Errors crossing the Tauri boundary arrive as plain strings rather than
 * Error instances, so narrowing only on Error discarded the one useful
 * detail — the database's own message — and left "Something went wrong."
 */
function describeError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return "Something went wrong.";
}

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [data, setData] = useState<AppData>(EMPTY_DATA);
  const [pending, setPending] = useState<PendingDelete | null>(null);
  const repositoriesRef = useRef<Repositories | null>(null);
  const startupRef = useRef<Promise<AppData> | null>(null);
  const pendingRef = useRef<PendingDelete | null>(null);
  const undoTimerRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    const repositories = repositoriesRef.current;
    if (!repositories) return;
    setData(await loadAll(repositories));
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!startupRef.current) {
      startupRef.current = (async () => {
        const db = await getDatabase();
        const repositories = createRepositories(db);
        repositoriesRef.current = repositories;
        await initializeAirlineStarterPack(repositories);
        return loadAll(repositories);
      })();
    }

    startupRef.current
      .then((loaded) => {
        if (cancelled) return;
        setData(loaded);
        setStatus("ready");
      })
      .catch((loadError) => {
        if (cancelled) return;
        setError(describeError(loadError));
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const mutate = useCallback(
    async <T,>(work: (repos: Repositories) => Promise<T>): Promise<T | null> => {
      const repositories = repositoriesRef.current;
      if (!repositories) return null;
      try {
        const result = await work(repositories);
        await refresh();
        setLastError(null);
        return result;
      } catch (mutationError) {
        setLastError(describeError(mutationError));
        return null;
      }
    },
    [refresh],
  );

  /** Carry out the waiting deletion now. */
  const commitPending = useCallback(async () => {
    const waiting = pendingRef.current;
    if (!waiting) return;
    pendingRef.current = null;
    if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);
    undoTimerRef.current = null;
    setPending(null);
    await mutate(waiting.run);
  }, [mutate]);

  const deleteWithUndo = useCallback(
    (request: PendingDelete) => {
      // One pending deletion at a time: a second one settles the first.
      void commitPending().then(() => {
        pendingRef.current = request;
        setPending(request);
        undoTimerRef.current = window.setTimeout(() => void commitPending(), UNDO_WINDOW_MS);
      });
    },
    [commitPending],
  );

  const undoDelete = useCallback(() => {
    if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);
    undoTimerRef.current = null;
    pendingRef.current = null;
    setPending(null);
  }, []);

  // A record that is about to go is already gone as far as the screens know.
  const visibleData = useMemo(
    () => (pending ? hidePending(data, new Set(pending.ids)) : data),
    [data, pending],
  );

  const value = useMemo<AppDataContextValue>(
    () => ({
      status,
      error,
      data: visibleData,
      repositories: repositoriesRef.current,
      mutate,
      refresh,
      deleteWithUndo,
      pendingDelete: pending ? { label: pending.label } : null,
      undoDelete,
      lastError,
      clearError: () => setLastError(null),
    }),
    [status, error, visibleData, mutate, refresh, deleteWithUndo, pending, undoDelete, lastError],
  );

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData(): AppDataContextValue {
  const context = useContext(AppDataContext);
  if (!context) throw new Error("useAppData must be used inside AppDataProvider");
  return context;
}
