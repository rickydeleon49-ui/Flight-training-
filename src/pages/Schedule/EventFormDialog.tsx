import { useEffect, useRef, useState } from "react";

import {
  Button,
  Dialog,
  Field,
  Select,
  TextArea,
  TextInput,
  TypedDateField,
  type TypedDateFieldHandle,
} from "@/components/ui";
import {
  EVENT_STATUS_OPTIONS,
  EVENT_TYPE_OPTIONS,
  type EventStatus,
  type EventType,
  type Goal,
  type Id,
  type Profile,
  type ScheduleEvent,
} from "@/domain/types";
import { todayIso } from "@/lib/dates";
import { moneyToInput, parseMoney } from "@/lib/money";

export interface EventDraft {
  title: string;
  eventType: EventType;
  date: string;
  startTime: string | null;
  endTime: string | null;
  location: string;
  instructor: string;
  notes: string;
  goalId: Id | null;
  estimatedCost: number | null;
  actualCost: number | null;
  status: EventStatus;
}

/**
 * A new event starts from where she actually trains, so the instructor and
 * airport are not retyped for every lesson. Both stay editable.
 */
const emptyDraft = (profile?: Profile): EventDraft => ({
  title: "",
  eventType: "flight_lesson",
  date: todayIso(),
  startTime: "10:00",
  endTime: null,
  location: profile?.homeAirport ?? "",
  instructor: profile?.instructorName ?? "",
  notes: "",
  goalId: null,
  estimatedCost: null,
  actualCost: null,
  status: "scheduled",
});

interface Props {
  open: boolean;
  event?: ScheduleEvent | null;
  goals: Goal[];
  /** Supplies the defaults for a new event. */
  profile?: Profile;
  onClose: () => void;
  /** Resolves when the save has finished (the parent closes the dialog on success). */
  onSave: (draft: EventDraft) => void | Promise<void>;
}

export function EventFormDialog({ open, event = null, goals, profile, onClose, onSave }: Props) {
  const [draft, setDraft] = useState<EventDraft>(() => emptyDraft(profile));
  const [estimated, setEstimated] = useState("");
  const [actual, setActual] = useState("");
  const dateField = useRef<TypedDateFieldHandle>(null);
  // A double-click (or click + Enter) must not create it twice.
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setErrors({});
    if (event) {
      setDraft({
        title: event.title,
        eventType: event.eventType,
        date: event.date,
        startTime: event.startTime,
        endTime: event.endTime,
        location: event.location,
        instructor: event.instructor,
        notes: event.notes,
        goalId: event.goalId,
        estimatedCost: event.estimatedCost,
        actualCost: event.actualCost,
        status: event.status,
      });
      setEstimated(moneyToInput(event.estimatedCost));
      setActual(moneyToInput(event.actualCost));
    } else {
      const fresh = emptyDraft(profile);
      setDraft(fresh);
      setEstimated("");
      setActual("");
    }
  }, [open, event?.id]);

  const update = <K extends keyof EventDraft>(key: K, value: EventDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const submit = async () => {
    if (saving.current) return;
    const found: Record<string, string> = {};
    if (!draft.title.trim()) found.title = "Give this a title so you recognise it later.";
    // The date field shows its own problem (not a date, or empty).
    const dateOk = dateField.current?.check() ?? Boolean(draft.date);

    // Same rule as an expense in Finances: a cost is more than zero, or blank.
    const estimatedCost = estimated.trim() === "" ? null : parseMoney(estimated);
    if (estimated.trim() !== "" && estimatedCost === null) {
      found.estimated = "Enter an amount like 275 or 275.50.";
    } else if (estimatedCost !== null && estimatedCost <= 0) {
      found.estimated = "Enter an amount greater than zero, or leave it blank.";
    }
    const actualCost = actual.trim() === "" ? null : parseMoney(actual);
    if (actual.trim() !== "" && actualCost === null) {
      found.actual = "Enter an amount like 265 or 265.00.";
    } else if (actualCost !== null && actualCost <= 0) {
      found.actual = "Enter an amount greater than zero, or leave it blank.";
    }
    if (draft.endTime && draft.startTime && draft.endTime < draft.startTime) {
      found.endTime = "The end time is before the start time.";
    }

    setErrors(found);
    if (Object.keys(found).length > 0 || !dateOk || !draft.date) return;

    saving.current = true;
    setBusy(true);
    try {
      await onSave({ ...draft, title: draft.title.trim(), estimatedCost, actualCost });
    } finally {
      // Released either way: on a failed save the dialog stays open so she can retry.
      saving.current = false;
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={event ? "Edit event" : "Add to your schedule"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={busy}>
            {busy ? "Saving…" : event ? "Save changes" : "Add event"}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Title" error={errors.title} full>
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={draft.title}
              placeholder="e.g. Crosswind landings"
              onChange={(e) => update("title", e.target.value)}
            />
          )}
        </Field>

        <Field label="Type">
          {({ id }) => (
            <Select
              id={id}
              options={EVENT_TYPE_OPTIONS}
              value={draft.eventType}
              onChange={(value) => update("eventType", value)}
            />
          )}
        </Field>

        <Field label="Status">
          {({ id }) => (
            <Select
              id={id}
              options={EVENT_STATUS_OPTIONS}
              value={draft.status}
              onChange={(value) => update("status", value)}
            />
          )}
        </Field>

        <TypedDateField
          ref={dateField}
          label="Date"
          required
          value={draft.date}
          onChange={(date) => update("date", date)}
        />

        <Field label="Start time">
          {({ id }) => (
            <TextInput
              id={id}
              type="time"
              value={draft.startTime ?? ""}
              onChange={(e) => update("startTime", e.target.value || null)}
            />
          )}
        </Field>

        <Field label="End time" error={errors.endTime}>
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              type="time"
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={draft.endTime ?? ""}
              onChange={(e) => update("endTime", e.target.value || null)}
            />
          )}
        </Field>

        <Field label="Location">
          {({ id }) => (
            <TextInput
              id={id}
              value={draft.location}
              placeholder="e.g. Cedar Field"
              onChange={(e) => update("location", e.target.value)}
            />
          )}
        </Field>

        <Field label="Instructor">
          {({ id }) => (
            <TextInput
              id={id}
              value={draft.instructor}
              onChange={(e) => update("instructor", e.target.value)}
            />
          )}
        </Field>

        <Field label="Related goal">
          {({ id }) => (
            <Select
              id={id}
              placeholder="Not linked to a goal"
              options={goals.map((goal) => ({ value: goal.id, label: goal.title }))}
              value={draft.goalId ?? ""}
              onChange={(value) => update("goalId", value || null)}
            />
          )}
        </Field>

        <Field label="Estimated cost" hint="Dollars. Optional." error={errors.estimated}>
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              inputMode="decimal"
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={estimated}
              placeholder="e.g. 275"
              onChange={(e) => setEstimated(e.target.value)}
            />
          )}
        </Field>

        <Field label="Actual cost" hint="Fill in after the lesson." error={errors.actual}>
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              inputMode="decimal"
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={actual}
              placeholder="e.g. 265"
              onChange={(e) => setActual(e.target.value)}
            />
          )}
        </Field>

        <Field label="Notes" full>
          {({ id }) => (
            <TextArea
              id={id}
              rows={3}
              value={draft.notes}
              onChange={(e) => update("notes", e.target.value)}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}
