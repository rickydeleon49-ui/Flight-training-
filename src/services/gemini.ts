import { invoke } from "@tauri-apps/api/core";
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

export function geminiErrorMessage(error: unknown): string {
  if (typeof error === "string" && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Gemini could not complete that request.";
}
