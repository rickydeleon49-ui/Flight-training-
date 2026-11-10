import { useRememberedState, readRemembered, writeRemembered } from "@/state/useRememberedState";
import type { StudyMaterial } from "@/domain/types";

/** Device-local list of material ids she opened, newest first (not synced). */
export const RECENT_KEY = "library.recentlyOpened";
export const RECENT_KEEP = 50;
export const RECENT_SHOWN = 3;

export const isIdList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

/** Puts id first, drops its older copy and keeps the newest `keep`. */
export function pushRecent(ids: readonly string[], id: string, keep: number = RECENT_KEEP): string[] {
  return [id, ...ids.filter((existing) => existing !== id)].slice(0, keep);
}

/** The materials behind the ids, in order; ids with no material left are dropped. */
export function resolveRecent(ids: readonly string[], materials: readonly StudyMaterial[]): StudyMaterial[] {
  const byId = new Map(materials.map((material) => [material.id, material]));
  const out: StudyMaterial[] = [];
  for (const id of ids) {
    const material = byId.get(id);
    if (material) out.push(material);
  }
  return out;
}

/** Called when a material opens; keeps the same stored list the library reads. */
export function recordOpened(id: string): void {
  const current = readRemembered<string[]>(RECENT_KEY, [], isIdList, "device");
  writeRemembered(RECENT_KEY, pushRecent(current, id), "device");
}

export function useRecentlyOpened(): string[] {
  return useRememberedState<string[]>(RECENT_KEY, [], isIdList, "device")[0];
}
