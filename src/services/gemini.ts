import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";

import { isTauri } from "@/data";
import type { PracticeQuestion, StudyFlashcard, StudyGuideSection } from "@/domain/types";

export const GOOGLE_AI_STUDIO_KEY_URL = "https://aistudio.google.com/app/apikey";

/** Which model her documents go to. Kept in step with `ModelChoice` in src-tauri/src/gemini.rs. */
export type GeminiModelChoice = "standard" | "most-capable";

export interface GeminiStatus {
  configured: boolean;
  /** The model documents are sent to first, given her choice. */
  model: string;
  choice: GeminiModelChoice;
}

/** What each choice is called where she reads it. */
export const GEMINI_MODEL_CHOICES: Record<
  GeminiModelChoice,
  { label: string; detail: string }
> = {
  standard: {
    label: "Standard — Gemini Flash",
    detail: "Fast and inexpensive. Works with a free Google AI Studio key.",
  },
  "most-capable": {
    label: "Most capable — Gemini 4 Argon",
    detail:
      "Better with long or complex handbooks, but slower and costs more per document. Needs a key with billing turned on.",
  },
};

/** A model ID as she would read it, e.g. "Gemini 4 Argon". Unknown IDs are shown as they are. */
export function geminiModelName(model: string): string {
  if (typeof model !== "string" || !model) return "Gemini";
  if (model === "gemini-4-argon") return "Gemini 4 Argon";
  if (model.endsWith("-flash-lite")) return "Gemini Flash-Lite";
  if (model.endsWith("-flash")) return "Gemini Flash";
  return model;
}

export interface GeneratedStudyAid {
  title: string;
  summary: string;
  sections: StudyGuideSection[];
  flashcards: StudyFlashcard[];
  sourceNotes: string;
  model: string;
}

export interface GeneratedPracticeTest {
  title: string;
  questions: PracticeQuestion[];
  model: string;
}

// Only ever seen outside the desktop shell, where Gemini cannot run at all.
// Kept in step with MODEL in src-tauri/src/gemini.rs.
const unavailable: GeminiStatus = {
  configured: false,
  model: "gemini-3.5-flash",
  choice: "standard",
};

export const geminiAvailable = (): boolean => isTauri();

export async function getGeminiStatus(): Promise<GeminiStatus> {
  if (!isTauri()) return unavailable;
  return invoke<GeminiStatus>("gemini_status");
}

export async function openGeminiKeyPage(): Promise<void> {
  if (!isTauri()) {
    window.open(GOOGLE_AI_STUDIO_KEY_URL, "_blank", "noopener,noreferrer");
    return;
  }
  await openUrl(GOOGLE_AI_STUDIO_KEY_URL);
}

export async function configureGemini(apiKey: string): Promise<GeminiStatus> {
  if (!isTauri()) throw new Error("Gemini setup needs the desktop application.");
  return invoke<GeminiStatus>("configure_gemini", { apiKey });
}

export async function disconnectGemini(): Promise<GeminiStatus> {
  if (!isTauri()) return unavailable;
  return invoke<GeminiStatus>("disconnect_gemini");
}

/** Choose which model her documents go to. The key is untouched. */
export async function setGeminiModel(choice: GeminiModelChoice): Promise<GeminiStatus> {
  if (!isTauri()) throw new Error("Gemini setup needs the desktop application.");
  return invoke<GeminiStatus>("set_gemini_model", { choice });
}

/**
 * What a generation adds to its answer (GEN-REL-02): the native job it is
 * recorded under, and the SHA-256 of exactly the bytes that were sent. Both
 * are optional so an answer without them is still accepted.
 */
export interface GenerationJobIdentity {
  jobId?: string | null;
  contentSha256?: string;
  /** Whether the answer is kept natively as a checkpoint. */
  checkpointed?: boolean;
}

export type GeminiJobKind = "study-aid" | "practice-test";
export type GeminiJobStage = "running" | "ready" | "failed" | "interrupted" | "cancelled";

/**
 * Where a generation has actually got to (GEN-REL-04). Never a percentage:
 * nothing measures Gemini's own progress.
 */
export type GeminiWorkStage =
  | "preparing"
  | "uploading"
  | "waiting-for-file"
  | "checking-file"
  | "generating"
  | "reading"
  | "validating"
  | "pausing";

