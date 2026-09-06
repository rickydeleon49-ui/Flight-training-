import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";

import { isTauri } from "@/data";
import type { StudyFlashcard, StudyGuideSection } from "@/domain/types";

export const GOOGLE_AI_STUDIO_KEY_URL = "https://aistudio.google.com/app/apikey";

export interface GeminiStatus {
  configured: boolean;
  model: string;
}

export interface GeneratedStudyAid {
  title: string;
  summary: string;
  sections: StudyGuideSection[];
  flashcards: StudyFlashcard[];
  sourceNotes: string;
  model: string;
}

// Only ever seen outside the desktop shell, where Gemini cannot run at all.
// Kept in step with MODEL in src-tauri/src/gemini.rs.
const unavailable: GeminiStatus = { configured: false, model: "gemini-3.5-flash" };

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

export async function generateStudyAid(relativePath: string): Promise<GeneratedStudyAid> {
  if (!isTauri()) throw new Error("Gemini study tools need the desktop application.");
  return invoke<GeneratedStudyAid>("generate_study_aid", { relativePath });
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
