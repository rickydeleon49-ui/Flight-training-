/**
 * Study packs (PACK-01): typed wrappers over the native commands. Nothing here
 * decides what is added; the native side does. Paths only ever come from a
 * system dialog the student answered.
 */
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

import { isTauri } from "@/data";

export interface StudyPackPreview {
  guides: number;
  cards: number;
  questions: number;
  videos: number;
  documents: number;
  alreadyInLibrary: number;
}

export interface StudyPackResult {
  operationId: string;
  packId: string;
  added: number;
  addedGuides: number;
  addedDocuments: number;
  addedPictures: number;
  addedPractice: number;
  skipped: number;
  newVersions: number;
  readded: number;
  cardsLeftOut: number;
  cardsLeftOutRemoved: number;
  committedAt: string;
}

export interface StudyPackExportSummary {
  items: number;
  documents: number;
  guides: number;
  cards: number;
  questions: number;
  videos: number;
  cardsLeftOut: number;
}

export const studyPacksAvailable = (): boolean => isTauri();

const needsDesktop = () => new Error("Study packs need the desktop application.");

/** Native commands fail with a plain sentence; anything else (a transport error) gets `fallback`. */
export function studyPackErrorMessage(error: unknown, fallback: string): string {
  if (typeof error !== "string") return fallback;
  const text = error.startsWith(REFUSED_MARK) ? error.slice(REFUSED_MARK.length) : error;
  return text.trim() ? text : fallback;
}

/** The app marks an add it definitely refused. Any other failure (a lost connection, an unknown outcome) is not proof. */
export const REFUSED_MARK = "refused: ";
export function isDefiniteRefusal(error: unknown): boolean {
  return typeof error === "string" && error.startsWith(REFUSED_MARK) && error.slice(REFUSED_MARK.length).trim() !== "";
}

/** Ask which pack to add. Null when the user cancels. */
export async function chooseStudyPack(): Promise<string | null> {
  if (!isTauri()) throw needsDesktop();
  const selected = await open({
    multiple: false,
    directory: false,
    title: "Choose a study pack",
    filters: [{ name: "Study pack", extensions: ["hfdpack"] }],
  });
  return typeof selected === "string" ? selected : null;
}

/** Ask where to save a pack. Null when the user cancels. */
export async function chooseStudyPackDestination(): Promise<string | null> {
  if (!isTauri()) throw needsDesktop();
  return save({
    title: "Save a study pack",
    defaultPath: "study-pack.hfdpack",
    filters: [{ name: "Study pack", extensions: ["hfdpack"] }],
  });
}

export async function inspectStudyPack(sourcePath: string): Promise<StudyPackPreview> {
  if (!isTauri()) throw needsDesktop();
  return invoke<StudyPackPreview>("inspect_study_pack", { sourcePath });
}

/** `opId` is a fresh lowercase UUIDv4; asking again with it is recognised. */
export async function addStudyPack(opId: string, sourcePath: string): Promise<StudyPackResult> {
  if (!isTauri()) throw needsDesktop();
  return invoke<StudyPackResult>("add_study_pack", { opId, sourcePath });
}

export async function exportStudyPack(destinationPath: string, materialIds: string[]): Promise<StudyPackExportSummary> {
  if (!isTauri()) throw needsDesktop();
  return invoke<StudyPackExportSummary>("export_study_pack", { destinationPath, materialIds });
}

/** What an earlier `addStudyPack(opId)` did, or null when it never finished. */
export async function studyPackResult(opId: string): Promise<StudyPackResult | null> {
  if (!isTauri()) return null;
  return invoke<StudyPackResult | null>("study_pack_result", { opId });
}

export async function pendingStudyPackResults(): Promise<StudyPackResult[]> {
  if (!isTauri()) return [];
  return invoke<StudyPackResult[]>("pending_study_pack_results");
}

export async function ackStudyPackResult(opId: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("ack_study_pack_result", { opId });
}

/** Finish or undo any pack that did not finish. Safe to call at any time. */
export async function reconcileStudyPacks(): Promise<void> {
  if (!isTauri()) return;
  await invoke("reconcile_study_pack_imports");
}