/** One progress event, scoped to its job. */
export interface GeminiProgressEvent {
  /** The native job's id, once it has begun. */
  jobId: string | null;
  materialId: string;
  kind: GeminiJobKind;
  stage: GeminiWorkStage | null;
  message: string | null;
  attempt: number;
  maxAttempts: number;
}

/** What asking to cancel came to. */
export interface GeminiCancelOutcome {
  /** True if the job was still running and is now recorded as cancelled. */
  cancelled: boolean;
  stage: GeminiJobStage | null;
  /** True if its job had not begun yet: it will be refused before anything is sent. */
  pending?: boolean;
}

/**
 * The native cancel message, word for word (src-tauri/src/gemini_cancel.rs).
 * A generation that ends with it was cancelled; the journal decided.
 */
export const GEMINI_CANCELLED_MESSAGE =
  "Creating this was cancelled, and nothing was saved. If the request had already reached Google, Google may still have processed it.";

/** One recorded generation, as the native journal keeps it. */
export interface GeminiJobRecord {
  id: string;
  kind: GeminiJobKind;
  materialId: string;
  relativePath: string;
  contentSha256: string;
  /** The saved content's `updatedAt` when she asked, or null if none. */
  baseRevision?: string | null;
  stage: GeminiJobStage;
  createdAt: number;
  updatedAt: number;
  result?: GeneratedStudyAid | GeneratedPracticeTest;
  draft?: { target?: number; cards?: StudyFlashcard[]; timing?: {
    policy: string; ceilingMillis: number; allowedMillis: number; remainingMillis: number;
    deadlineUtc: number; uploadBytes: number; sampleMillis: number; sampleBytes: number;
    activeStage?: GeminiWorkStage;
    stages?: Record<string, { elapsedMillis: number; remainingMillis: number }>;
  } };
  error?: string;
}

export async function generateStudyAid(
  relativePath: string,
  materialId?: string,
  baseRevision?: string,
  requestId?: string,
  targetCards = 40,
): Promise<GeneratedStudyAid & GenerationJobIdentity> {
  if (!isTauri()) throw new Error("Gemini study tools need the desktop application.");
  return invoke<GeneratedStudyAid & GenerationJobIdentity>("generate_study_aid", {
    relativePath,
    materialId,
    baseRevision,
    requestId,
    targetCards,
  });
}

export async function generatePracticeTest(
  relativePath: string,
  materialId?: string,
  baseRevision?: string,
  requestId?: string,
): Promise<GeneratedPracticeTest & GenerationJobIdentity> {
  if (!isTauri()) throw new Error("Gemini study tools need the desktop application.");
  return invoke<GeneratedPracticeTest & GenerationJobIdentity>("generate_practice_test", {
    relativePath,
    materialId,
    baseRevision,
    requestId,
  });
}

/** Every recorded generation: what the window rebuilds itself from. */
export async function listGeminiJobs(): Promise<GeminiJobRecord[]> {
  if (!isTauri()) return [];
  return invoke<GeminiJobRecord[]>("gemini_jobs");
}

/** A finished generation was saved or dismissed: the journal forgets it. */
export async function acknowledgeGeminiJob(jobId: string): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>("acknowledge_gemini_job", { jobId });
}

/** Hear when a recorded generation changes stage. */
export async function watchGeminiJobs(
  onChange: (change: { id: string; stage: GeminiJobStage }) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return () => {};
  return listen<{ id: string; stage: GeminiJobStage }>("gemini-job", (event) => {
    onChange(event.payload);
  });
}

/**
 * Follow along while a request is being waited out.
 *
 * A busy model means several pauses before an answer, and a spinner that says
 * nothing for half a minute reads as a hang. The Rust side sends the sentence;
 * this only carries it. Returns a function that stops listening.
 */
export async function watchGeminiProgress(
  onProgress: (event: GeminiProgressEvent) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return () => {};
  return listen<GeminiProgressEvent>("gemini-progress", (event) => {
    onProgress(event.payload);
  });
}

/**
 * Ask to cancel a running generation. The native journal decides: a job that
 * already finished keeps its answer, and the outcome says so.
 */
export async function cancelGeminiJob(target: {
  requestId?: string;
  jobId?: string;
}): Promise<GeminiCancelOutcome> {
  if (!isTauri()) return { cancelled: false, stage: null };
  return invoke<GeminiCancelOutcome>("cancel_gemini_job", {
    requestId: target.requestId,
    jobId: target.jobId,
  });
}

export function geminiErrorMessage(error: unknown): string {
  if (typeof error === "string" && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Gemini could not complete that request.";
}
