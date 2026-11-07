import { useEffect, useMemo, useRef } from "react";

import { todayIso } from "@/lib/dates";
import { buildReminders } from "@/logic/toolkit";
import { notify } from "@/services/notify";
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
  const sending = useRef<string | null>(null);
  const sessionKey = `her-flight-deck-reminders-${today}`;

  useEffect(() => {
    if (status !== "ready" || !data.toolkit.remindersEnabled || reminders.length === 0) return;
    if (sessionStorage.getItem(sessionKey)) return;
    if (sending.current === sessionKey) return;
    sending.current = sessionKey;
    // Only the explicit Toolkit switch requests permission; notify() sends
    // only if the system already allows it, and never throws.
    void notify(
      "Your Flight Deck",
      `${reminders.length} training reminder${reminders.length === 1 ? "" : "s"} need a look.`,
    ).then((sent) => {
      if (sent) sessionStorage.setItem(sessionKey, "seen");
      else sending.current = null;
    });
  }, [status, data.toolkit.remindersEnabled, reminders, sessionKey]);

  return null;
}
