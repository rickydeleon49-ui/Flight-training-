import { useEffect, useMemo, useRef, useState } from "react";
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
  const notifiedRef = useRef(false);

  useEffect(() => {
    if (!data.toolkit.remindersEnabled || reminders.length === 0) return;
    if (sessionStorage.getItem(sessionKey)) return;
    setOpen(true);

    // Once per launch. `reminders` is a fresh array whenever anything in the
    // application changes, so without this the same reminders would announce
    // themselves again every time she saved a lesson.
    if (notifiedRef.current) return;
    notifiedRef.current = true;

    const count = reminders.length;
    void (async () => {
      if (!("Notification" in window)) return;

      // Reminders are on from the first launch, and the Toolkit only asks for
      // permission when the switch is turned on — a switch she never has to
      // touch. Asking here, at the moment a notification is actually due, is
      // what makes the system notification the interface promises happen at
      // all. A refusal is fine: the in-app dialog above is the real one.
      let permission = Notification.permission;
      if (permission === "default") {
        try {
          permission = await Notification.requestPermission();
        } catch {
          return;
        }
      }
      if (permission !== "granted") return;

      try {
        new Notification("Her Flight Deck", {
          body: `${count} training reminder${count === 1 ? "" : "s"} need a look.`,
        });
      } catch {
        // The guaranteed in-app dialog remains available.
      }
    })();
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
