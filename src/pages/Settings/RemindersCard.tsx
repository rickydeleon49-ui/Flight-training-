import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { Badge, Button, Card, CardBody, CardHeader, Checkbox, Field, TextInput } from "@/components/ui";
import type { ToolkitState } from "@/domain/types";
import { formatShortDate } from "@/lib/dates";
import { buildReminders, reminderLeadDays } from "@/logic/toolkit";
import { askPermission } from "@/services/notify";
import { useAppData } from "@/state/AppDataContext";
import "../PilotToolkit/pilotToolkit.css";

/** Reminder dates (medical, flight review, currency) and the window they show in. */
export function RemindersCard() {
  const { data, mutate } = useAppData();
  const state = data.toolkit;
  const save = async (change: (current: ToolkitState) => ToolkitState) =>
    (await mutate(async (repositories) => repositories.toolkit.save(change(await repositories.toolkit.get())))) !== null;
  const [leadDays, setLeadDays] = useState(String(state.reminderLeadDays));
  const reminders = useMemo(
    () =>
      buildReminders({
        actions: data.actions,
        events: data.events,
        credentials: state.credentials,
        profile: data.profile,
        homework: data.homework,
        leadDays: reminderLeadDays(leadDays, 0),
      }),
    [data.actions, data.events, data.profile, data.homework, leadDays, state.credentials],
  );

  const setEnabled = async (enabled: boolean) => {
    // Asked only from this tap; if you say no, the reminder list still works here.
    if (enabled) await askPermission();
    await save((current) => ({ ...current, remindersEnabled: enabled }));
  };
  return (
    <div className="toolkit-two-column">
      <Card variant="grouped">
        <CardHeader title="Training reminders" eyebrow="On this computer" />
        <CardBody>
          <div className="stack stack--4">
            <Checkbox
              checked={state.remindersEnabled}
              onChange={(enabled) => void setEnabled(enabled)}
              strikethrough={false}
              label="Show system reminders"
              meta="Includes due actions, scheduled training, medical dates, and saved record expirations."
            />
            <Field label="How many days ahead">
              <TextInput
                type="number"
                min="0"
                max="90"
                value={leadDays}
                onChange={(event) => setLeadDays(event.target.value)}
              />
            </Field>
            <Button
              variant="primary"
              onClick={() =>
                void save((current) => ({
                  ...current,
                  reminderLeadDays: reminderLeadDays(leadDays, 0),
                }))
              }
            >
              Save reminder window
            </Button>
            <p className="tiny dim">
              Your reminder list is here in Settings. System reminders can
              appear once a day while the app is running, if you allow notifications.
            </p>
          </div>
        </CardBody>
      </Card>
      <Card variant="grouped">
        <CardHeader
          title="Coming up"
          action={
            <span className="tiny dim">{reminders.length} reminders</span>
          }
        />
        <CardBody>
          {reminders.length ? (
            <div className="stack stack--3">
              {reminders.slice(0, 10).map((item) => (
                <div className="row row--between toolkit-center" key={item.id}>
                  <div>
                    <p className="small">{item.title}</p>
                    <p className="tiny dim">{item.detail}</p>
                  </div>
                  <div className="row toolkit-center toolkit-gap-2">
                    {item.homeworkId ? (
                      <Link
                        className="button button--secondary button--small"
                        to={`/study/homework/${item.homeworkId}`}
                      >
                        Open homework
                      </Link>
                    ) : null}
                    <Badge tone={item.urgent ? "overdue" : "due"}>
                      {formatShortDate(item.date)}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="small muted">
              Nothing falls inside this reminder window.
            </p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
