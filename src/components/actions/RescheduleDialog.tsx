import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { Button, Dialog, Field, TextInput } from "@/components/ui";
import { addDays, todayIso } from "@/lib/dates";
import { useAppData } from "@/state/AppDataContext";
import type { NextAction } from "@/domain/types";

interface RescheduleDialogProps {
  action: NextAction | null;
  onClose: () => void;
  onReschedule: (action: NextAction, date: string) => void;
}

/**
 * Moving work to a new day.
 *
 * Rescheduling is offered as an ordinary, blameless choice — the copy asks
 * for a realistic time rather than treating the slip as a failure.
 */
export function RescheduleDialog({ action, onClose, onReschedule }: RescheduleDialogProps) {
  const { data } = useAppData();
  const boundHw = action ? data.homework?.find((h) => h.assignment.action_id === action.id && !h.assignment.archived) : undefined;
  const [date, setDate] = useState(todayIso());

  useEffect(() => {
    if (action) setDate(todayIso());
  }, [action?.id]);

  if (!action) return null;

  if (boundHw) {
    return (
      <Dialog
        open={Boolean(action)}
        onClose={onClose}
        title="Choose a new time"
        description="This action is managed by your homework."
        narrow
        footer={
          <>
            <Button onClick={onClose}>Close</Button>
            <Link
              className="button button--primary"
              to={`/study/homework/${boundHw.assignment.id}`}
              onClick={onClose}
            >
              Open homework
            </Link>
          </>
        }
      >
        <div className="stack stack--3">
          <p>This comes from your homework. Open the homework to change it.</p>
        </div>
      </Dialog>
    );
  }

  const quickChoices = [
    { label: "Today", value: todayIso() },
    { label: "Tomorrow", value: addDays(todayIso(), 1) },
    { label: "In three days", value: addDays(todayIso(), 3) },
    { label: "Next week", value: addDays(todayIso(), 7) },
  ];

  return (
    <Dialog
      open={Boolean(action)}
      onClose={onClose}
      title="Choose a new time"
      description="This didn't get finished. Pick a time that is realistic — nothing is lost."
      narrow
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => onReschedule(action, date)}>
            Reschedule
          </Button>
        </>
      }
    >
      <div className="stack stack--4">
        <p className="strong wrap-anywhere">{action.title}</p>

        <div className="row row--wrap">
          {quickChoices.map((choice) => (
            <Button
              key={choice.label}
              size="small"
              variant={date === choice.value ? "primary" : "secondary"}
              onClick={() => setDate(choice.value)}
            >
              {choice.label}
            </Button>
          ))}
        </div>

        <Field label="Or pick a date">
          {({ id }) => (
            <TextInput
              id={id}
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}
