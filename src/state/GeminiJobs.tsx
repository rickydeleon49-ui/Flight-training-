import { MORE_CARDS_NOTE, withoutVerificationNotes } from "@/services/gemini";
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
import { forgetReviewedSave, rememberReviewedSave, reviewedSaveOf, type ReviewedRegeneration } from "./reviewedSaveCheckpoint";
import { needsPracticeRegenerationReview } from "@/logic/practiceRegeneration";
import { PracticeAuthoringError, PRACTICE_AUTHORING_ERROR_MESSAGES, KIT_PRACTICE_ATTEMPT_MESSAGE } from "@/data/persistenceErrors";
import { generatedPage, needsRegenerationReview } from "@/logic/studySetEditing";
import { inspectPdf } from "@/services/pdf";
import { notify } from "@/services/notify";
import { MAX_CARDS } from "@/logic/cardIdentity";
import {
  resumeStudyGuide, restartStudyGuide, sectionGuideError, queueStudyGuide,
  SectionGuideError, type SectionGuideRequest, type SectionGuideErrorCode,
  acknowledgeGeminiJob,
  generatePracticeTest,
  generateStudyKit,
  generateStudyAid,
  geminiErrorMessage,
  listGeminiJobs,
  watchGeminiJobs,
  watchGeminiProgress,
  cancelGeminiJob,
  GEMINI_CANCELLED_MESSAGE,
  KIT_PROVIDER_CHANGED,
  KIT_SOURCE_CHANGED,
  type GeminiJobKind,
  type GeminiProgressEvent,
  type GeminiWorkStage,
  type GeminiJobRecord,
  type GeneratedPracticeTest,
  type GeneratedStudyAid,
} from "@/services/gemini";

export const EMPTY_FLASHCARDS_MESSAGE = "Gemini didn't return any flashcards from this file. Nothing was saved — try again, or try a smaller part of the PDF.";

function emptyCards(kind: GeminiJobKind, answer: Answer | null | undefined): boolean {
  return kind === "flashcards" && !!answer && (answer as GeneratedStudyAid).flashcards.length === 0;
}

/** Said once when a cards job saves fewer cards than it asked for. */
export function cardsShortNote(count: number, more: boolean): string {
  const cards = `${count} ${count === 1 ? "card" : "cards"}`;
  if (more) return count === 0 ? "Gemini found no new cards in this file." : `Gemini found ${count} more ${count === 1 ? "card" : "cards"} in this file.`;
  return `Gemini made ${cards}; this file is short, so there wasn't more to ask about.`;
}

export const MAX_CARDS_MESSAGE = "You have the most cards one set can hold.";

/** An answer that carries only extra cards to add to the saved set (GUIDE-PACK-01). */
export function isMoreCards(kind: GeminiJobKind, answer: Answer | null | undefined): boolean {
  return kind === "flashcards" && !!answer && (answer as GeneratedStudyAid).sourceNotes === MORE_CARDS_NOTE;
}

/** True for a "Make 10 more cards" job, even one that failed before it had an answer. */
export function isMoreCardsJob(job: Pick<GeminiJob, "kind" | "answer" | "draft"> & { more?: boolean }): boolean {
  return job.kind === "flashcards" && (job.more === true || job.draft?.target === 10 || isMoreCards(job.kind, job.answer));
}

/** The native "nothing new" outcome: asking again would not help. */
export function isNoNewCardsError(error: string | null | undefined): boolean {
  return !!error && error.includes("didn't find any new cards");
}

/** How many cards a study guide brings along. */
export const GUIDE_PACK_CARDS = 20;

export function effectiveJobKind(record: GeminiJobRecord): GeminiJobKind {
  const reqId = record.requestId ?? (record as unknown as { request_id?: string }).request_id;
  if (record.kind === "study-aid" && typeof reqId === "string" && reqId.startsWith("flashcards:")) {
    return "flashcards";
  }
  return record.kind;
}

/** Timing-only native drafts are recovery metadata, not unfinished card sets. */
function cardDraft(record: GeminiJobRecord): { target: number; cards: unknown[] } | undefined {
  const draft = record.draft;
  return draft && typeof draft.target === "number" && Array.isArray(draft.cards)
    ? { target: draft.target, cards: draft.cards }
    : undefined;
}

export interface SectionGuideDraft {
  model?: string;
  ready: number;
  total: number;
  heading?: string;
  request: SectionGuideRequest;
}
function sectionDraft(record: GeminiJobRecord): SectionGuideDraft | undefined {
  const d = record.draft;
  if (d?.kind !== "guide-sections-v1" || !d.identity || !d.results) return undefined;
  const manifest = d.identity.manifest;
  if (!Array.isArray(manifest) || !Array.isArray(d.identity.chosenPages)) return undefined;
  return {
    ready: manifest.filter(s => d.results?.[s.id]?.status === "complete").length,
    total: manifest.length,
    heading: manifest.find(s => d.results?.[s.id]?.status !== "complete")?.heading,
    ...(typeof d.identity.model === "string" ? { model: d.identity.model } : {}),
    request: { materialId: record.materialId, relativePath: record.relativePath,
      chosenPages: d.identity.chosenPages, baseRevision: d.identity.baseRevision ?? null },
  };
}

/** A new stage or a new section step restarts the slow-step clock. */
function stepStart(job: GeminiJob, event: { stage?: GeminiWorkStage | null; message?: string | null }): { stageSince?: number } {
  const changed = (event.stage != null && event.stage !== job.stage) || (event.message != null && event.message !== job.progress);
  return changed ? { stageSince: Date.now() } : {};
}

function recoveredSectionError(record: GeminiJobRecord): SectionGuideErrorCode | undefined {
  if (record.draft?.kind !== "guide-sections-v1" || !record.error) return undefined;
  const error = sectionGuideError(record.error);
  return error.code === "GUIDE_PAUSED" ? "GUIDE_FAILED" : error.code;
}

