import { useState } from "react";

import { Card, CardBody, CardHeader, Checkbox, Field, TextInput } from "@/components/ui";
import { normalizeStudyReminder } from "@/logic/toolkit";
import { askPermission } from "@/services/notify";
import { schedulesDailyReminder } from "@/services/platform";
import { useAppData } from "@/state/AppDataContext";

export const REMINDER_DENIED_LINE = "Turn on notifications for Your Flight Deck in Settings";
export const REMINDER_MAC_LINE = "Your Flight Deck needs to be open (it can be minimized) for the reminder to show.";

/** A daily "time to study" reminder: one switch and a time. Off until you turn it on. */
export function StudyReminderCard() {
  const { data, mutate } = useAppData();
  const [denied, setDenied] = useState(false);
  const current = normalizeStudyReminder(data.toolkit.studyReminder);
  const save = (next: { enabled: boolean; time: string }) =>
    mutate((repos) => repos.toolkit.save({ ...data.toolkit, studyReminder: next }));

  const change = async (enabled: boolean) => {
    setDenied(false);
    // Permission is asked here, from your tap, and nowhere else.
    if (enabled && !(await askPermission())) {
      setDenied(true);
      return;
    }
    await save({ ...current, enabled });
  };

  return (
    <Card>
      <CardHeader title="Daily study reminder" eyebrow="On this device" />
      <CardBody>
        <div className="stack stack--3">
          <Checkbox
            checked={current.enabled}
            onChange={(enabled) => void change(enabled)}
            strikethrough={false}
            label="Remind me to study every day"
          />
          <Field label="Reminder time">
            {({ id }) => (
              <TextInput
                id={id}
                type="time"
                value={current.time}
                onChange={(e) => {
                  const time = e.target.value;
                  if (time) void save({ ...current, time });
                }}
              />
            )}
          </Field>
          {schedulesDailyReminder() ? null : <p className="small muted">{REMINDER_MAC_LINE}</p>}
          {denied ? <p className="small muted" role="status">{REMINDER_DENIED_LINE}</p> : null}
        </div>
      </CardBody>
    </Card>
  );
}
