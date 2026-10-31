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
  FlightSchool,
  FundGoal,
  Goal,
  JournalEntry,
  Milestone,
  NextAction,
  Note,
  PrepItem,
  Profile,
  Question,
  ScheduleEvent,
  StudyMaterial,
  AiStudySet,
  PracticeTest,
  Transaction,
  ToolkitState,
} from "@/domain/types";
import { defaultToolkitState } from "@/logic/toolkit";
import { hidePending } from "@/logic/pendingDeletes";
import { onSettleBeforeQuit, reportSettled } from "@/services/quit";
import type { DailyPlanState } from "@/logic/dailyPlan";
import type { Id } from "@/domain/types";
import { GeminiJobsProvider } from "./GeminiJobs";

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
  practiceTests: PracticeTest[];
  tags: string[];
  events: ScheduleEvent[];
  prepItems: PrepItem[];
  journalEntries: JournalEntry[];
  questions: Question[];
  notes: Note[];
  transactions: Transaction[];
  fundGoals: FundGoal[];
  flightSchools: FlightSchool[];
  toolkit: ToolkitState;
  /** A saved toolkit exists but could not be read; saves are refused. */
  toolkitUnreadable?: boolean;
  dailyPlan: DailyPlanState | null;
  homework?: import("@/domain/homework").HomeworkSnapshot[];
}

type Status = "loading" | "ready" | "error";

export interface MutateOptions {
  /**
   * Shown as `lastError` instead of the refresh error's own text when the
   * write succeeded but the screens could not reload.
   */
  refreshFailureMessage?: string;
  /** Called (before `mutate` resolves) when the write succeeded but the reload failed. */
  onRefreshError?: () => void;
}

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
  /**
   * Advances each time a freshly loaded snapshot is published (startup,
   * refresh, every completed mutation), never for an obsolete load. Views
   * that read the database outside `data` use it to know their reads are out
   * of date, whatever changed: counts and timestamps are not content.
   */
  dataRevision: number;
  repositories: Repositories | null;
  /** Run a write and refresh. Returns null if the write failed. */
  mutate: <T>(work: (repos: Repositories) => Promise<T>, options?: MutateOptions) => Promise<T | null>;
  refresh: () => Promise<void>;
  /**
   * Delete after a short pause, so it can be taken back.
   *
   * The record disappears from the interface at once and is removed for real
   * when the window closes. See logic/pendingDeletes.
   */
  deleteWithUndo: (request: PendingDelete) => void;
  /** What is currently deletable-back, if anything. */
  pendingDelete: { label: string; ids: Id[] } | null;
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
  practiceTests: [],
  tags: [],
  events: [],
  prepItems: [],
  journalEntries: [],
  questions: [],
  notes: [],
  transactions: [],
  fundGoals: [],
  flightSchools: [],
  toolkit: defaultToolkitState(),
  dailyPlan: null,
  homework: [],
};

export const AppDataContext = createContext<AppDataContextValue | null>(null);

