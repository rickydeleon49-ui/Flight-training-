import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";

import { isTauri } from "@/data";
import { newId } from "@/lib/id";
import type { PracticeQuestion, StudyFlashcard, StudyGuideSection } from "@/domain/types";
import { DesktopOnlyError } from "./documents";

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
    label: "Standard — Gemini 3.5 Flash",
    detail: "Fast and inexpensive. Works with a free Google AI Studio key.",
  },
  "most-capable": {
    label: "Most capable — Gemini 3.8 Flash",
    detail:
      "Newer and a little more thorough; may use slightly more of your Google credits.",
  },
};

/** A model ID as she would read it. Historical models keep their original labels. */
export function geminiModelName(model: string): string {
  if (typeof model !== "string" || !model) return "Gemini";
  if (model === "gemini-4-argon") return "Gemini 4 Argon";
  if (model === "gemini-3.5-flash") return "Gemini 3.5 Flash";
  if (model === "gemini-3.8-flash") return "Gemini 3.8 Flash";
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

export type GeminiJobKind = "study-aid" | "practice-test" | "flashcards";
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
  requestId?: string;
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
  draft?: { kind?: string; queueState?: "waiting-for-her" | "running" | "paused" | "cancelled"; identity?: { chosenPages: number[]; baseRevision?: string | null; manifest: Array<{ id: string; heading: string; pageStart: number; pageEnd: number }> }; results?: Record<string, { status: "pending" | "in-flight" | "complete" }>; target?: number; cards?: StudyFlashcard[]; timing?: {
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

export interface AskGeminiHistoryTurn {
  role: "user" | "model";
  text: string;
}

export interface AskGeminiParams {
  requestId?: string;
  relativePath?: string | null;
  materialId: string;
  context: string;
  question: string;
  history?: AskGeminiHistoryTurn[];
}

export interface AskGeminiResult {
  model: string;
  answer: string;
  sourcePages: number[];
}

/**
 * Ask Gemini a question about a study document or practice test question.
 *
 * Desktop only: throws DesktopOnlyError in browser mode.
 */
export async function askGemini(
  paramsOrRelativePath: AskGeminiParams | string | null | undefined,
  maybeMaterialId?: string,
  maybeContext?: string,
  maybeQuestion?: string,
  maybeHistory?: AskGeminiHistoryTurn[],
): Promise<AskGeminiResult | null> {
  if (!isTauri()) throw new DesktopOnlyError();
  const params: AskGeminiParams =
    typeof paramsOrRelativePath === "object" && paramsOrRelativePath !== null
      ? paramsOrRelativePath
      : {
          relativePath: paramsOrRelativePath,
          materialId: maybeMaterialId ?? "",
          context: maybeContext ?? "",
          question: maybeQuestion ?? "",
          history: maybeHistory ?? [],
        };

  return invoke<AskGeminiResult | null>("ask_gemini", {
    requestId: params.requestId ?? newId(),
    relativePath: params.relativePath ?? null,
    materialId: params.materialId,
    context: params.context,
    question: params.question,
    history: params.history ?? [],
  });
}

export interface AskGeminiProgressEvent {
  requestId: string;
  message: string;
}

/** Native wording for just one interactive question, without storing a chat. */
export async function watchAskGeminiProgress(
  onProgress: (event: AskGeminiProgressEvent) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return () => {};
  return listen<AskGeminiProgressEvent>("ask-gemini-progress", (event) => {
    onProgress(event.payload);
  });
}

export async function cancelAskGemini(requestId: string): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("cancel_ask_gemini", { requestId });
}

/** Every recorded generation: what the window rebuilds itself from. */
export async function listGeminiJobs(): Promise<GeminiJobRecord[]> {
  if (!isTauri()) return [];
  const jobs = await invoke<GeminiJobRecord[]>("gemini_jobs");
  return jobs.filter(job => job.kind === "study-aid" || job.kind === "practice-test");
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

/** Only these safe messages cross the section-guide error boundary. */
export const SECTION_GUIDE_MESSAGES = {
  SOURCE_CHANGED: "This PDF or your chosen pages changed. Keep your earlier work, or start a new guide?",
  PLAN_CHANGED: "Her Flight Deck was updated since this guide started. Keep your earlier sections, or start a new guide?",
  CONSENT_REQUIRED: "Choose whether to keep your earlier work or start a new guide.",
  TOO_MANY_SECTIONS: "Choose fewer pages so your guide has at most 40 sections.",
  KEY_CHANGED: "Your Gemini key changed. Continue starts a new guide and may upload the PDF again. Your earlier sections are kept.",
  REFERENCE_AUTH_FAILED: "Google could not open the saved PDF with this key. Your sections are kept; nothing was uploaded.",
  REFERENCE_LOOKUP_FAILED: "The saved PDF could not be checked. Your sections are kept; nothing was uploaded.",
  DESCRIPTOR_INVALID: "The saved PDF reference could not be checked. Your sections are kept; nothing was uploaded.",
  CANCELLED: "Stopped. Your finished sections are kept.",
  UPLOAD_TIMEOUT: "The upload stopped moving. Your finished sections are kept.",
  PROCESSING_TIMEOUT: "Google is taking longer to prepare the PDF. Your finished sections are kept.",
  GENERATION_TIMEOUT: "Gemini is taking longer to answer. Your finished sections are kept.",
  READING_TIMEOUT: "The rest of the answer stopped arriving. Your finished sections are kept.",
  STAGE_TIMEOUT: "This step took longer than expected. Your finished sections are kept.",
  GUIDE_PAUSED: "Your guide could not be finished. Your saved sections are kept. Try again when you're ready.",
} as const;
export type SectionGuideErrorCode = keyof typeof SECTION_GUIDE_MESSAGES;
export class SectionGuideError extends Error {
  constructor(readonly code: SectionGuideErrorCode) {
    super(SECTION_GUIDE_MESSAGES[code]);
    this.name = "SectionGuideError";
  }
}
export function sectionGuideError(error: unknown): SectionGuideError {
  if (error instanceof SectionGuideError) return error;
  const wire = error && typeof error === "object" ? error as { code?: unknown; message?: unknown } : null;
  if (typeof wire?.code === "string" && Object.hasOwn(SECTION_GUIDE_MESSAGES, wire.code) && wire.code !== "GUIDE_PAUSED") {
    return new SectionGuideError(wire.code as SectionGuideErrorCode);
  }
  // Legacy stage failures arrive inside GUIDE_PAUSED, as fixed native sentences.
  const message = typeof error === "string" ? error : wire?.message;
  const known: Record<string, SectionGuideErrorCode> = {
    [GEMINI_CANCELLED_MESSAGE]: "CANCELLED",
    "This PDF or your chosen pages changed. Keep your earlier work, or explicitly start a new guide.": "SOURCE_CHANGED",
    "Her Flight Deck was updated since this guide started. Keep your earlier sections, or start a new guide?": "PLAN_CHANGED",
    "Her Flight Deck was updated since this guide started. Keep your earlier sections, or explicitly start a new guide.": "PLAN_CHANGED",
    "The Gemini key or project changed. Explicit Continue is required before preparing this PDF again.": "KEY_CHANGED",
    "The saved PDF reference could not be validated. Your sections are kept; nothing was uploaded.": "DESCRIPTOR_INVALID",
    "Google refused access to the saved PDF. Check the key and project; nothing was uploaded.": "REFERENCE_AUTH_FAILED",
    "The saved PDF could not be checked. Your sections are kept; nothing was uploaded.": "REFERENCE_LOOKUP_FAILED",
    "The upload stopped moving. Your saved work is still here.": "UPLOAD_TIMEOUT",
    "The rest of the answer stopped arriving.": "READING_TIMEOUT",
    "Google was still preparing this PDF after waiting, so no study aid was made. Try again in a few minutes.": "PROCESSING_TIMEOUT",
    "Gemini is taking longer to answer. You can try again.": "GENERATION_TIMEOUT",
  };
  if (typeof message === "string" && Object.hasOwn(known, message)) return new SectionGuideError(known[message]!);
  if (typeof message === "string" && (/^Her Flight Deck stopped before [^:]+: the 15 minutes it allows for one study aid had run out\./.test(message) || message === "This took longer than 15 minutes, so Her Flight Deck paused. Your finished sections are kept — Try again to continue.")) return new SectionGuideError("STAGE_TIMEOUT");
  return new SectionGuideError("GUIDE_PAUSED");
}
export interface SectionGuideRequest {
  materialId: string;
  relativePath: string;
  chosenPages: number[];
  baseRevision?: string | null;
  requestId?: string;
}
export async function queueStudyGuide(request: SectionGuideRequest): Promise<string> {
  if (!isTauri()) return "mock-queue-id";
  try {
    return await invoke<string>("queue_study_guide", { request });
  } catch (error) { throw sectionGuideError(error); }
}

export async function resumeStudyGuide(request: SectionGuideRequest, jobId?: string): Promise<GeneratedStudyAid & GenerationJobIdentity> {
  if (!isTauri()) throw new SectionGuideError("GUIDE_PAUSED");
  try {
    return await invoke<GeneratedStudyAid & GenerationJobIdentity>("resume_study_guide", { request, jobId });
  } catch (error) { throw sectionGuideError(error); }
}
export async function restartStudyGuide(jobId: string, consent: boolean, request: SectionGuideRequest): Promise<GeneratedStudyAid & GenerationJobIdentity> {
  if (!isTauri()) throw new SectionGuideError("GUIDE_PAUSED");
  try {
    return await invoke<GeneratedStudyAid & GenerationJobIdentity>("restart_study_guide", { jobId, consent, request });
  } catch (error) { throw sectionGuideError(error); }
}
