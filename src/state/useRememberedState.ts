import { useCallback, useState } from "react";

const PREFIX = "her-flight-deck.view.";

/**
 * "session" lasts while the app is open; "device" is a small preference kept
 * on this computer, such as how many flashcards she likes to ask for.
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

/**
 * State that survives leaving the screen and coming back.
 *
 * Filters reset to "Everything" on every visit is a small tax paid over and
 * over. This keeps them for as long as the app is open, and starts each
 * launch clean so a forgotten filter never hides her library the next day.
 */
export function useRememberedState<T>(
  key: string,
  initial: T,
  /** Rejects values from an older version of the app. */
  isValid: (value: unknown) => value is T,
  scope: RememberFor = "session",
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
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
  });

  const remember = useCallback(
    (next: T) => {
      setValue(next);
      const store = storage(scope);
      try {
        store?.setItem(PREFIX + key, JSON.stringify(next));
      } catch {
        // Out of space or unavailable; the filter still applies this visit.
      }
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
