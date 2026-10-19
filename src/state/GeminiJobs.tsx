import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { AppData } from "./AppDataContext";
import type { Repositories } from "@/data/repositories";
import type { AiStudySet, PracticeTest } from "@/domain/types";
import {
  acknowledgeGeminiJob,
  generatePracticeTest,
  generateStudyAid,
  geminiErrorMessage,
  listGeminiJobs,
  watchGeminiJobs,
  watchGeminiProgress,
  cancelGeminiJob,
  GEMINI_CANCELLED_MESSAGE,
  type GeminiJobKind,
  type GeminiProgressEvent,
  type GeminiWorkStage,
  type GeminiJobRecord,
  type GeneratedPracticeTest,
  type GeneratedStudyAid,
} from "@/services/gemini";

/**
 * Gemini generations that outlive the page that started them (GEN-REL-02).
 *
 * A study aid or practice test used to belong to its material page: leaving the
 * page threw a finished answer away. Now a generation belongs to the app. It
 * keeps running while she reads something else, and its answer is saved to the
 * material it was made from, only if, at the moment of saving and inside the
 * write queue:
 *
 * - the material still exists with the same file;
 * - the stored bytes are still the bytes Gemini read (SHA-256);
 * - nothing else has been saved over the content she asked to replace (the
 *   saved `updatedAt` is still the one recorded when she asked).
 *
 * Otherwise it is not saved, and she is told. An answer that is already the
 * saved content (a save that committed before the app closed, but whose job
 * was not yet forgotten) is recognized and never saved twice.
 *
 * One generation runs at a time, whichever page asked; the lock is taken
 * synchronously before anything awaits. A finished answer is a checkpoint:
 * "Save again" uses it without asking Gemini again. After a reload or restart,
 * the native journal is read back before anything new may start. A finished
 * answer waits for her to save or discard it. A generation cut off by the app
 * closing is shown as interrupted and never resent by itself.
 */

export type GeminiJobPhase =
  | "running"
  | "saving"
  | "save-failed"
  | "failed"
  | "superseded"
  | "recovered"
  | "interrupted"
  | "discarding"
  | "discard-failed"
  | "cancelled";

type Answer = GeneratedStudyAid | GeneratedPracticeTest;

export interface GeminiJob {
  /** This window's own identity for the job. */
  key: string;
  /** The native journal's identity, once known. */
  jobId: string | null;
  kind: GeminiJobKind;
  materialId: string;
  filePath: string;
  phase: GeminiJobPhase;
  progress: string | null;
  error: string | null;
  answer: Answer | null;
  /** SHA-256 of exactly the bytes that were sent, when Gemini reported it. */
  contentSha256: string | null;
  /** The saved content's `updatedAt` when she asked, or null if none. */
  baseRevision: string | null;
  /** False when the answer could not be written down natively. */
  checkpointed: boolean;
  /** The stage actually reached, from the job's own progress (GEN-REL-04). */
  stage?: GeminiWorkStage | null;
  /** The generation attempt in progress, and how many may be made. */
  attempt?: number;
  maxAttempts?: number;
  /** When this window started it (ms since the epoch), for an honest elapsed time. */
  startedAt?: number;
  /** A cancel is on its way to (or held by) the native side. */
  cancelRequested?: boolean;
  /** She pressed Cancel at some point: an answer that still arrives is never saved by itself. */
  cancelAttempted?: boolean;
  /** Why her cancel did not go through, if it did not; Cancel works again. */
  cancelError?: string | null;
  /** This window's own id for the request, which cancel goes by (GEN-REL-04). */
  requestId?: string;
  /** Whether the generation request has been sent to the native side. */
  invoked?: boolean;
  /**
   * Started by this window, whose own request decides its outcome. Recovery
   * after a reload follows only jobs it found, never these, even once they
   * have their native id.
   */
  local?: boolean;
}

export interface GeminiJobTarget {
  materialId: string;
  filePath: string;
}

