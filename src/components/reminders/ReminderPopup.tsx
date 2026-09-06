import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { Badge, Button, Dialog } from "@/components/ui";
import { formatShortDate, todayIso } from "@/lib/dates";
import { buildReminders } from "@/logic/toolkit";
import { useAppData } from "@/state/AppDataContext";

export function ReminderPopup() {
  const { data } = useAppData();
  const today = todayIso();
  const [open, setOpen] = useState(false);
  const reminders = useMemo(
    () =>
      buildReminders({
        actions: data.actions,
        events: data.events,
        credentials: data.toolkit.credentials,
        profile: data.profile,
        today,
        leadDays: data.toolkit.reminderLeadDays,
      }),
    [data.actions, data.events, data.profile, data.toolkit, today],
  );
  const sessionKey = `her-flight-deck-reminders-${today}`;

  useEffect(() => {
    if (!data.toolkit.remindersEnabled || reminders.length === 0) return;
    if (sessionStorage.getItem(sessionKey)) return;
    setOpen(true);
    if ("Notification" in window && Notification.permission === "granted") {
      try {
        new Notification("Her Flight Deck", {
          body: `${reminders.length} training reminder${reminders.length === 1 ? "" : "s"} need a look.`,
        });
      } catch {
        // The guaranteed in-app dialog remains available.
      }
    }
  }, [data.toolkit.remindersEnabled, reminders, sessionKey]);

  const dismiss = () => {
    sessionStorage.setItem(sessionKey, "seen");
    setOpen(false);
  };

  return (
    <Dialog
      open={open}
      onClose={dismiss}
      title="Training reminders"
      description="A quick look at what is due or approaching."
      narrow
      footer={
        <>
          <Button onClick={dismiss}>Close</Button>
          <Link className="button button--primary" to="/toolkit" onClick={dismiss}>
            Open toolkit
          </Link>
        </>
      }
    >
      <div className="stack stack--3">
        {reminders.slice(0, 8).map((item) => (
          <div className="row row--between" key={item.id}>
            <div>
              <p className="small strong wrap-anywhere">{item.title}</p>
              <p className="tiny dim">{item.detail}</p>
            </div>
            <Badge tone={item.urgent ? "overdue" : "due"}>{formatShortDate(item.date)}</Badge>
          </div>
        ))}
        {reminders.length > 8 ? (
          <p className="tiny dim">And {reminders.length - 8} more in the Pilot Toolkit.</p>
        ) : null}
      </div>
    </Dialog>
  );
}
