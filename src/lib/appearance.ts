/**
 * Visual appearance preference: Classic (standard) or Glass (frosted cards).
 *
 * Persisted in localStorage so the choice survives an app restart without
 * requiring a database schema migration.
 */

export type Appearance = "classic" | "glass";

export const APPEARANCE_STORAGE_KEY = "her-flight-deck.appearance";
export const DEFAULT_APPEARANCE: Appearance = "classic";

function getStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function isAppearance(value: unknown): value is Appearance {
  return value === "classic" || value === "glass";
}

/** Reads the saved appearance preference, defaulting to "classic". */
export function getStoredAppearance(): Appearance {
  const store = getStorage();
  if (!store) return DEFAULT_APPEARANCE;
  try {
    const raw = store.getItem(APPEARANCE_STORAGE_KEY);
    if (!raw) return DEFAULT_APPEARANCE;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isAppearance(parsed)) return parsed;
    } catch {
      // not JSON; test plain string
    }
    if (isAppearance(raw)) return raw;
    return DEFAULT_APPEARANCE;
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

/** Persists the appearance preference in localStorage. */
export function setStoredAppearance(appearance: Appearance): void {
  const store = getStorage();
  if (!store) return;
  try {
    store.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(appearance));
  } catch {
    // LocalStorage full or blocked; preference still applies for this session
  }
}

/**
 * Applies the appearance choice to the document root element.
 * Sets data-appearance="glass" for glass, or removes the attribute for classic.
 */
export function applyAppearance(appearance: Appearance): void {
  if (typeof document === "undefined") return;
  if (appearance === "glass") {
    document.documentElement.setAttribute("data-appearance", "glass");
  } else {
    document.documentElement.removeAttribute("data-appearance");
  }
}

/**
 * Reads the saved appearance and applies it immediately to the root document.
 * Called at app startup before rendering to prevent visual flashing.
 */
export function initAppearance(): Appearance {
  const appearance = getStoredAppearance();
  applyAppearance(appearance);
  return appearance;
}