export interface StartOptions {
  /** Checks made after the lock is taken; a message means "do not send". */
  preflight?: () => Promise<string | null>;
  /** Called once the answer is saved, for the page that is still showing it. */
  onSaved?: () => void;
}

/** Whether earlier Gemini work has been read back from the journal yet. */
export type GeminiRecovery = "pending" | "ready" | "failed";

interface GeminiJobsValue {
  jobs: GeminiJob[];
  /** True while any generation is running or being saved. */
  busy: boolean;
  /** The lock as it is right now, for event handlers that must not wait for a render. */
  locked(): boolean;
  recovery: GeminiRecovery;
  retryRecovery(): void;
  start(kind: GeminiJobKind, target: GeminiJobTarget, options?: StartOptions): Promise<void>;
  saveAgain(key: string): Promise<void>;
  dismiss(key: string): Promise<void>;
  /** Ask to cancel a running generation (GEN-REL-04). */
  cancel(key: string): Promise<void>;
}

const GeminiJobsContext = createContext<GeminiJobsValue | null>(null);

export const SUPERSEDED_MESSAGE =
  "This document changed or was removed while Gemini was working, so the new answer was not saved. Anything already saved is unchanged.";
export const NEWER_SAVED_MESSAGE =
  "Something newer was saved for this document while Gemini was working, so the new answer was not saved over it. Anything already saved is unchanged.";
const SAVE_FAILED_MESSAGE =
  "Gemini finished, but saving the answer did not work. Anything already saved is unchanged. Save again uses the same answer and does not ask Gemini again.";
export const DISCARD_FAILED_MESSAGE =
  "That could not be recorded just now, so it might come back after the app restarts. Try again.";
const SAVE_FAILED_NOT_KEPT_MESSAGE =
  "Gemini finished, but saving the answer did not work, and it could not be kept on this Mac either. Anything already saved is unchanged. Save again uses the same answer while the app stays open.";

/** Said when her cancel could not be recorded. */
export const CANCEL_FAILED_MESSAGE =
  "Cancelling did not go through, so Gemini is still working on it. Try Cancel again.";

function newRequestId(): string {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `req-${random}`;
}

/** Said when she cancelled before anything was sent. */
export const CANCELLED_BEFORE_SENDING = "Cancelled before anything was sent to Google. Nothing was saved.";

/** Whether a progress event is about this job: by id once known, otherwise by its material and output. */
function belongsTo(job: GeminiJob, event: GeminiProgressEvent): boolean {
  if (job.jobId && event.jobId) return job.jobId === event.jobId;
  return job.materialId === event.materialId && job.kind === event.kind;
}

/** While a job found running after a reload is followed, check this often. */
export const FOLLOW_INTERVAL_MS = 3000;

let nextKey = 1;
const newKey = () => `local-${nextKey++}`;

type Mutate = <T>(work: (repos: Repositories) => Promise<T>) => Promise<T | null>;

/** The same JSON, whatever the key order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Whether `saved` is exactly this answer: then it was already saved. */
function alreadySaved(kind: GeminiJobKind, saved: AiStudySet | PracticeTest | undefined, answer: Answer): boolean {
  if (!saved || saved.provider !== "gemini") return false;
  if (kind === "study-aid") {
    const s = saved as AiStudySet;
    const a = answer as GeneratedStudyAid;
    return (
      canonical([s.title, s.summary, s.sections, s.flashcards, s.sourceNotes, s.model]) ===
      canonical([a.title, a.summary, a.sections, a.flashcards, a.sourceNotes, a.model])
    );
  }
  const s = saved as PracticeTest;
  const a = answer as GeneratedPracticeTest;
  return canonical([s.title, s.questions, s.model]) === canonical([a.title, a.questions, a.model]);
}

async function savedContent(repos: Repositories, kind: GeminiJobKind, materialId: string) {
  return kind === "study-aid"
    ? (await repos.documents.listAiStudySets()).find((set) => set.sourceMaterialId === materialId)
    : (await repos.documents.listPracticeTests()).find((test) => test.sourceMaterialId === materialId);
}

