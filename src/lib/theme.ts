/**
 * Colour theme preference: Light, Dark or Auto (follow the system).
 *
 * Persisted in localStorage like the appearance choice. public/theme-boot.js
 * applies the same rule before first paint; keep the two in step.
 * iPhone is Auto only: the iOS status bar follows the system, never data-theme.
 */
import { isTauri } from "@/data";
import { isIOS } from "@/services/platform";

export type ThemeChoice = "light" | "dark" | "auto";

export const THEME_STORAGE_KEY = "her-flight-deck.theme";
/** Mac and browser stay Light until DESIGN-01 slice 25 switches the default to "auto". */
export const DEFAULT_THEME: ThemeChoice = isIOS() ? "auto" : "light";

function getStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === "light" || value === "dark" || value === "auto";
}

/** Reads the saved theme. On iPhone always "auto". */
export function getStoredTheme(): ThemeChoice {
  if (isIOS()) return "auto";
  const fallback: ThemeChoice = "light"; // Mac/browser default until slice 25
  const store = getStorage();
  if (!store) return fallback;
  try {
    const raw = store.getItem(THEME_STORAGE_KEY);
    if (!raw) return fallback;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isThemeChoice(parsed)) return parsed;
    } catch {
      // not JSON; test plain string
    }
    if (isThemeChoice(raw)) return raw;
    return fallback;
  } catch {
    return fallback;
  }
}

export function setStoredTheme(theme: ThemeChoice): void {
  const store = getStorage();
  if (!store) return;
  try {
    store.setItem(THEME_STORAGE_KEY, JSON.stringify(theme));
  } catch {
    // storage full or blocked; the choice still applies for this session
  }
}

function setNativeTheme(theme: ThemeChoice): void {
  if (!isTauri() || isIOS()) return;
  try {
    void import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => getCurrentWindow().setTheme(theme === "auto" ? null : theme))
      .catch(() => {});
  } catch {
    // native title bar theme is a nicety; ignore failures
  }
}

/** Light/Dark set data-theme; Auto removes it. iPhone ignores the choice (Auto). */
export function applyTheme(theme: ThemeChoice): void {
  if (typeof document === "undefined") return;
  const effective: ThemeChoice = isIOS() ? "auto" : theme;
  if (effective === "auto") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", effective);
  }
  setNativeTheme(effective);
}

/** Reads the saved theme and applies it. Called at startup next to initAppearance. */
export function initTheme(): ThemeChoice {
  const theme = getStoredTheme();
  applyTheme(theme);
  return theme;
}
