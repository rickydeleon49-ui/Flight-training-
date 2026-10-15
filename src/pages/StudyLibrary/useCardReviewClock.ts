/**
 * Display-only clock for the material on screen (M2 relearning readiness).
 *
 * An Again card becomes due at an exact instant while the material can stay
 * open. The panel recomputes its summary from the injected clock on every
 * render, so all this hook does is cause one render when that instant
 * arrives, and another when she comes back to the window:
 *
 * - One owned timer, aimed at the earliest future Again instant among the
 *   current, reviewable cards of the latest authoritative snapshot. Paused,
 *   flagged, earlier-version and day-ladder cards never wake it.
 * - Window focus and a return to a visible document render with the current
 *   clock and re-arm, which also covers timers delayed by sleep and clock
 *   movement in either direction.
 * - A timer that fires before its instant (the clock moved back) re-arms no
 *   sooner than a second later; there is no polling and no loop.
 * - Callbacks only bump a counter. They never read or write, start or
 *   advance a session, or touch a pending operation.
 */
import { useEffect, useState } from "react";

import type { CardReviewSnapshot } from "@/domain/types";

/** Setting a timer above 2^31 − 1 ms fires it at once; stay just below. */
export const MAX_CLOCK_DELAY = 2_147_000_000;
/** The shortest re-arm after a timer fired before its instant. */
export const EARLY_RETRY_DELAY = 1_000;

/** The earliest Again instant strictly after `nowIso`, or null. Mirrors `summarizeCards`. */
export function nextAgainDueAt(snapshot: CardReviewSnapshot | null, nowIso: string): string | null {
  if (!snapshot || snapshot.current.status !== "ok") return null;
  let next: string | null = null;
  for (const item of snapshot.current.items) {
    const state = snapshot.states[item.itemId];
    if (!state || state.suspended || state.flag !== null || state.dueAt === null || state.step >= 0) continue;
    if (state.dueAt > nowIso && (next === null || state.dueAt < next)) next = state.dueAt;
  }
  return next;
}

/**
 * Renders the caller when the next Again card becomes due, and on focus or
 * return to a visible window. `snapshot` is the snapshot being shown (null
 * while loading or for another material); `owner` changes with the material
 * or its saved cards. Returns a counter that changes with each clock render.
 */
export function useCardReviewClock(snapshot: CardReviewSnapshot | null, clock: { now: () => string }, owner: string): number {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let aimedAt: string | null = null;

    const arm = (afterFire: boolean) => {
      clearTimeout(timer);
      timer = undefined;
      const now = clock.now();
      const next = nextAgainDueAt(snapshot, now);
      const early = afterFire && next !== null && next === aimedAt;
      aimedAt = next;
      if (next === null) return;
      const wait = Date.parse(next) - Date.parse(now);
      if (!Number.isFinite(wait)) return;
      const delay = Math.min(Math.max(wait, early ? EARLY_RETRY_DELAY : 0), MAX_CLOCK_DELAY);
      timer = setTimeout(fire, delay);
    };
    const fire = () => {
      timer = undefined;
      if (!active) return;
      setTick((value) => value + 1);
      arm(true);
    };
    const onResume = () => {
      if (!active || document.visibilityState === "hidden") return;
      setTick((value) => value + 1);
      arm(false);
    };

    arm(false);
    window.addEventListener("focus", onResume);
    document.addEventListener("visibilitychange", onResume);
    return () => {
      active = false;
      clearTimeout(timer);
      window.removeEventListener("focus", onResume);
      document.removeEventListener("visibilitychange", onResume);
    };
  }, [snapshot, clock, owner]);

  return tick;
}