interface Props {
  children: ReactNode;
  data: AppData;
  ready: boolean;
  mutate: Mutate;
  repositories: Repositories | null;
}

export function GeminiJobsProvider({ children, data, ready, mutate, repositories }: Props) {
  const [jobs, setJobs] = useState<GeminiJob[]>([]);
  const jobsRef = useRef<GeminiJob[]>([]);
  // The lock: the key of the running or saving job, set before any await.
  const activeRef = useRef<string | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  const repositoriesRef = useRef(repositories);
  repositoriesRef.current = repositories;
  const onSavedRef = useRef(new Map<string, () => void>());
  // Journal entries saved or dismissed here whose removal has not yet been
  // written down natively; retried until it is.
  const pendingAcksRef = useRef(new Set<string>());
  const [pendingAckCount, setPendingAckCount] = useState(0);
  // Journal entries this window has saved or dismissed: never shown again,
  // whatever an older snapshot says.
  const forgottenRef = useRef(new Set<string>());
  // Reconciliations run one at a time, in order.
  const reconcileChainRef = useRef<Promise<void>>(Promise.resolve());
  const [recovery, setRecovery] = useState<GeminiRecovery>("pending");
  const recoveryRef = useRef<GeminiRecovery>("pending");
  const [recoveryAttempt, setRecoveryAttempt] = useState(0);

  const commit = useCallback((next: GeminiJob[]) => {
    jobsRef.current = next;
    setJobs(next);
  }, []);

  const update = useCallback(
    (key: string, change: Partial<GeminiJob>) => {
      commit(jobsRef.current.map((job) => (job.key === key ? { ...job, ...change } : job)));
    },
    [commit],
  );

  const syncPendingCount = useCallback(() => setPendingAckCount(pendingAcksRef.current.size), []);

  /** Ask the journal to forget one job; true once it is written down. */
  const acknowledgeNow = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        await acknowledgeGeminiJob(id);
        pendingAcksRef.current.delete(id);
        syncPendingCount();
        return true;
      } catch {
        return false;
      }
    },
    [syncPendingCount],
  );

  /**
   * Retry acknowledgements that could not be written yet. They follow saves
   * whose content is already in the library: a restart before they succeed is
   * still safe, because an answer that is already the saved content is
   * recognized and never saved twice.
   */
  const flushAcks = useCallback(async () => {
    for (const id of [...pendingAcksRef.current]) await acknowledgeNow(id);
  }, [acknowledgeNow]);

  /** A saved answer: gone from view at once; the journal is told, with retries. */
  const forget = useCallback(
    (key: string) => {
      const job = jobsRef.current.find((candidate) => candidate.key === key);
      commit(jobsRef.current.filter((candidate) => candidate.key !== key));
      onSavedRef.current.delete(key);
      if (job?.jobId) {
        forgottenRef.current.add(job.jobId);
        pendingAcksRef.current.add(job.jobId);
        syncPendingCount();
        void flushAcks();
      }
    },
    [commit, flushAcks, syncPendingCount],
  );

  /** Save an answer to the material it was made from, if that is still right. */
  const persist = useCallback(
    async (key: string): Promise<void> => {
      const job = jobsRef.current.find((candidate) => candidate.key === key);
      if (!job?.answer) return;
      update(key, { phase: "saving", error: null });
      const answer = job.answer;

      let outcome: "saved" | "already" | "superseded" | "newer" | null;
      try {
        outcome = await mutate(async (repos) => {
          // Every check is made here, inside the write queue, immediately
          // before the write, so no queued change can slip in between.
          const materials = await repos.documents.list();
          const current = materials.find((material) => material.id === job.materialId);
          if (!current || current.filePath !== job.filePath) return "superseded" as const;
          if (job.contentSha256) {
            const fingerprints = await repos.documents.fingerprintDocuments([job.filePath]);
            if (fingerprints && fingerprints.get(job.filePath) !== job.contentSha256) {
              return "superseded" as const;
            }
          }
          const saved = await savedContent(repos, job.kind, job.materialId);
          if (alreadySaved(job.kind, saved, answer)) return "already" as const;
          if ((saved?.updatedAt ?? null) !== job.baseRevision) return "newer" as const;
          if (job.kind === "study-aid") {
            const aid = answer as GeneratedStudyAid;
            await repos.documents.saveAiStudySet({
              sourceMaterialId: job.materialId,
              title: aid.title,
              summary: aid.summary,
              sections: aid.sections,
              flashcards: aid.flashcards,
              sourceNotes: aid.sourceNotes,
              model: aid.model,
            });
          } else {
            const test = answer as GeneratedPracticeTest;
            await repos.documents.savePracticeTest({
              sourceMaterialId: job.materialId,
              title: test.title,
              questions: test.questions,
              model: test.model,
            });
          }
          return "saved" as const;
        });
      } catch {
        outcome = null;
      }

      if (outcome === "saved" || outcome === "already") {
        const onSaved = onSavedRef.current.get(key);
        forget(key);
        if (outcome === "saved") onSaved?.();
      } else if (outcome === "superseded" || outcome === "newer") {
        update(key, {
          phase: "superseded",
          error: outcome === "newer" ? NEWER_SAVED_MESSAGE : SUPERSEDED_MESSAGE,
        });
      } else {
        update(key, {
          phase: "save-failed",
          error: job.checkpointed ? SAVE_FAILED_MESSAGE : SAVE_FAILED_NOT_KEPT_MESSAGE,
        });
      }
    },
    [forget, mutate, update],
  );

  // The lock lives in a ref so it can be taken before any await; releasing it
  // also renders, so controls that depend on it (Try again) appear at once.
  const [lockTick, setLockTick] = useState(0);
  const release = useCallback((key: string) => {
    if (activeRef.current === key) {
      activeRef.current = null;
      setLockTick((n) => n + 1);
    }
  }, []);

  /**
   * Ask to cancel. The native journal decides, by the window's own request
   * id, so this works before the job's id is known and before the job has even
   * begun. Before the request is sent at all, the flag alone stops it.
   */
  const cancel = useCallback(
    async (key: string) => {
      const job = jobsRef.current.find((candidate) => candidate.key === key);
      if (!job || job.phase !== "running" || job.cancelRequested) return;
      update(key, { cancelRequested: true, cancelAttempted: true, cancelError: null });
      // Only this window's own request, not yet sent, is stopped by the flag
      // alone. A job recovered after a reload is cancelled by its job id.
      if (job.local && !job.invoked) return;
      const notAccepted = () => {
        // Not recorded and not held: say so, and let her try again while it
        // still runs.
        const now = jobsRef.current.find((candidate) => candidate.key === key);
        if (now?.phase === "running") update(key, { cancelRequested: false, cancelError: CANCEL_FAILED_MESSAGE });
      };
      let outcome: Awaited<ReturnType<typeof cancelGeminiJob>>;
      try {
        outcome = await cancelGeminiJob({ requestId: job.requestId, jobId: job.jobId ?? undefined });
      } catch {
        notAccepted();
        return;
      }
      // Recorded, or held until its job begins: the request's own result
      // will say how it ended. Already finished (ready, failed…): likewise.
      // Anything else means the cancel did not take.
      const settled = outcome.stage !== null && outcome.stage !== "running";
      if (!outcome.cancelled && !outcome.pending && !settled) notAccepted();
    },
    [update],
  );

  const start = useCallback(
    async (kind: GeminiJobKind, target: GeminiJobTarget, options?: StartOptions) => {
      // Take the shared lock synchronously, before anything awaits. Nothing
      // new starts until earlier work has been read back from the journal.
      if (activeRef.current !== null || recoveryRef.current !== "ready") return;
      // A draft waiting to be saved is never overwritten by asking again.
      const waiting = jobsRef.current.find(
        (job) =>
          job.materialId === target.materialId &&
          job.kind === kind &&
          (job.phase === "recovered" ||
            job.phase === "save-failed" ||
            job.phase === "discarding" ||
            job.phase === "discard-failed"),
      );
      if (waiting) return;
      const key = newKey();
      activeRef.current = key;
      // Asking again replaces this material's older outcome of the same kind.
      for (const old of jobsRef.current) {
        if (old.materialId === target.materialId && old.kind === kind) forget(old.key);
      }
      // What she is asking to replace, so nothing newer is ever overwritten.
      const saved =
        kind === "study-aid"
          ? dataRef.current.aiStudySets.find((set) => set.sourceMaterialId === target.materialId)
          : dataRef.current.practiceTests.find((test) => test.sourceMaterialId === target.materialId);
      const baseRevision = saved?.updatedAt ?? null;
      commit([
        ...jobsRef.current,
        {
          key,
          jobId: null,
          kind,
          materialId: target.materialId,
          filePath: target.filePath,
          phase: "running",
          progress: null,
          error: null,
          answer: null,
          contentSha256: null,
          baseRevision,
          checkpointed: false,
          stage: "preparing",
          attempt: 0,
          startedAt: Date.now(),
          cancelRequested: false,
          cancelAttempted: false,
          cancelError: null,
          requestId: newRequestId(),
          invoked: false,
          local: true,
        },
      ]);
      if (options?.onSaved) onSavedRef.current.set(key, options.onSaved);
      const current = () => jobsRef.current.find((job) => job.key === key);

      let stopWatching = () => {};
      try {
        const refusal = (await options?.preflight?.()) ?? null;
        if (refusal) {
          update(key, { phase: "failed", error: refusal });
          return;
        }
        try {
          stopWatching = await watchGeminiProgress((event) => {
            const job = current();
            if (!job || job.phase !== "running" || !belongsTo(job, event)) return;
            update(key, {
              jobId: event.jobId ?? job.jobId,
              stage: event.stage ?? job.stage,
              progress: event.message ?? job.progress,
              attempt: event.attempt,
              maxAttempts: event.maxAttempts,
            });
          });
        } catch {
          // Progress is a courtesy; generation goes ahead without it.
        }
        const generate = kind === "study-aid" ? generateStudyAid : generatePracticeTest;
        // Cancelled before anything was sent: nothing is sent. Checked here,
        // with no await before the request, so a cancel during any earlier step
        // (the checks, setting up progress) is never missed.
        if (current()?.cancelRequested) {
          update(key, { phase: "cancelled", error: CANCELLED_BEFORE_SENDING, stage: null });
          return;
        }
        update(key, { invoked: true });
        let answer: Awaited<ReturnType<typeof generate>>;
        try {
          answer = await generate(
            target.filePath,
            target.materialId,
            baseRevision ?? undefined,
            current()?.requestId,
          );
        } catch (error) {
          // Cancelled only if the native side says so: the journal decided.
          const message = geminiErrorMessage(error);
          const cancelled = message === GEMINI_CANCELLED_MESSAGE;
          update(key, {
            phase: cancelled ? "cancelled" : "failed",
            error: geminiErrorMessage(error),
            progress: null,
            stage: null,
          });
          // The window shows the outcome itself; the journal need not keep it.
          try {
            for (const record of await listGeminiJobs()) {
              if (
                record.materialId === target.materialId &&
                record.kind === kind &&
                (record.stage === "failed" || record.stage === "cancelled")
              ) {
                forgottenRef.current.add(record.id);
                pendingAcksRef.current.add(record.id);
              }
            }
            syncPendingCount();
            await flushAcks();
          } catch {
            // Bounded: a failed record is replaced by her next request anyway.
          }
          return;
        }
        const { jobId = null, contentSha256 = null, checkpointed = false, ...rest } = answer;
        // The answer arrived before her cancel could stop it. It is kept, but
        // never saved by itself: she decides.
        if (current()?.cancelAttempted) {
          update(key, {
            jobId,
            contentSha256,
            checkpointed: Boolean(checkpointed && jobId),
            answer: rest as Answer,
            progress: null,
            stage: null,
            phase: "recovered",
          });
          return;
        }
        update(key, {
          jobId,
          contentSha256,
          checkpointed: Boolean(checkpointed && jobId),
          answer: rest as Answer,
          progress: null,
          stage: null,
        });
        await persist(key);
      } finally {
        stopWatching();
        release(key);
      }
    },
    [commit, flushAcks, forget, persist, release, syncPendingCount, update],
  );

  const saveAgain = useCallback(
    async (key: string) => {
      const job = jobsRef.current.find((candidate) => candidate.key === key);
      if (!job || !job.answer || (job.phase !== "save-failed" && job.phase !== "recovered")) return;
      if (activeRef.current !== null) return;
      activeRef.current = key;
      try {
        await persist(key);
      } finally {
        release(key);
      }
    },
    [persist, release],
  );

  /**
   * Her decision to discard or dismiss: shown as done only once the journal
   * has recorded it, so a discarded answer cannot quietly come back.
   */
  const dismiss = useCallback(
    async (key: string) => {
      const job = jobsRef.current.find((candidate) => candidate.key === key);
      if (!job || job.phase === "running" || job.phase === "saving" || job.phase === "discarding") return;
      if (job.jobId === null) {
        forget(key);
        return;
      }
      update(key, { phase: "discarding" });
      if (await acknowledgeNow(job.jobId)) {
        forgottenRef.current.add(job.jobId);
        commit(jobsRef.current.filter((candidate) => candidate.key !== key));
        onSavedRef.current.delete(key);
      } else {
        update(key, { phase: "discard-failed", error: DISCARD_FAILED_MESSAGE });
      }
    },
    [acknowledgeNow, commit, forget, update],
  );

  /**
   * Bring this window's jobs into line with a journal snapshot. Runs one at a
   * time; any slow reads happen first, and the merge is made against the
   * current state afterwards, so an older snapshot can never overwrite newer
   * jobs or bring back one already saved or dismissed here.
   */
  const reconcile = useCallback(
    (records: GeminiJobRecord[]): Promise<void> => {
      const run = async () => {
        // Slow part: answers already saved before the app closed.
        const applied = new Set<string>();
        for (const record of records) {
          if (record.stage !== "ready" || !record.result || !repositoriesRef.current) continue;
          if (forgottenRef.current.has(record.id)) continue;
          try {
            const saved = await savedContent(repositoriesRef.current, record.kind, record.materialId);
            if (alreadySaved(record.kind, saved, record.result)) applied.add(record.id);
          } catch {
            // Shown for a deliberate decision instead.
          }
        }
        // Merge against the state as it is now.
        let next = jobsRef.current.map((job): GeminiJob => {
          if (job.phase !== "running" || job.jobId === null || job.local) return job;
          const record = records.find((candidate) => candidate.id === job.jobId);
          if (record?.stage === "running") return job;
          if (activeRef.current === job.key) activeRef.current = null;
          if (!record) {
            return {
              ...job,
              phase: "failed",
              error: "Creating this study aid stopped before Gemini's answer arrived. Nothing was saved; try again.",
            };
          }
          return {
            ...job,
            phase:
              record.stage === "ready"
                ? "recovered"
                : record.stage === "interrupted"
                  ? "interrupted"
                  : record.stage === "cancelled"
                    ? "cancelled"
                    : "failed",
            answer: record.stage === "ready" ? (record.result ?? null) : null,
            error: record.stage === "failed" || record.stage === "cancelled" ? (record.error ?? null) : null,
            checkpointed: record.stage === "ready",
          };
        });
        const known = new Set(next.map((job) => job.jobId).filter(Boolean));
        for (const record of records) {
          if (known.has(record.id) || forgottenRef.current.has(record.id)) continue;
          if (applied.has(record.id)) {
            forgottenRef.current.add(record.id);
            pendingAcksRef.current.add(record.id);
            continue;
          }
          // A job this window started is already shown, under its local key.
          const local = next.find(
            (job) => job.jobId === null && job.materialId === record.materialId && job.kind === record.kind,
          );
          if (local) continue;
          next = [
            ...next,
            {
              key: newKey(),
              jobId: record.id,
              kind: record.kind,
              materialId: record.materialId,
              filePath: record.relativePath,
              phase:
                record.stage === "running"
                  ? "running"
                  : record.stage === "ready"
                    ? "recovered"
                    : record.stage === "interrupted"
                      ? "interrupted"
                      : record.stage === "cancelled"
                        ? "cancelled"
                        : "failed",
              progress: null,
              error: record.stage === "failed" || record.stage === "cancelled" ? (record.error ?? null) : null,
              answer: record.stage === "ready" ? (record.result ?? null) : null,
              contentSha256: record.contentSha256 || null,
              baseRevision: record.baseRevision ?? null,
              checkpointed: record.stage === "ready",
            },
          ];
        }
        commit(next);
        const running = next.find((job) => job.phase === "running" && job.jobId !== null && !job.local);
        if (running && activeRef.current === null) activeRef.current = running.key;
        syncPendingCount();
        void flushAcks();
      };
      const queued = reconcileChainRef.current.then(run);
      reconcileChainRef.current = queued.catch(() => {});
      return queued;
    },
    [commit, flushAcks, syncPendingCount],
  );

  const follow = useCallback(async () => {
    try {
      await reconcile(await listGeminiJobs());
    } catch {
      // Tried again on the next change or tick.
    }
  }, [reconcile]);

  // Read earlier work back once the data is ready. The change listener is in
  // place before the snapshot is taken, and a final reconciliation follows it,
  // so a job that finishes in between is never missed.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    let stop = () => {};
    recoveryRef.current = "pending";
    setRecovery("pending");
    void (async () => {
      try {
        const unlisten = await watchGeminiJobs(() => void follow());
        if (cancelled) {
          unlisten();
          return;
        }
        stop = unlisten;
      } catch {
        // Without events, the periodic check below still follows a running job.
      }
      try {
        await reconcile(await listGeminiJobs());
        await follow();
        if (cancelled) return;
        recoveryRef.current = "ready";
        setRecovery("ready");
      } catch {
        if (cancelled) return;
        recoveryRef.current = "failed";
        setRecovery("failed");
      }
    })();
    return () => {
      cancelled = true;
      stop();
    };
  }, [ready, recoveryAttempt, follow, reconcile]);

  // A job found running after a reload is also checked on a timer, in case
  // its one change event is missed.
  const followingRunning = jobs.some((job) => job.phase === "running" && job.jobId !== null && !job.local);
  useEffect(() => {
    if (!followingRunning) return;
    const timer = window.setInterval(() => void follow(), FOLLOW_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [followingRunning, follow]);

  // Acknowledgements that could not be written are retried on a timer, not
  // only when something else happens.
  useEffect(() => {
    if (pendingAckCount === 0) return;
    const timer = window.setInterval(() => void flushAcks(), FOLLOW_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [pendingAckCount, flushAcks]);

  const retryRecovery = useCallback(() => setRecoveryAttempt((n) => n + 1), []);

  const value = useMemo<GeminiJobsValue>(
    () => ({
      jobs,
      busy: jobs.some((job) => job.phase === "running" || job.phase === "saving"),
      locked: () => activeRef.current !== null || recoveryRef.current !== "ready",
      recovery,
      retryRecovery,
      start,
      saveAgain,
      dismiss,
      cancel,
    }),
    // lockTick: the lock is a ref, so its release must change the value for
    // pages reading `locked()` to render again.
    [jobs, recovery, retryRecovery, start, saveAgain, dismiss, cancel, lockTick],
  );

  return <GeminiJobsContext.Provider value={value}>{children}</GeminiJobsContext.Provider>;
}

export function useGeminiJobs(): GeminiJobsValue {
  const context = useContext(GeminiJobsContext);
  if (!context) throw new Error("useGeminiJobs must be used inside AppDataProvider");
  return context;
}
