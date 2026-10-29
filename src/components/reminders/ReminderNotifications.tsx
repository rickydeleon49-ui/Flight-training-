import { useEffect, useMemo } from "react";

import { todayIso } from "@/lib/dates";
import { buildReminders } from "@/logic/toolkit";
import { useAppData } from "@/state/AppDataContext";

/** Reminders are viewed in Pilot Toolkit; this only sends permitted OS notices. */
export function ReminderNotifications() {
  const { data, status } = useAppData();
  const today = todayIso();
  const reminders = useMemo(
    () => buildReminders({
      actions: data.actions,
      events: data.events,
      credentials: data.toolkit.credentials,
      profile: data.profile,
      homework: data.homework,
      today,
      leadDays: data.toolkit.reminderLeadDays,
    }),
    [data.actions, data.events, data.profile, data.toolkit, data.homework, today],
  );
  const sessionKey = `her-flight-deck-reminders-${today}`;

  useEffect(() => {
    if (status !== "ready" || !data.toolkit.remindersEnabled || reminders.length === 0) return;
    if (sessionStorage.getItem(sessionKey)) return;
    // Only the explicit Toolkit switch requests permission.
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    try {
      new Notification("Her Flight Deck", {
        body: `${reminders.length} training reminder${reminders.length === 1 ? "" : "s"} need a look.`,
      });
      sessionStorage.setItem(sessionKey, "seen");
    } catch {
      // The reminder list remains available in Pilot Toolkit.
    }
  }, [status, data.toolkit.remindersEnabled, reminders, sessionKey]);

  return null;
}
