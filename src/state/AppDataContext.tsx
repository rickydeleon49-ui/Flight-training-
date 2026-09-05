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
  Transaction,
} from "@/domain/types";

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
  tags: string[];
  events: ScheduleEvent[];
  prepItems: PrepItem[];
  journalEntries: JournalEntry[];
  questions: Question[];
  transactions: Transaction[];
  fundGoals: FundGoal[];
}

type Status = "loading" | "ready" | "error";

interface AppDataContextValue {
  status: Status;
  /** Fatal load error. Mutation problems surface through `lastError`. */
  error: string | null;
  data: AppData;
  repositories: Repositories | null;
  /** Run a write and refresh. Returns null if the write failed. */
  mutate: <T>(work: (repos: Repositories) => Promise<T>) => Promise<T | null>;
  refresh: () => Promise<void>;
  lastError: string | null;
  clearError: () => void;
}

const EMPTY_PROFILE: Profile = {
  id: "profile",
  pilotName: "",
  certificateGoal: "Private Pilot",
  currentFocus: "",
  currentMilestoneId: null,
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
  tags: [],
  events: [],
  prepItems: [],
  journalEntries: [],
  questions: [],
  transactions: [],
  fundGoals: [],
};

const AppDataContext = createContext<AppDataContextValue | null>(null);

async function loadAll(repositories: Repositories): Promise<AppData> {
  const [
    profile, milestones, goals, checklistItems, actions, materials, tags,
    events, prepItems, journalEntries, questions, transactions, fundGoals,
  ] = await Promise.all([
    repositories.profile.get(),
    repositories.milestones.list(),
    repositories.goals.list(),
    repositories.goals.listChecklistItems(),
    repositories.actions.list(),
    repositories.documents.list(),
    repositories.documents.listTags(),
    repositories.schedule.list(),
    repositories.schedule.listPrepItems(),
    repositories.journal.list(),
    repositories.questions.list(),
    repositories.finance.list(),
    repositories.finance.listFundGoals(),
  ]);

  return {
    profile, milestones, goals, checklistItems, actions, materials, tags,
    events, prepItems, journalEntries, questions, transactions, fundGoals,
  };
}

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : "Something went wrong.";

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [data, setData] = useState<AppData>(EMPTY_DATA);
  const repositoriesRef = useRef<Repositories | null>(null);

  const refresh = useCallback(async () => {
    const repositories = repositoriesRef.current;
    if (!repositories) return;
    setData(await loadAll(repositories));
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const db = await getDatabase();
        const repositories = createRepositories(db);
        repositoriesRef.current = repositories;
        const loaded = await loadAll(repositories);
        if (cancelled) return;
        setData(loaded);
        setStatus("ready");
      } catch (loadError) {
        if (cancelled) return;
        setError(describeError(loadError));
        setStatus("error");
      }
    })();

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

  const value = useMemo<AppDataContextValue>(
    () => ({
      status,
      error,
      data,
      repositories: repositoriesRef.current,
      mutate,
      refresh,
      lastError,
      clearError: () => setLastError(null),
    }),
    [status, error, data, mutate, refresh, lastError],
  );

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData(): AppDataContextValue {
  const context = useContext(AppDataContext);
  if (!context) throw new Error("useAppData must be used inside AppDataProvider");
  return context;
}
