import { useEffect } from "react";

import { parseIsoDate, addDays, todayIso } from "@/lib/dates";
import { CHECKRIDE_MILESTONES, CHECKRIDE_TITLE, checkrideBody, daysToCheckride } from "@/logic/checkride";
import { cancelCheckride, notify, scheduleCheckride } from "@/services/notify";
import { schedulesDailyReminder } from "@/services/platform";
import { useAppData } from "@/state/AppDataContext";

const NOTICE_HOUR = 9;
const RECHECK_MS = 30 * 60_000;

export const checkrideNoticeKey = (date: string, days: number) => `flight-deck-checkride-${date}-${days}`;

function fired(key: string): boolean {
  try { return localStorage.getItem(key) !== null; } catch { return false; }
}
function markFired(key: string) {
  try { localStorage.setItem(key, "sent"); } catch { /* still fine */ }
}

/**
 * Checkride countdown notices at 30, 7 and 1 days before, and none after.
 * Only works once notifications are already allowed (it never asks). iPhone: three
 * one-off system notices at 9:00, replaced when the date changes and cancelled when
 * it is cleared. Mac: a notice while the app runs, once per milestone.
 */
export function CheckrideNotifications() {
  const { data, status } = useAppData();
  const date = status === "ready" ? (data.toolkit.checkrideDate ?? null) : null;
  const scheduled = schedulesDailyReminder();

  useEffect(() => {
    if (status !== "ready" || !scheduled) return;
    if (!date) { void cancelCheckride(); return; }
    const now = Date.now();
    const notices = CHECKRIDE_MILESTONES
      .map((days) => {
        const day = parseIsoDate(addDays(date, -days));
        day.setHours(NOTICE_HOUR, 0, 0, 0);
        return { at: day, title: CHECKRIDE_TITLE, body: checkrideBody(days) };
      })
      .filter((n) => n.at.getTime() > now);
    void scheduleCheckride(notices);
  }, [status, scheduled, date]);

  useEffect(() => {
    if (!date || scheduled) return;
    const check = () => {
      const days = daysToCheckride(date, todayIso());
      if (days === null || !(CHECKRIDE_MILESTONES as readonly number[]).includes(days)) return;
      const key = checkrideNoticeKey(date, days);
      if (fired(key)) return;
      // Mark only once it was really shown, so a later permission grant still gets it.
      void notify(CHECKRIDE_TITLE, checkrideBody(days)).then((shown) => { if (shown) markFired(key); });
    };
    const onResume = () => { if (document.visibilityState !== "hidden") check(); };
    check();
    const timer = setInterval(check, RECHECK_MS);
    window.addEventListener("focus", onResume);
    document.addEventListener("visibilitychange", onResume);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onResume);
      document.removeEventListener("visibilitychange", onResume);
    };
  }, [date, scheduled]);

  return null;
}