/**
 * Gemini generations that outlive the page that started them (GEN-REL-02).
 *
 * A study aid or practice test used to belong to its material page: leaving the
 * page threw a finished answer away. Now a generation belongs to the app. It
 * keeps running while the student reads something else, and its answer is saved to the
 * material it was made from, only if, at the moment of saving and inside the
 * write queue:
 *
 * - the material still exists with the same file;
 * - the stored bytes are still the bytes Gemini read (SHA-256);
 * - nothing else has been saved over the content the student asked to replace (the
 *   saved `updatedAt` is still the one recorded when the student asked).
 *
 * Otherwise it is not saved, and the student is told. An answer that is already the
 * saved content (a save that committed before the app closed, but whose job
 * was not yet forgotten) is recognized and never saved twice.
 *
 * One generation runs at a time, whichever page asked; the lock is taken
 * synchronously before anything awaits. A finished answer is a checkpoint:
 * "Save again" uses it without asking Gemini again. After a reload or restart,
 * the native journal is read back before anything new may start. A finished
 * answer waits for the student to save or discard it. A generation cut off by the app
 * closing is shown as interrupted and never resent by itself. A save the student
 * reviewed keeps its exact operation on this computer until the journal
 * acknowledges the answer, so a restart recognises that save instead of
 * making it again under new item ids.
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
  | "cancelled"
  | "waiting-for-her";

type Answer = GeneratedStudyAid | GeneratedPracticeTest;

export interface GeminiJob {
  /** True for "Make 10 more cards": its answer only ever appends. */
  more?: boolean;
  studyKitPart?: boolean;
  sectionGuide?: boolean;
  queueState?: "waiting-for-her" | "running" | "paused" | "cancelled";
  sections?: SectionGuideDraft;
  sectionError?: SectionGuideErrorCode;
  draft?: { target: number; cards: unknown[] };
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
  /** The saved content's `updatedAt` when the student asked, or null if none. */
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
  /** When the current stage or section step began (ms), for the slow-step hint. */
  stageSince?: number;
  /** When this job was first created or recorded (ms since the epoch). */
  createdAt?: number;
  /** A cancel is on its way to (or held by) the native side. */
  cancelRequested?: boolean;
  /** The student pressed Cancel at some point: an answer that still arrives is never saved by itself. */
  cancelAttempted?: boolean;
  /** Why the student's cancel did not go through, if it did not; Cancel works again. */
  cancelError?: string | null;
  /** This window's own id for the request, which cancel goes by (GEN-REL-04). */
  requestId?: string;
  /** Whether the generation request has been sent to the native side. */
  invoked?: boolean;
  /**
   * The student's study set holds items the student wrote, corrected or deleted, so this answer
   * is saved only through the regeneration review (OFFLINE-03a), never as is.
   */
  needsReview?: boolean;
  /**
   * The reviewed save that last failed. Saving the same choices again resends
   * exactly this operation, so a save that did commit is recognised, not repeated.
   */
  reviewed?: ReviewedRegeneration;
  /**
   * Started by this window, whose own request decides its outcome. Recovery
   * after a reload follows only jobs it found, never these, even once they
   * have their native id.
   */
  local?: boolean;
}

export function isNewerJob(a: GeminiJob, b: GeminiJob): boolean {
  if (a.key === b.key) return false;
  const timeA = a.createdAt ?? a.startedAt ?? 0;
  const timeB = b.createdAt ?? b.startedAt ?? 0;
  if (timeA !== timeB) return timeA > timeB;
  const aWorking = a.phase === "running" || a.phase === "saving";
  const bWorking = b.phase === "running" || b.phase === "saving";
  if (aWorking !== bWorking) return aWorking;
  return false;
}

/** The newest job of this kind for the material; an older failed one never hides it. */
export function newestJob(jobs: GeminiJob[], materialId: string, kind: GeminiJob["kind"]): GeminiJob | undefined {
  return jobs
    .filter((job) => job.materialId === materialId && job.kind === kind)
    .reduce<GeminiJob | undefined>((latest, candidate) => (!latest || isNewerJob(candidate, latest) ? candidate : latest), undefined);
}

/** A PDF study guide goes by sections unless an earlier study-aid draft waits to be continued. */
export function usesSectionGuide(jobs: GeminiJob[], materialId: string, filePath: string): boolean {
  return filePath.toLowerCase().endsWith(".pdf") && !jobs.some((job) => job.materialId === materialId && job.kind === "study-aid" && job.draft);
}

export interface GeminiJobTarget {
  materialId: string;
  filePath: string;
}

export interface StartOptions {
  targetCards?: number;
  /** Checks made after the lock is taken; a message means "do not send". */
  preflight?: () => Promise<string | null>;
  /** Called once the answer is saved, for the page that is still showing it. */
  onSaved?: () => void;
  /** Flashcards only: add 10 more cards to the saved set instead of replacing it. */
  moreCards?: boolean;
  /**
   * Study guide only: once the guide is saved, also make 20 flashcards and a
   * practice test for the same material, skipping any the material already has.
   * `preflight` is repeated before each follow-up.
   */
  followUps?: { preflight?: () => Promise<string | null> };
  /** Kits only: use this request id (the kit queue records it before the paid call). */
  requestId?: string;
  /** Kits only: the provider and file checksum the student agreed to; the native side refuses anything else. */
  expected?: { provider: string; sha256: string };
  /** Kits only: told the journal job id as soon as the native side has begun it. */
  onJobId?: (jobId: string) => void;
}

/** How a kit start ended, for the kit queue (SOURCE-01b). */
export type KitStartOutcome = "checkpointed" | "memory-only" | "failed" | "cancelled" | "refused";
export interface KitStartResult {
  outcome: KitStartOutcome;
  /** The plain message, when the start was refused or failed. */
  message?: string;
  /** The journal job, once the kit is checkpointed. */
  jobId?: string | null;
  /** Some parts came back and some did not. */
  partial?: boolean;
  /** The refusal is already shown on the kit's own job. */
  shown?: boolean;
  /** Whether the request reached the provider (so a failure is unclear, not free). */
  sent: boolean;
  /** Refused because the agreed provider or chapter file no longer matches. */
  stale?: "provider" | "source";
  requestId: string;
}

/**
 * A regenerated study set as the student reviewed it, and the checkpoint that keeps it
 * until the journal acknowledges its answer. Shared with the review dialog.
 */
export type { ReviewedRegeneration } from "./reviewedSaveCheckpoint";

/** Whether earlier Gemini work has been read back from the journal yet. */
export type GeminiRecovery = "pending" | "ready" | "failed";

interface GeminiJobsValue {
  jobs: GeminiJob[];
  /** True while any generation is running or being saved. */
  busy: boolean;
  /** True while a saved guide's flashcards and practice test are still being made. */
  makingPack(materialId: string): boolean;
  /** One plain line about how many cards the last cards job saved, or null. */
  cardsNote(materialId: string): string | null;
  /** The lock as it is right now, for event handlers that must not wait for a render. */
  locked(): boolean;
  recovery: GeminiRecovery;
  retryRecovery(): void;
  start(kind: GeminiJobKind, target: GeminiJobTarget, options?: StartOptions): Promise<string | void>;
  startKit(target: GeminiJobTarget, options?: StartOptions): Promise<string | void>;
  /** Same as startKit, but says how it ended (SOURCE-01b). */
  startKitTracked(target: GeminiJobTarget, options?: StartOptions): Promise<KitStartResult>;
  queueGuide(target: GeminiJobTarget): Promise<string | null>;
  continueGuide(key: string, restart?: boolean): Promise<void>;
  saveAgain(key: string): Promise<void>;
  /** Save a regenerated study set as the student reviewed it, keeping what the student chose (OFFLINE-03a). */
  /** True once saved; false leaves the answer, and the student's review, in place. */
  saveReviewed(key: string, reviewed: ReviewedRegeneration): Promise<boolean>;
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
const REVIEWED_SAVE_FAILED_MESSAGE =
  "Saving the reviewed study guide did not work, or this guide changed after you reviewed it. Anything already saved is unchanged. Review it again to save.";
const SAVE_FAILED_NOT_KEPT_MESSAGE =
  "Gemini finished, but saving the answer did not work, and it could not be kept on this Mac either. Anything already saved is unchanged. Save again uses the same answer while the app stays open.";

/** Said when the student's cancel could not be recorded. */
export const CANCEL_FAILED_MESSAGE =
  "Cancelling did not go through, so Gemini is still working on it. Try Cancel again.";

function newRequestId(): string {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `req-${random}`;
}

/** Said when the student cancelled before anything was sent. */
export const CANCELLED_BEFORE_SENDING = "Cancelled before anything was sent to Google. Nothing was saved.";

/** Whether a progress event is about this job: by id once known, otherwise by its material and output. */
function belongsTo(job: GeminiJob, event: GeminiProgressEvent): boolean {
  if (job.jobId && event.jobId) return job.jobId === event.jobId;
  return job.materialId === event.materialId && (job.kind === event.kind || (job.kind === "flashcards" && event.kind === "study-aid"));
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
    // A guide save changes only guide fields. Existing cards are independent,
    // so they cannot prevent recognition of a committed guide save.
    const sections = (list: AiStudySet["sections"]) => list.map(({ heading, body }) => ({ heading, body }));
    return (
      canonical([s.title, s.summary, sections(s.sections), s.sourceNotes, s.model]) ===
      canonical([a.title, a.summary, sections(a.sections), a.sourceNotes, a.model])
    );
  }
  if (kind === "flashcards") {
    const s = saved as AiStudySet;
    const a = answer as GeneratedStudyAid;
    if (a.sourceNotes === MORE_CARDS_NOTE) {
      // Extra cards are already in when every one of their fronts is in the set.
      const have = new Set(s.flashcards.map((card) => card.front.trim().toLowerCase()));
      return a.flashcards.length > 0 && a.flashcards.every((card) => have.has(card.front.trim().toLowerCase()));
    }
    const cards = (list: AiStudySet["flashcards"]) =>
      list.map(({ front, back, sourcePage }) => ({ front, back, sourcePage: generatedPage(sourcePage) }));
    return s.model === a.model && canonical(cards(s.flashcards)) === canonical(cards(a.flashcards));
  }
  const s = saved as PracticeTest;
  const a = answer as GeneratedPracticeTest;
  return canonical([s.title, s.questions, s.model]) === canonical([a.title, a.questions, a.model]);
}

