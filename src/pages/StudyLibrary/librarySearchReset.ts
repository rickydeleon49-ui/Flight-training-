import { useEffect } from "react";
import { useLocation } from "react-router-dom";

import { writeRemembered } from "@/state/useRememberedState";

/** The key StudyLibrary uses for its remembered search box. */
export const LIBRARY_SEARCH_KEY = "library.search";

/**
 * The Library area is /study and everything under it. Moving between the list,
 * a material, and its back link stays inside the area, so the words are kept.
 */
export function isLibraryPath(pathname: string): boolean {
  return pathname === "/study" || pathname.startsWith("/study/");
}

/**
 * Clears the remembered Library search when the student leaves the Library
 * area, so coming back shows an empty search and the full list.
 * Mount once in the app shell so it sees every route change.
 */
export function useClearLibrarySearchOnLeave(): void {
  const { pathname } = useLocation();
  useEffect(() => {
    if (!isLibraryPath(pathname)) writeRemembered(LIBRARY_SEARCH_KEY, "");
  }, [pathname]);
}
