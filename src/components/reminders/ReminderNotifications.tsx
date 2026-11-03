import { useEffect, useMemo, useState } from "react";

import { Link } from "react-router-dom";
import { isWindowsOS } from "@/lib/platform";
import { Button } from "@/components/ui";

import { todayIso } from "@/lib/dates";
import { buildReminders } from "@/logic/toolkit";
import { useAppData } from "@/state/AppDataContext";

/** Use permitted OS notices, with an in-app fallback for unavailable notices. */
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
  const [dismissedDay, setDismissedDay] = useState<string | null>(null);
  const [toastFailed, setToastFailed] = useState(false);
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
      setToastFailed(true);
    }
  }, [status, data.toolkit.remindersEnabled, reminders, sessionKey]);

  // Windows prep only (owner 2 Nov): Mac behavior unchanged until the owner decides.
  const permitted = "Notification" in window && Notification.permission === "granted";
  if (!isWindowsOS() || status !== "ready" || !data.toolkit.remindersEnabled || reminders.length === 0 ||
      (permitted && !toastFailed) || dismissedDay === today || sessionStorage.getItem(sessionKey)) return null;

  return (
    <aside className="card" aria-label="Training reminders">
      <div className="card__body stack stack--3">
        <p role="status">{reminders.length} training reminder{reminders.length === 1 ? "" : "s"} need a look.</p>
        <div className="row row--wrap">
          <Link to="/toolkit">View training reminders</Link>
          <Button size="small" onClick={() => {
            sessionStorage.setItem(sessionKey, "seen");
            setDismissedDay(today);
          }}>Dismiss reminders</Button>
        </div>
      </div>
    </aside>
  );
}
