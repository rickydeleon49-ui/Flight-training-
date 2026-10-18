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

export async function generateStudyAid(relativePath: string): Promise<GeneratedStudyAid> {
  if (!isTauri()) throw new Error("Gemini study tools need the desktop application.");
  return invoke<GeneratedStudyAid>("generate_study_aid", { relativePath });
}

export async function generatePracticeTest(relativePath: string): Promise<GeneratedPracticeTest> {
  if (!isTauri()) throw new Error("Gemini study tools need the desktop application.");
  return invoke<GeneratedPracticeTest>("generate_practice_test", { relativePath });
}

/**
 * Follow along while a request is being waited out.
 *
 * A busy model means several pauses before an answer, and a spinner that says
 * nothing for half a minute reads as a hang. The Rust side sends the sentence;
 * this only carries it. Returns a function that stops listening.
 */
export async function watchGeminiProgress(
  onMessage: (message: string) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return () => {};
  return listen<{ message: string }>("gemini-progress", (event) => {
    onMessage(event.payload.message);
  });
}

export function geminiErrorMessage(error: unknown): string {
  if (typeof error === "string" && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Gemini could not complete that request.";
}
