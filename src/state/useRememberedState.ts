import { useCallback, useState } from "react";

const PREFIX = "her-flight-deck.view.";

/**
 * "session" lasts while the app is open; "device" is a small preference kept
 * on this computer, such as how many flashcards the student likes to ask for.
 */
export type RememberFor = "session" | "device";

/** Storage can be unavailable; a remembered filter is never worth an error. */
function storage(scope: RememberFor = "session"): Storage | null {
  try {
    return scope === "device" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Reads a remembered value without a hook; bad or missing data gives `initial`. */
export function readRemembered<T>(
  key: string,
  initial: T,
  isValid: (value: unknown) => value is T,
  scope: RememberFor = "session",
): T {
  const store = storage(scope);
  if (!store) return initial;
  try {
    const raw = store.getItem(PREFIX + key);
    if (raw === null) return initial;
    const parsed: unknown = JSON.parse(raw);
    return isValid(parsed) ? parsed : initial;
  } catch {
    return initial;
  }
}

/** Writes a remembered value without a hook; a failed write is ignored. */
export function writeRemembered<T>(key: string, next: T, scope: RememberFor = "session"): void {
  try {
    storage(scope)?.setItem(PREFIX + key, JSON.stringify(next));
  } catch {
    // Out of space or unavailable; the value still applies this visit.
  }
}

/**
 * State that survives leaving the screen and coming back.
 *
 * Filters reset to "Everything" on every visit is a small tax paid over and
 * over. This keeps them for as long as the app is open, and starts each
 * launch clean so a forgotten filter never hides the student's library the next day.
 */
export function useRememberedState<T>(
  key: string,
  initial: T,
  /** Rejects values from an older version of the app. */
  isValid: (value: unknown) => value is T,
  scope: RememberFor = "session",
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => readRemembered(key, initial, isValid, scope));

  const remember = useCallback(
    (next: T) => {
      setValue(next);
      writeRemembered(key, next, scope);
    },
    [key, scope],
  );

  return [value, remember];
}

/** Guard for a value drawn from a known set of strings. */
export function isOneOf<T extends string>(allowed: readonly T[]) {
  return (value: unknown): value is T =>
    typeof value === "string" && (allowed as readonly string[]).includes(value);
}

/** Guard for a number drawn from a known set. */
export function isOneOfNumbers<T extends number>(allowed: readonly T[]) {
  return (value: unknown): value is T =>
    typeof value === "number" && (allowed as readonly number[]).includes(value);
}

/** Guard for free text, such as a search box. */
export const isText = (value: unknown): value is string => typeof value === "string";