async function savedContent(repos: Repositories, kind: GeminiJobKind, materialId: string) {
  return kind === "study-aid" || kind === "flashcards"
    ? (await repos.documents.listAiStudySets()).find((set) => set.sourceMaterialId === materialId)
    : (await repos.documents.listPracticeTests()).find((test) => test.sourceMaterialId === materialId);
}

/**
 * Whether the journal cannot see this answer any more.
 *
 * The native journal answers `false` to an acknowledgement both for a record it
 * will not let go of and for one already gone — removed by another window, say
 * (src-tauri/src/gemini_jobs.rs). Only reading it back tells the two apart, and
 * a read that fails answers nothing: the answer counts as still there.
 */
async function goneFromJournal(id: string): Promise<boolean> {
  try {
    const records = await listGeminiJobs();
    return !records.some((record) => record.id === id);
  } catch {
    return false;
  }
}

const NOTICE_TITLE = "Your Flight Deck";
const NOTICE_TEXT = {
  ready: "Your study guide is ready",
  partial: "Your study guide finished, but part of it didn't work. Open the app to see.",
  failed: "A study guide couldn't be made. Open the app to see.",
} as const;

/** One notice for a whole study kit, by how many of its parts have an answer. */
function kitNotice(answered: number, total: number): keyof typeof NOTICE_TEXT {
  return answered === 0 ? "failed" : answered < total ? "partial" : "ready";
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
  // Guide jobs asked to bring flashcards and a practice test once saved.
  const followUpOptionsRef = useRef(new Map<string, NonNullable<StartOptions["followUps"]>>());
  const pendingFollowUpsRef = useRef<{ target: GeminiJobTarget; options: NonNullable<StartOptions["followUps"]> }[]>([]);
  const [packMaterials, setPackMaterials] = useState<string[]>([]);
  const [cardNotes, setCardNotes] = useState<Record<string, string>>({});
  const askedCardsRef = useRef(new Map<string, number>());
  const runFollowUpsRef = useRef<() => Promise<void>>(async () => {});
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

  /**
   * "Your study guide is ready" (NOTIFY-01). Only when you turned it on and the
   * window is in the background. The text never holds your titles or content.
   */
  const announce = useCallback((what: keyof typeof NOTICE_TEXT) => {
    if (dataRef.current.toolkit?.studyGuideNotice !== true) return;
    if (typeof document !== "undefined" && document.hasFocus() && document.visibilityState === "visible") return;
    void notify(NOTICE_TITLE, NOTICE_TEXT[what]);
  }, []);

  const commit = useCallback((next: GeminiJob[]) => {
    // Only a job seen running here and finishing here gets a notice, so jobs
    // that finished before the app started stay quiet. Study-kit parts are
    // announced once for the whole kit instead.
    const before = new Map(jobsRef.current.map((job) => [job.key, job.phase]));
    for (const job of next) {
      if (before.get(job.key) !== "running" || job.studyKitPart) continue;
      if (job.phase === "recovered" || job.phase === "saving") announce("ready");
      else if (job.phase === "failed") announce("failed");
    }
    jobsRef.current = next;
    setJobs(next);
  }, [announce]);

  const update = useCallback(
    (key: string, change: Partial<GeminiJob>) => {
      commit(jobsRef.current.map((job) => (job.key === key ? { ...job, ...change } : job)));
    },
    [commit],
  );

  const syncPendingCount = useCallback(() => setPendingAckCount(pendingAcksRef.current.size), []);

  /**
   * Ask the journal to forget one job. True only when the answer is confirmed
   * gone from it: `true` says so directly, and a `false` answer is settled by
   * reading the journal back, because the native journal answers `false` both
   * for a record it cannot remove and for one another window has already
   * removed. A rejection, a record that is still there, or a read that fails
   * keeps this on the retry list and keeps anything that depends on it where it
   * is.
   */
  const acknowledgeNow = useCallback(
    async (id: string): Promise<boolean> => {
      let acknowledged = false;
      try {
        acknowledged = await acknowledgeGeminiJob(id);
      } catch {
        // The write did not go through, so the journal was never heard from.
        // Nothing here may be treated as done, and no read may say otherwise.
        return false;
      }
      // `false` is not removal on its own: the journal also answers that while
      // its own command is still finishing, while a damaged journal is
      // quarantined, and when it cannot write. Absence, once confirmed, is.
      if (!acknowledged && !(await goneFromJournal(id))) return false;
      pendingAcksRef.current.delete(id);
      syncPendingCount();
      // The journal will never hand this answer back, so the reviewed save it
      // was holding is finished with. This is the only place that checkpoint is
      // dropped: a study-set write that succeeded says nothing about here.
      forgetReviewedSave(id);
      return true;
    },
    [syncPendingCount],
  );

  /**
   * Retry acknowledgements that could not be written yet. They follow saves
   * whose content is already in the library: a restart before they succeed is
   * still safe, because an answer that is already the saved content is
   * recognized and never saved twice, and a save the student reviewed keeps its exact
   * operation here until the acknowledgement lands.
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
    async (key: string, reviewed?: ReviewedRegeneration): Promise<boolean> => {
      const job = jobsRef.current.find((candidate) => candidate.key === key);
      if (!job?.answer) return false;
      if (emptyCards(job.kind, job.answer)) {
        update(key, { phase: "failed", error: EMPTY_FLASHCARDS_MESSAGE, answer: null });
        return false;
      }
      if (job.sectionGuide && !job.jobId) {
        update(key, { phase: "save-failed", error: SAVE_FAILED_MESSAGE });
        return false;
      }
      update(key, { phase: "saving", error: null });
      const answer = job.answer;
      // A reviewed save is the one write the journal cannot re-check for the student:
      // record the exact operation before sending it, and let the
      // acknowledgement (acknowledgeNow) be the only thing that removes it.
      // Whether the study set stored is not the test — the answer stays in the
      // journal until then, and a restart must recognise this save, not redo it.
      if (reviewed) rememberReviewedSave(job.jobId, reviewed);

      let savedCards: number | null = null;
      let outcome: "saved" | "already" | "superseded" | "newer" | "review" | "attempt" | null;
      let practiceError: string | null = null;
      const guideFailure: { error?: SectionGuideError } = {};
      try {
        outcome = await mutate(async (repos) => {
          try {
            // Every check is made here, inside the write queue, immediately
            // before the write, so no queued change can slip in between.
            const materials = await repos.documents.list();
            const current = materials.find((material) => material.id === job.materialId);
            if (!current || current.filePath !== job.filePath) return "superseded" as const;
            if (job.contentSha256 && !job.sectionGuide) {
              const fingerprints = await repos.documents.fingerprintDocuments([job.filePath]);
              if (fingerprints && fingerprints.get(job.filePath) !== job.contentSha256) {
                return "superseded" as const;
              }
            }
            if (reviewed?.kind === "study-set" && (job.kind === "study-aid" || job.kind === "flashcards")) {
              // The set the student reviewed is named column for column, so a change made
              // since refuses as stale; the same id makes a retry safe.
              await repos.documents.saveStudySet({
                operationId: reviewed.operationId,
                materialId: job.materialId,
                reason: "regenerate",
                expected: reviewed.expected,
                next: reviewed.next,
              }, job.sectionGuide ? job.jobId ?? undefined : undefined);
              return "saved" as const;
            }
            if (reviewed?.kind === "practice" && job.kind === "practice-test") {
              try {
                await repos.documents.savePracticeAuthoring(reviewed.operation);
                return "saved" as const;
            } catch (failure) {
              practiceError = failure instanceof PracticeAuthoringError ? failure.message : PRACTICE_AUTHORING_ERROR_MESSAGES.STORAGE_ERROR;
              throw failure;
            }
          }
          // Kit consent does not end an attempt: keep these paid questions
          // as a draft until the student finishes or abandons it themselves.
          if (job.kind === "practice-test" && job.studyKitPart && await repos.practiceSessions.getCurrentAttempt(job.materialId)) return "attempt" as const;
          const saved = await savedContent(repos, job.kind, job.materialId);
          if (alreadySaved(job.kind, saved, answer)) return "already" as const;
          if (isMoreCards(job.kind, answer)) {
            // Extra cards are added to the end of the saved set; nothing is replaced.
            const added = await repos.documents.appendGeneratedCards(
              job.materialId,
              withoutVerificationNotes((answer as GeneratedStudyAid).flashcards),
            );
            if (added !== null) savedCards = added;
            return added === null ? ("superseded" as const) : ("saved" as const);
          }
          // Kit parts share one study set, so saving one part moves its
          // revision past the others' base: that alone is not "newer". The student's
          // own edits still go to review just below.
          const siblingSave = job.studyKitPart && (job.kind === "study-aid" || job.kind === "flashcards");
          if (!siblingSave && (saved?.updatedAt ?? null) !== job.baseRevision) return "newer" as const;
          // The student's own items, corrections and deletions are never replaced
          // without the student's review (OFFLINE-03a).
          if ((job.kind === "study-aid" || job.kind === "flashcards") && needsRegenerationReview(saved as AiStudySet | undefined)) return "review" as const;
          if (job.kind === "practice-test" && needsPracticeRegenerationReview(await repos.documents.readPracticeSnapshot(job.materialId))) return "review" as const;
          if (job.kind === "study-aid") {
            const aid = answer as GeneratedStudyAid;
            // A kit guide has no cards of its own: it keeps the saved ones.
            const keptCards = job.studyKitPart ? (saved as AiStudySet | undefined)?.flashcards : undefined;
            await repos.documents.saveAiStudySet({
              sourceMaterialId: job.materialId,
              title: aid.title,
              summary: aid.summary,
              sections: aid.sections,
              flashcards: keptCards ?? withoutVerificationNotes(aid.flashcards),
              sourceNotes: aid.sourceNotes,
              model: aid.model,
            }, job.sectionGuide ? job.jobId ?? undefined : undefined, "study-aid");
          } else if (job.kind === "flashcards") {
            const aid = answer as GeneratedStudyAid;
            savedCards = aid.flashcards.length;
            const currentSet = saved as AiStudySet | undefined;
            await repos.documents.saveAiStudySet({
              sourceMaterialId: job.materialId,
              title: currentSet?.title || aid.title,
              summary: currentSet ? currentSet.summary : "",
              sections: currentSet ? currentSet.sections : [],
              flashcards: withoutVerificationNotes(aid.flashcards),
              sourceNotes: currentSet ? currentSet.sourceNotes : aid.sourceNotes,
              model: aid.model,
            }, undefined, "flashcards");
          } else {
            const test = answer as GeneratedPracticeTest;
            await repos.documents.savePracticeTest({
              sourceMaterialId: job.materialId,
              title: test.title,
              questions: withoutVerificationNotes(test.questions),
              provider: "gemini",
              model: test.model,
            });
          }
          return "saved" as const;
          } catch (failure) {
            if (job.sectionGuide && failure instanceof SectionGuideError) guideFailure.error = failure;
            throw failure;
          }
        });
      } catch (failure) {
        if (job.sectionGuide && failure instanceof SectionGuideError) guideFailure.error = failure;
        if (reviewed?.kind === "practice") {
          practiceError = failure instanceof PracticeAuthoringError ? failure.message : PRACTICE_AUTHORING_ERROR_MESSAGES.STORAGE_ERROR;
        }
        outcome = null;
      }

      if (guideFailure.error) {
        update(key, { phase: "failed", sectionError: guideFailure.error.code, error: guideFailure.error.message });
        return false;
      }
      if (outcome === "saved" || outcome === "already") {
        const onSaved = onSavedRef.current.get(key);
        const followUps = followUpOptionsRef.current.get(key);
        followUpOptionsRef.current.delete(key);
        const asked = askedCardsRef.current.get(key);
        askedCardsRef.current.delete(key);
        // Set inside the save closure above, so TypeScript's narrowing still sees null here.
        const savedCount = savedCards as number | null;
        if (outcome === "saved" && job.kind === "flashcards" && savedCount !== null && asked !== undefined && savedCount < asked) {
          const note = cardsShortNote(savedCount, isMoreCardsJob(job));
          setCardNotes((notes) => ({ ...notes, [job.materialId]: note }));
        }
        forget(key);
        if (outcome === "saved") onSaved?.();
        if (outcome === "saved" && followUps && job.kind === "study-aid") {
          pendingFollowUpsRef.current.push({ target: { materialId: job.materialId, filePath: job.filePath }, options: followUps });
          setPackMaterials((list) => (list.includes(job.materialId) ? list : [...list, job.materialId]));
        }
        return true;
      } else if (outcome === "attempt") {
        update(key, { phase: "recovered", error: KIT_PRACTICE_ATTEMPT_MESSAGE });
      } else if (outcome === "review") {
        update(key, { phase: "recovered", needsReview: true, error: null });
      } else if (outcome === "superseded" || outcome === "newer") {
        update(key, {
          phase: "superseded",
          error: outcome === "newer" ? NEWER_SAVED_MESSAGE : SUPERSEDED_MESSAGE,
        });
      } else {
        update(key, {
          phase: "save-failed",
          error: practiceError ?? (reviewed?.kind === "practice" ? PRACTICE_AUTHORING_ERROR_MESSAGES.STORAGE_ERROR : reviewed
            ? REVIEWED_SAVE_FAILED_MESSAGE
            : job.checkpointed ? SAVE_FAILED_MESSAGE : SAVE_FAILED_NOT_KEPT_MESSAGE),
          ...(reviewed ? { reviewed } : {}),
        });
      }
      return false;
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
      if (!job || (job.phase !== "running" && job.phase !== "waiting-for-her") || job.cancelRequested) return;
      update(key, { cancelRequested: true, cancelAttempted: true, cancelError: null });
      // Only this window's own request, not yet sent, is stopped by the flag
      // alone. A job recovered after a reload is cancelled by its job id.
      if (job.local && !job.invoked) return;
      const notAccepted = () => {
        // Not recorded and not held: say so, and let the student try again while it
        // still runs.
        const now = jobsRef.current.find((candidate) => candidate.key === key);
        if (now?.phase === "running" || now?.phase === "waiting-for-her") update(key, { cancelRequested: false, cancelError: CANCEL_FAILED_MESSAGE });
      };
      let outcome: Awaited<ReturnType<typeof cancelGeminiJob>>;
      try {
        outcome = await cancelGeminiJob({ requestId: job.requestId, jobId: job.jobId ?? undefined });
      } catch {
        notAccepted();
        return;
      }
      if (outcome.cancelled && job.phase === "waiting-for-her") {
        forget(key);
        return;
      }
      // Recorded, or held until its job begins: the request's own result
      // will say how it ended. Already finished (ready, failed…): likewise.
      // Anything else means the cancel did not take.
      const settled = outcome.stage !== null && outcome.stage !== "running";
      if (!outcome.cancelled && !outcome.pending && !settled) notAccepted();
    },
    [forget, update],
  );

  const start = useCallback(
    async (kind: GeminiJobKind, target: GeminiJobTarget, options?: StartOptions) => {
      // Take the shared lock synchronously, before anything awaits. Nothing
      // new starts until earlier work has been read back from the journal.
      if (recoveryRef.current !== "ready") return "Gemini is still checking earlier work. Try again in a moment.";
      if (activeRef.current !== null) return "Gemini is already working. Wait for it to finish or stop it, then try again.";
      if (jobsRef.current.some(job => job.materialId === target.materialId && job.kind === kind && job.sectionGuide)) return "Finish or discard the study guide draft first, then try again.";
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
      if (waiting) return "Save or discard the earlier draft first, then try again.";
      // "Make 10 more cards" needs the set it adds to.
      const moreFronts = options?.moreCards && kind === "flashcards"
        ? dataRef.current.aiStudySets.find((set) => set.sourceMaterialId === target.materialId)?.flashcards.map((card) => card.front)
        : undefined;
      if (options?.moreCards && kind === "flashcards") {
        if (!moreFronts || moreFronts.length === 0) return "Make some flashcards first, then you can add more.";
        if (moreFronts.length >= MAX_CARDS) return MAX_CARDS_MESSAGE;
      }
      const useSections = kind === "study-aid" && usesSectionGuide(jobsRef.current, target.materialId, target.filePath);
      const key = newKey();
      activeRef.current = key;
      // Asking again replaces this material's older outcome of the same kind.
      for (const old of jobsRef.current) {
        if (old.materialId === target.materialId && old.kind === kind) forget(old.key);
      }
      // What the student is asking to replace, so nothing newer is ever overwritten.
      const saved =
        kind === "study-aid" || kind === "flashcards"
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
          createdAt: Date.now(),
          cancelRequested: false,
          cancelAttempted: false,
          cancelError: null,
          requestId: kind === "flashcards" ? `flashcards:${newRequestId()}` : newRequestId(),
          invoked: false,
          local: true,
          sectionGuide: useSections,
          more: options?.moreCards && kind === "flashcards" ? true : undefined,
        },
      ]);
      if (options?.onSaved) onSavedRef.current.set(key, options.onSaved);
      if (kind === "flashcards") {
        askedCardsRef.current.set(key, options?.moreCards ? 10 : options?.targetCards ?? 40);
        setCardNotes((notes) => {
          if (!(target.materialId in notes)) return notes;
          const { [target.materialId]: _gone, ...rest } = notes;
          return rest;
        });
      }
      if (options?.followUps && kind === "study-aid") followUpOptionsRef.current.set(key, options.followUps);
      const current = () => jobsRef.current.find((job) => job.key === key);

      let stopWatching = () => {};
      try {
        const refusal = (await options?.preflight?.()) ?? null;
        if (refusal) {
          update(key, { phase: "failed", error: refusal, sectionGuide: false });
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
              ...stepStart(job, event),
              attempt: event.attempt,
              maxAttempts: event.maxAttempts,
            });
          });
        } catch {
          // Progress is a courtesy; generation goes ahead without it.
        }
        const generate = (kind === "study-aid" || kind === "flashcards") ? generateStudyAid : generatePracticeTest;
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
          if (useSections) {
            const pdf = await inspectPdf(target.filePath);
            const request: SectionGuideRequest = { materialId: target.materialId, relativePath: target.filePath,
              chosenPages: Array.from({ length: pdf.pages }, (_, i) => i + 1), baseRevision, requestId: current()?.requestId };
            update(key, { sections: { ready: 0, total: 0, request } });
            if (current()?.cancelRequested) {
              update(key, { phase: "cancelled", error: sectionGuideError({ code: "CANCELLED" }).message, stage: null });
              return;
            }
            answer = await resumeStudyGuide(request);
          } else answer = (kind === "study-aid" || kind === "flashcards")
            ? await (moreFronts
              ? generateStudyAid(target.filePath, target.materialId, baseRevision ?? undefined, current()?.requestId, options?.targetCards ?? 40, true, moreFronts)
              : generateStudyAid(target.filePath, target.materialId, baseRevision ?? undefined, current()?.requestId, options?.targetCards ?? 40, kind === "flashcards"))
            : await generatePracticeTest(target.filePath, target.materialId, baseRevision ?? undefined, current()?.requestId);
        } catch (error) {
          // Cancelled only if the native side says so: the journal decided.
          const safe = useSections ? sectionGuideError(error) : null;
          let message = safe?.message ?? geminiErrorMessage(error);
          if (
            kind === "flashcards" &&
            (message.includes("Resume or explicitly discard") ||
              message.includes("earlier versioned draft") ||
              message.includes("Resume the earlier guide") ||
              message.includes("guide job for the same material is in progress") ||
              (message.toLowerCase().includes("guide") && message.toLowerCase().includes("progress")) ||
              ((message.includes("already working on another study aid") || message.includes("waiting to be saved or discarded")) &&
                jobsRef.current.some((j) => j.materialId === target.materialId && (j.sectionGuide || j.kind === "study-aid"))))
          ) {
            message = "Finish or stop the study guide first, then make flashcards.";
          }
          const cancelled = safe?.code === "CANCELLED" || message === GEMINI_CANCELLED_MESSAGE;
          update(key, {
            phase: cancelled ? "cancelled" : "failed",
            error: message,
            sectionError: safe?.code,
            progress: null,
            stage: null,
          });
          // The window shows the outcome itself; the journal need not keep it.
          try {
            for (const record of await listGeminiJobs()) {
              const effective = effectiveJobKind(record);
              if (
                record.materialId === target.materialId &&
                effective === kind &&
                (record.stage === "failed" || record.stage === "cancelled")
              ) {
                if (record.draft) {
                  update(key, { jobId: record.id, draft: cardDraft(record), sections: sectionDraft(record) ?? current()?.sections });
                  continue;
                }
                forgottenRef.current.add(record.id);
                pendingAcksRef.current.add(record.id);
              }
            }
            syncPendingCount();
            await flushAcks();
          } catch {
            // Bounded: a failed record is replaced by the student's next request anyway.
          }
          return;
        }
        const { jobId = null, contentSha256 = null, checkpointed = false, ...rest } = answer;
        const currentSet = kind === "flashcards" ? (saved as AiStudySet | undefined) : undefined;
        const jobAnswer: Answer =
          kind === "flashcards" && !options?.moreCards
            ? {
                ...(rest as GeneratedStudyAid),
                title: currentSet?.title || (rest as GeneratedStudyAid).title,
                summary: currentSet ? currentSet.summary : "",
                sections: currentSet ? currentSet.sections : [],
                sourceNotes: currentSet ? currentSet.sourceNotes : (rest as GeneratedStudyAid).sourceNotes,
                flashcards: (rest as GeneratedStudyAid).flashcards,
              }
            : (rest as Answer);
        if (emptyCards(kind, jobAnswer)) {
          update(key, { jobId, contentSha256, checkpointed: Boolean(checkpointed && jobId),
            phase: "failed", error: EMPTY_FLASHCARDS_MESSAGE, answer: null, progress: null, stage: null });
          return;
        }
        // Study aids always wait for acceptance. An answer that beat a cancel
        // also waits, including practice tests.
        if (kind === "study-aid" || current()?.cancelAttempted) {
          update(key, {
            jobId,
            contentSha256,
            checkpointed: Boolean(checkpointed && jobId),
            answer: jobAnswer,
            progress: null,
            stage: null,
            phase: "recovered",
            needsReview: kind === "study-aid" && needsRegenerationReview(dataRef.current.aiStudySets.find(set => set.sourceMaterialId === target.materialId)),
          });
          return;
        }
        update(key, {
          jobId,
          contentSha256,
          checkpointed: Boolean(checkpointed && jobId),
          answer: jobAnswer,
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

  /**
   * A saved guide brings 20 flashcards and a practice test (GUIDE-PACK-01),
   * each made by the ordinary job. Whatever the material already has is
   * left alone, and a part that fails leaves the guide saved and its own retry
   * button in place.
   */
  const runFollowUps = useCallback(async () => {
    const todo = pendingFollowUpsRef.current.splice(0);
    for (const { target, options } of todo) {
      try {
        const repos = repositoriesRef.current;
        let hasCards = true;
        let hasTest = true;
        if (repos) {
          try {
            const set = (await repos.documents.listAiStudySets()).find((candidate) => candidate.sourceMaterialId === target.materialId);
            hasCards = (set?.flashcards.length ?? 0) > 0;
            hasTest = (await repos.documents.listPracticeTests()).some((test) => test.sourceMaterialId === target.materialId && test.questions.length > 0);
          } catch {
            continue;
          }
        } else continue;
        // The new guide must show in the app's data before cards are based on it.
        for (let i = 0; i < 80 && !dataRef.current.aiStudySets.some((set) => set.sourceMaterialId === target.materialId); i++) {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        if (!hasCards) await start("flashcards", target, { targetCards: GUIDE_PACK_CARDS, preflight: options.preflight });
        if (!hasTest) await start("practice-test", target, { preflight: options.preflight });
      } finally {
        setPackMaterials((list) => list.filter((id) => id !== target.materialId));
      }
    }
  }, [start]);
  runFollowUpsRef.current = runFollowUps;

  const continueGuide = useCallback(async (key: string, restart = false) => {
    const job = jobsRef.current.find(j => j.key === key);
    if (!job?.sectionGuide || !job.sections || !job.jobId || activeRef.current !== null || recoveryRef.current !== "ready"
      || !["failed", "interrupted", "cancelled", "waiting-for-her"].includes(job.phase)) return;
    activeRef.current = key; // synchronous: a double click can never dispatch twice
    const requestId = newRequestId();
    const now = Date.now();
    const retainedKey = restart ? newKey() : null;
    if (retainedKey) commit([...jobsRef.current, { ...job, key: retainedKey, local: false }]);
    update(key, { phase: "running", error: null, sectionError: undefined, local: true, invoked: true,
      cancelRequested: false, cancelAttempted: false, cancelError: null, requestId, startedAt: now, ...(restart ? { jobId: null, createdAt: now, sections: { ready: 0, total: 0, request: job.sections.request } } : {}) });
    let stop = () => {};
    try {
      try { stop = await watchGeminiProgress(event => {
        const current = jobsRef.current.find(j => j.key === key);
        if (current?.phase === "running" && belongsTo(current, event)) update(key, { jobId: event.jobId ?? current.jobId, stage: event.stage ?? current.stage, progress: event.message ?? current.progress, ...stepStart(current, event), attempt: event.attempt, maxAttempts: event.maxAttempts });
      }); } catch { /* counts still come from the journal */ }
      let request = { ...job.sections.request, requestId };
      if (restart) {
        // A new guide uses today's file and saved revision. The earlier draft stays.
        const material = dataRef.current.materials.find(m => m.id === job.materialId);
        if (!material?.filePath) throw sectionGuideError({ code: "SOURCE_CHANGED" });
        const pdf = await inspectPdf(material.filePath);
        request = { materialId: job.materialId, relativePath: material.filePath, chosenPages: Array.from({ length: pdf.pages }, (_, i) => i + 1),
          baseRevision: dataRef.current.aiStudySets.find(set => set.sourceMaterialId === job.materialId)?.updatedAt ?? null, requestId };
      }
      if (jobsRef.current.find(j => j.key === key)?.cancelRequested) throw sectionGuideError({ code: "CANCELLED" });
      const answer = restart ? await restartStudyGuide(job.jobId, true, request) : await resumeStudyGuide(request, job.jobId);
      const { jobId = job.jobId, contentSha256 = null, checkpointed = false, ...rest } = answer;
      update(key, { jobId, answer: rest, contentSha256, checkpointed, baseRevision: request.baseRevision ?? null,
        filePath: request.relativePath, sections: { ...(jobsRef.current.find(j => j.key === key)?.sections ?? job.sections), request }, phase: "recovered", stage: null, progress: null,
        needsReview: needsRegenerationReview(dataRef.current.aiStudySets.find(set => set.sourceMaterialId === job.materialId)) });
    } catch (error) {
      const safe = sectionGuideError(error);
      update(key, { phase: safe.code === "CANCELLED" ? "cancelled" : "failed", error: safe.message, sectionError: safe.code, stage: null, progress: null });
      try {
        const records = await listGeminiJobs();
        const record = records.find(r => r.id === job.jobId && !restart) ?? (restart ? records.find(r => r.requestId === requestId) : undefined);
        if (record) {
          update(key, { jobId: record.id, sections: sectionDraft(record) ?? job.sections,
            baseRevision: record.baseRevision ?? null, filePath: record.relativePath });
        } else if (retainedKey) {
          // Admission was refused: there is still just the original draft.
          commit(jobsRef.current.filter(j => j.key !== retainedKey));
          update(key, { jobId: job.jobId, sections: job.sections });
        }
      } catch { /* the earlier durable draft remains available on reopen */ }
    } finally { stop(); release(key); }
  }, [commit, release, update]);

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
      await runFollowUpsRef.current();
    },
    [persist, release],
  );

  const saveReviewed = useCallback(
    async (key: string, reviewed: ReviewedRegeneration) => {
      const job = jobsRef.current.find((candidate) => candidate.key === key);
      if (!job || !job.answer || (((job.kind === "study-aid" || job.kind === "flashcards") !== (reviewed.kind === "study-set"))) || (job.phase !== "save-failed" && job.phase !== "recovered")) return false;
      // Extra cards only ever append (saveAgain); they are never a whole replacement.
      if (isMoreCardsJob(job)) return false;
      if (activeRef.current !== null) return false;
      activeRef.current = key;
      let saved = false;
      try {
        saved = await persist(key, reviewed);
      } finally {
        release(key);
      }
      await runFollowUpsRef.current();
      return saved;
    },
    [persist, release],
  );

  /**
   * The student's decision to discard or dismiss: shown as done only once the journal
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
            const effectiveKind = effectiveJobKind(record);
            // Reviewed saves settle through their exact checkpoint, even when
            // their requested part happens to equal the provider's answer.
            if (reviewedSaveOf(record.id)) continue;
            const saved = await savedContent(repositoriesRef.current, effectiveKind, record.materialId);
            if (emptyCards(effectiveKind, record.result)) continue;
            if (alreadySaved(effectiveKind, saved, record.result)) applied.add(record.id);
          } catch {
            // Shown for a deliberate decision instead.
          }
        }
        // Merge against the state as it is now.
        let next = jobsRef.current.map((job): GeminiJob => {
          if (job.sectionGuide && job.phase === "running") {
            const record = records.find(r => job.requestId && r.requestId === job.requestId) ?? records.find(r => r.id === job.jobId);
            if (record) job = { ...job, jobId: record.id, sections: sectionDraft(record) ?? job.sections };
          }
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
          const isWaiting =
            record.draft?.kind === "guide-sections-v1" &&
            record.draft?.queueState === "waiting-for-her" &&
            record.stage !== "cancelled";
          return {
            ...job,
            phase:
              isWaiting
                ? "waiting-for-her"
                : record.stage === "ready"
                  ? "recovered"
                  : record.stage === "cancelled" || record.draft?.queueState === "cancelled"
                    ? "cancelled"
                    : record.stage === "interrupted"
                      ? "interrupted"
                      : "failed",
            queueState: record.draft?.queueState,
            answer: record.stage === "ready" ? (record.result ?? null) : null,
            error: record.stage === "failed" || record.stage === "cancelled" ? (record.error ?? null) : null,
            checkpointed: record.stage === "ready",
            draft: cardDraft(record),
            studyKitPart: record.draft?.kind === "study-kit-part",
            sectionGuide: record.draft?.kind === "guide-sections-v1",
            sections: sectionDraft(record),
            sectionError: recoveredSectionError(record),
            createdAt: job.createdAt ?? record?.createdAt,
          };
        });
        // A recovered running kit becomes its three review jobs once ready.
        const settledKits = jobsRef.current.filter((j) => j.kind === "study-kit" && j.phase === "running" && j.jobId && !j.local
          && records.some((r) => r.id.startsWith(`${j.jobId}#`)));
        next = next.filter(j => !(j.kind === "study-kit" && j.jobId && records.some(r => r.id.startsWith(`${j.jobId}#`))));
        const known = new Set(next.map((job) => job.jobId).filter(Boolean));
        for (const record of records) {
          if (known.has(record.id) || forgottenRef.current.has(record.id)) continue;
          if (applied.has(record.id)) {
            forgottenRef.current.add(record.id);
            pendingAcksRef.current.add(record.id);
            continue;
          }
          const effectiveKind = effectiveJobKind(record);
          // A job this window started is already shown, under its local key.
          const local = next.find(
            (job) => job.jobId === null && job.materialId === record.materialId && job.kind === effectiveKind,
          );
          if (local) continue;
          const isWaiting =
            record.draft?.kind === "guide-sections-v1" &&
            record.draft?.queueState === "waiting-for-her" &&
            record.stage !== "cancelled";
          next = [
            ...next,
            {
              key: newKey(),
              jobId: record.id,
              kind: effectiveKind,
              materialId: record.materialId,
              filePath: record.relativePath,
              phase:
                isWaiting
                  ? "waiting-for-her"
                  : record.stage === "running"
                    ? "running"
                    : record.stage === "ready"
                      ? "recovered"
                      : record.stage === "cancelled" || record.draft?.queueState === "cancelled"
                        ? "cancelled"
                        : record.stage === "interrupted"
                          ? "interrupted"
                          : "failed",
              queueState: record.draft?.queueState,
              progress: null,
              error: record.stage === "failed" || record.stage === "cancelled" ? (record.error ?? null) : null,
              answer: record.stage === "ready" ? (record.result ?? null) : null,
              contentSha256: record.contentSha256 || null,
              baseRevision: record.baseRevision ?? null,
              checkpointed: record.stage === "ready",
              ...(effectiveKind === "practice-test" && reviewedSaveOf(record.id)?.kind === "practice" ? { needsReview: true } : {}),
              draft: cardDraft(record),
              studyKitPart: record.draft?.kind === "study-kit-part",
              sectionGuide: record.draft?.kind === "guide-sections-v1",
              sections: sectionDraft(record),
              sectionError: recoveredSectionError(record),
              requestId: record.requestId ?? (record as unknown as { request_id?: string }).request_id,
              createdAt: record.createdAt,
            },
          ];
        }
        next = next.map(job => emptyCards(job.kind, job.answer)
          ? { ...job, phase: "failed", error: EMPTY_FLASHCARDS_MESSAGE, answer: null }
          : job);
        commit(next);
        for (const kit of settledKits) {
          const parts = records.filter((r) => r.id.startsWith(`${kit.jobId}#`));
          if (parts.some((r) => r.stage === "running")) continue;
          announce(kitNotice(parts.filter((r) => r.stage === "ready" && r.result).length, parts.length));
        }
        const running = next.find((job) => job.phase === "running" && job.jobId !== null && !job.local);
        if (running && activeRef.current === null) activeRef.current = running.key;
        syncPendingCount();
        void flushAcks();
      };
      const queued = reconcileChainRef.current.then(run);
      reconcileChainRef.current = queued.catch(() => {});
      return queued;
    },
    [announce, commit, flushAcks, syncPendingCount],
  );

  const startKitTracked = useCallback(async (target: GeminiJobTarget, options?: StartOptions): Promise<KitStartResult> => {
    const requestId = options?.requestId ?? newRequestId();
    const refused = (message: string): KitStartResult => ({ outcome: "refused", message, sent: false, requestId });
    if (activeRef.current !== null || recoveryRef.current !== "ready") return refused("Wait for the current study aid to finish, then try again.");
    // A failed kit part holds nothing to save, so it never blocks a new kit.
    if (jobsRef.current.some(j => j.materialId === target.materialId && (j.answer || j.sectionGuide))) return refused("Save or discard the earlier drafts first, then make a study kit.");
    const key = newKey();
    let tracked: KitStartResult = { outcome: "failed", sent: false, requestId };
    activeRef.current = key;
    const baseRevision = dataRef.current.aiStudySets.find(s => s.sourceMaterialId === target.materialId)?.updatedAt ?? null;
    const practiceRevision = dataRef.current.practiceTests.find(s => s.sourceMaterialId === target.materialId)?.updatedAt ?? null;
    commit([...jobsRef.current.filter(j => !(j.materialId === target.materialId && j.kind === "study-kit")), { key, jobId: null, kind: "study-kit", materialId: target.materialId, filePath: target.filePath,
      phase: "running", progress: "Making your study kit…", error: null, answer: null, contentSha256: null,
      baseRevision, checkpointed: false, startedAt: Date.now(), createdAt: Date.now(), requestId, local: true }]);
    let stop = () => {};
    try {
      const refusal = await options?.preflight?.();
      if (refusal) { update(key, { phase: "failed", error: refusal }); return { outcome: "refused", message: refusal, shown: true, sent: false, requestId }; }
      try { stop = await watchGeminiProgress(event => {
        const job = jobsRef.current.find(j => j.key === key);
        if (job && belongsTo(job, event)) {
          update(key, { jobId: event.jobId ?? job.jobId, progress: event.message ?? job.progress, stage: event.stage, ...stepStart(job, event) });
          if (event.jobId) options?.onJobId?.(event.jobId);
        }
      }); } catch { /* Progress is optional. */ }
      if (jobsRef.current.find(j => j.key === key)?.cancelRequested) { update(key, { phase: "cancelled", error: CANCELLED_BEFORE_SENDING }); return { outcome: "cancelled", message: CANCELLED_BEFORE_SENDING, sent: false, requestId }; }
      update(key, { invoked: true });
      tracked = { ...tracked, sent: true };
      const result = await generateStudyKit(target, baseRevision, practiceRevision, requestId, options?.expected);
      if (!result.checkpointed || !result.jobId) {
        // A disk failure must not throw away a paid answer the command returned.
        // These drafts stay in this window, with an explicit keep-open message.
        const drafts = ([ ["guide", "study-aid"], ["cards", "flashcards"], ["questions", "practice-test"] ] as const).flatMap(([part, kind]): GeminiJob[] => {
          const content = result.parts[part];
          if (!content) return [];
          return [{ key: newKey(), jobId: null, kind, studyKitPart: true, materialId: target.materialId, filePath: target.filePath,
            phase: content.answer ? "recovered" : "failed", progress: null, error: content.error ?? null, answer: content.answer ?? null,
            contentSha256: result.contentSha256 ?? null, baseRevision: kind === "practice-test" ? practiceRevision : baseRevision,
            checkpointed: false, local: true, createdAt: Date.now() }];
        });
        commit([...jobsRef.current.filter(j => j.key !== key), ...drafts]);
        announce(kitNotice(drafts.filter(d => d.answer).length, 3));
        return { outcome: "memory-only", sent: true, requestId };
      }
      update(key, { jobId: result.jobId });
      // Read the durable checkpoint before dropping the local running notice.
      const records = await listGeminiJobs();
      commit(jobsRef.current.filter(j => j.key !== key));
      await reconcile(records);
      const parts = Object.values(result.parts ?? {}).filter(Boolean) as { answer?: unknown }[];
      announce(kitNotice(parts.filter(p => p.answer).length, 3));
      return { outcome: "checkpointed", jobId: result.jobId, partial: parts.some(p => p.answer) && parts.some(p => !p.answer), sent: true, requestId };
    } catch (error) {
      const message = geminiErrorMessage(error);
      const cancelled = message === GEMINI_CANCELLED_MESSAGE;
      update(key, { phase: cancelled ? "cancelled" : "failed", error: message, progress: null, stage: null });
      // The native side refused before beginning a job: nothing was sent.
      if (message === KIT_PROVIDER_CHANGED) return { outcome: "refused", message, shown: true, sent: false, stale: "provider", requestId };
      if (message === KIT_SOURCE_CHANGED) return { outcome: "refused", message, shown: true, sent: false, stale: "source", requestId };
      // Recovery can still retrieve a finished answer if only the list failed.
      return { ...tracked, outcome: cancelled ? "cancelled" : "failed", message };
    } finally { stop(); release(key); }
  }, [announce, commit, reconcile, release, update]);

  const startKit = useCallback(async (target: GeminiJobTarget, options?: StartOptions) => {
    const result = await startKitTracked(target, options);
    // A preflight refusal is already shown on the job, as before; the other refusals are returned.
    return result.outcome === "refused" && !result.shown ? result.message : undefined;
  }, [startKitTracked]);

  const follow = useCallback(async () => {
    try {
      await reconcile(await listGeminiJobs());
    } catch {
      // Tried again on the next change or tick.
    }
  }, [reconcile]);

  const queueGuide = useCallback(
    async (target: GeminiJobTarget) => {
      if (activeRef.current !== null || recoveryRef.current !== "ready") return null;
      if (jobsRef.current.some((job) => job.materialId === target.materialId && job.kind === "study-aid" && job.sectionGuide)) {
        return null;
      }
      try {
        const pdf = await inspectPdf(target.filePath);
        const saved = dataRef.current.aiStudySets.find((set) => set.sourceMaterialId === target.materialId);
        const baseRevision = saved?.updatedAt ?? null;
        const requestId = newRequestId();
        const request: SectionGuideRequest = {
          materialId: target.materialId,
          relativePath: target.filePath,
          chosenPages: Array.from({ length: pdf.pages }, (_, i) => i + 1),
          baseRevision,
          requestId,
        };
        const jobId = await queueStudyGuide(request);
        await follow();
        return jobId;
      } catch {
        return null;
      }
    },
    [follow],
  );

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
  const followingRunning = jobs.some((job) => job.phase === "running" && (job.sectionGuide || (job.jobId !== null && !job.local)));
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
      makingPack: (materialId: string) => packMaterials.includes(materialId),
      cardsNote: (materialId: string) => cardNotes[materialId] ?? null,
      locked: () => activeRef.current !== null || recoveryRef.current !== "ready",
      recovery,
      retryRecovery,
      start,
      startKit,
      startKitTracked,
      queueGuide,
      continueGuide,
      saveAgain,
      saveReviewed,
      dismiss,
      cancel,
    }),
    // lockTick: the lock is a ref, so its release must change the value for
    // pages reading `locked()` to render again.
    [jobs, packMaterials, cardNotes, recovery, retryRecovery, start, startKit, startKitTracked, queueGuide, continueGuide, saveAgain, saveReviewed, dismiss, cancel, lockTick],
  );

  return <GeminiJobsContext.Provider value={value}>{children}</GeminiJobsContext.Provider>;
}

export function useGeminiJobs(): GeminiJobsValue {
  const context = useContext(GeminiJobsContext);
  if (!context) throw new Error("useGeminiJobs must be used inside AppDataProvider");
  return context;
}
