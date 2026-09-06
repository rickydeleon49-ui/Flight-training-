import { useCallback, useState } from "react";

const PREFIX = "her-flight-deck.view.";

/** Storage can be unavailable; a remembered filter is never worth an error. */
function storage(): Storage | null {
  try {
    return window.sessionStorage;
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
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const store = storage();
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
      const store = storage();
      try {
        store?.setItem(PREFIX + key, JSON.stringify(next));
      } catch {
        // Out of space or unavailable; the filter still applies this visit.
      }
    },
    [key],
  );

  return [value, remember];
}

/** Guard for a value drawn from a known set of strings. */
export function isOneOf<T extends string>(allowed: readonly T[]) {
  return (value: unknown): value is T =>
    typeof value === "string" && (allowed as readonly string[]).includes(value);
}

/** Guard for free text, such as a search box. */
export const isText = (value: unknown): value is string => typeof value === "string";
