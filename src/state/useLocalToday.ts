import { useEffect, useState } from "react";

import type { IsoDate } from "@/domain/types";
import { todayIso } from "@/lib/dates";

/** Milliseconds from `now` until the next local midnight, plus a small margin. */
export function msUntilNextLocalMidnight(now: Date = new Date()): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  // A second past midnight so the clock is unambiguously on the new day.
  return Math.max(1_000, next.getTime() - now.getTime() + 1_000);
}

/**
 * Today's local calendar date, kept current while the screen stays mounted.
 *
 * One timer is scheduled for the next local midnight (never a polling loop).
 * Timers can fire late or not at all while a laptop sleeps or the window is in
 * the background, so the date is also re-read when the window regains focus or
 * becomes visible again. Everything is cleaned up on unmount.
 */
export function useLocalToday(): IsoDate {
  const [today, setToday] = useState<IsoDate>(() => todayIso());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const check = () => {
      setToday((previous) => {
        const current = todayIso();
        return current === previous ? previous : current;
      });
    };

    const schedule = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        check();
        schedule();
      }, msUntilNextLocalMidnight());
    };

    const onResume = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      check();
      // The pending timer may be stale after sleep; aim it at the next midnight again.
      schedule();
    };

    schedule();
    window.addEventListener("focus", onResume);
    document.addEventListener("visibilitychange", onResume);

    return () => {
      if (timer !== null) clearTimeout(timer);
      window.removeEventListener("focus", onResume);
      document.removeEventListener("visibilitychange", onResume);
    };
  }, []);

  return today;
}