async function loadAll(repositories: Repositories): Promise<AppData> {
  const [
    profile,
    milestones,
    goals,
    checklistItems,
    actions,
    materials,
    aiStudySets,
    practiceTests,
    tags,
    events,
    prepItems,
    journalEntries,
    questions,
    notes,
    transactions,
    fundGoals,
    flightSchools,
    toolkit,
    toolkitUnreadable,
    dailyPlan,
    homework,
  ] = await Promise.all([
    repositories.profile.get(),
    repositories.milestones.list(),
    repositories.goals.list(),
    repositories.goals.listChecklistItems(),
    repositories.actions.list(),
    repositories.documents.list(),
    repositories.documents.listAiStudySets(),
    repositories.documents.listPracticeTests(),
    repositories.documents.listTags(),
    repositories.schedule.list(),
    repositories.schedule.listPrepItems(),
    repositories.journal.list(),
    repositories.questions.list(),
    repositories.notes.list(),
    repositories.finance.list(),
    repositories.finance.listFundGoals(),
    repositories.flightSchools.list(),
    repositories.toolkit.get(),
    repositories.toolkit.isUnreadable(),
    repositories.app.getDailyPlanState(),
    repositories.homework.listSnapshots(),
  ]);

  return {
    profile,
    milestones,
    goals,
    checklistItems,
    actions,
    materials,
    aiStudySets,
    practiceTests,
    tags,
    events,
    prepItems,
    journalEntries,
    questions,
    notes,
    transactions,
    fundGoals,
    flightSchools,
    toolkit,
    toolkitUnreadable,
    dailyPlan,
    homework,
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
  const [snapshot, setSnapshot] = useState<{ data: AppData; revision: number }>({ data: EMPTY_DATA, revision: 0 });
  const data = snapshot.data;
  const [pending, setPending] = useState<PendingDelete | null>(null);
  const repositoriesRef = useRef<Repositories | null>(null);
  const startupRef = useRef<Promise<AppData> | null>(null);
  const pendingRef = useRef<PendingDelete | null>(null);
  const undoTimerRef = useRef<number | null>(null);

  const writeQueue = useRef(Promise.resolve());
  const refreshVersion = useRef(0);
  // Whether a refresh has already published; the startup load is older then.
  const refreshPublished = useRef(false);
  const publish = useCallback((loaded: AppData) => {
    setSnapshot((current) => ({ data: loaded, revision: current.revision + 1 }));
  }, []);

  const refresh = useCallback(async () => {
    const repositories = repositoriesRef.current;
    if (!repositories) return;
    const version = ++refreshVersion.current;
    const loaded = await loadAll(repositories);
    if (version === refreshVersion.current) {
      refreshPublished.current = true;
      publish(loaded);
    }
  }, [publish]);

  useEffect(() => {
    let cancelled = false;

    if (!startupRef.current) {
      startupRef.current = (async () => {
        const db = await getDatabase();
        const repositories = createRepositories(db);
        repositoriesRef.current = repositories;
        await initializeAirlineStarterPack(repositories);
        void repositories.app.ensureDeviceId().catch(() => {});
        return loadAll(repositories);
      })();
    }

    startupRef.current
      .then((loaded) => {
        if (cancelled) return;
        if (!refreshPublished.current) publish(loaded);
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
  }, [publish]);

  const mutate = useCallback(
    async <T,>(
      work: (repos: Repositories) => Promise<T>,
      options?: MutateOptions,
    ): Promise<T | null> => {
      const repositories = repositoriesRef.current;
      if (!repositories) return null;
      const run = async (): Promise<T | null> => {
        let result: T;
        try {
          result = await work(repositories);
        } catch (mutationError) {
          setLastError(describeError(mutationError));
          return null;
        }
        // The write has happened and cannot be taken back. Reloading is how the
        // screens catch up with it, and that can fail on its own — a stale
        // screen is worth saying, but it is not a failed save. Callers undo
        // their own work when this returns null (the split dialog deletes the
        // chapter file it just wrote), so null has to mean the write failed.
        try {
          await refresh();
          setLastError(null);
        } catch (refreshError) {
          setLastError(options?.refreshFailureMessage ?? describeError(refreshError));
          options?.onRefreshError?.();
        }
        return result;
      };
      // Repository updates read then write whole rows. Keep user mutations in order.
      const queued = writeQueue.current.then(run);
      writeQueue.current = queued.then(
        () => undefined,
        () => undefined,
      );
      return queued;
    },
    [refresh],
  );

  /** Carry out the waiting deletion now. */
  const commitPending = useCallback(async () => {
    const waiting = pendingRef.current;
    if (!waiting) return;
    pendingRef.current = null;
    if (undoTimerRef.current !== null)
      window.clearTimeout(undoTimerRef.current);
    undoTimerRef.current = null;
    setPending(null);
    await mutate(waiting.run);
  }, [mutate]);

  // Quitting (QUIT-01): carry out a deletion still in its Undo window, let
  // every queued write finish, then tell the Rust side it may quit. The
  // answer goes even if something failed, so quitting never waits on an
  // error; Rust gives up after two seconds anyway.
  useEffect(() => {
    let settling = false;
    const stop = onSettleBeforeQuit(async () => {
      if (settling) return;
      settling = true;
      try {
        await commitPending();
        await writeQueue.current;
      } finally {
        void reportSettled().catch(() => undefined);
      }
    }).catch(() => () => {});
    return () => {
      void stop.then((unlisten) => unlisten());
    };
  }, [commitPending]);

  const deleteWithUndo = useCallback(
    (request: PendingDelete) => {
      // One pending deletion at a time: a second one settles the first.
      void commitPending();
      pendingRef.current = request;
      setPending(request);
      undoTimerRef.current = window.setTimeout(
        () => void commitPending(),
        UNDO_WINDOW_MS,
      );
    },
    [commitPending],
  );

  const undoDelete = useCallback(() => {
    if (undoTimerRef.current !== null)
      window.clearTimeout(undoTimerRef.current);
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
      dataRevision: snapshot.revision,
      repositories: repositoriesRef.current,
      mutate,
      refresh,
      deleteWithUndo,
      pendingDelete: pending ? { label: pending.label, ids: pending.ids } : null,
      undoDelete,
      lastError,
      clearError: () => setLastError(null),
    }),
    [
      status,
      error,
      visibleData,
      snapshot.revision,
      mutate,
      refresh,
      deleteWithUndo,
      pending,
      undoDelete,
      lastError,
    ],
  );

  return (
    <AppDataContext.Provider value={value}>
      <GeminiJobsProvider
        data={data}
        ready={status === "ready"}
        mutate={mutate}
        repositories={repositoriesRef.current}
      >
        {children}
      </GeminiJobsProvider>
    </AppDataContext.Provider>
  );
}

export function useAppData(): AppDataContextValue {
  const context = useContext(AppDataContext);
  if (!context)
    throw new Error("useAppData must be used inside AppDataProvider");
  return context;
}

/** The app data when inside AppDataProvider, or null (for parts that also render standalone). */
export function useOptionalAppData(): AppDataContextValue | null {
  return useContext(AppDataContext);
}
