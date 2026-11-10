import { useEffect, useRef } from "react";

import { todayIso } from "@/lib/dates";
import { cancelDaily, notify, scheduleDaily } from "@/services/notify";
import { schedulesDailyReminder } from "@/services/platform";
import { useAppData } from "@/state/AppDataContext";

export const STUDY_REMINDER_TITLE = "Your Flight Deck";
// Generic on purpose: no study content shows on a lock screen.
export const STUDY_REMINDER_BODY = "Time for a short study session.";
const GRACE_MS = 10 * 60_000;
const MAX_WAIT_MS = 60_000;

export const studyReminderKey = (day: string) => `her-flight-deck-study-reminder-${day}`;

/** Today's HH:MM as a local Date, built from the wall clock (so DST is handled). */
function targetToday(now: Date, time: string): Date {
  const [h, m] = time.split(":").map(Number);
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), h ?? 0, m ?? 0, 0, 0);
}

function firedToday(day: string): boolean {
  try { return localStorage.getItem(studyReminderKey(day)) !== null; } catch { return false; }
}
function markFired(day: string) {
  try { localStorage.setItem(studyReminderKey(day), "sent"); } catch { /* still fine */ }
}

/**
 * Daily study reminder. iPhone: one repeating system notice, replaced or
 * cancelled when the switch or time changes. Mac: a notice while the app runs,
 * at most once per local day, and never late (opening the app after the time
 * shows nothing). Time is re-read from the clock on every tick, focus and wake.
 */
export function DailyStudyReminder() {
  const { data, status } = useAppData();
  const reminder = data.toolkit.studyReminder;
  const enabled = status === "ready" && reminder?.enabled === true;
  const time = reminder?.time ?? "19:00";
  const scheduled = schedulesDailyReminder();
  const lastCheck = useRef<number>(Date.now());

  useEffect(() => {
    if (status !== "ready" || !scheduled) return;
    if (enabled) void scheduleDaily(time, STUDY_REMINDER_TITLE, STUDY_REMINDER_BODY);
    else void cancelDaily();
  }, [status, scheduled, enabled, time]);

  useEffect(() => {
    if (!enabled || scheduled) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    lastCheck.current = Date.now();

    const check = () => {
      const now = new Date();
      const target = targetToday(now, time);
      const day = todayIso();
      // The time passed since the last look (running, or woke up soon after).
      if (lastCheck.current < target.getTime() && target.getTime() <= now.getTime()
        && now.getTime() - target.getTime() <= GRACE_MS && !firedToday(day)) {
        markFired(day);
        void notify(STUDY_REMINDER_TITLE, STUDY_REMINDER_BODY);
      }
      lastCheck.current = now.getTime();
    };

    const arm = () => {
      if (timer !== null) clearTimeout(timer);
      const wait = targetToday(new Date(), time).getTime() - Date.now();
      // Short waits only: the clock is read again each time, so sleep and DST cannot skew it.
      timer = setTimeout(() => { check(); arm(); }, wait > 0 ? Math.min(wait + 50, MAX_WAIT_MS) : MAX_WAIT_MS);
    };

    const onResume = () => {
      if (document.visibilityState === "hidden") return;
      check();
      arm();
    };

    arm();
    window.addEventListener("focus", onResume);
    document.addEventListener("visibilitychange", onResume);
    return () => {
      if (timer !== null) clearTimeout(timer);
      window.removeEventListener("focus", onResume);
      document.removeEventListener("visibilitychange", onResume);
    };
  }, [enabled, scheduled, time]);

  return null;
}
