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
  GOAL_STATUS_OPTIONS,
  PRIORITY_OPTIONS,
  type Goal,
  type GoalStatus,
  type Id,
  type Milestone,
  type Priority,
} from "@/domain/types";

export interface GoalDraft {
  title: string;
  description: string;
  milestoneId: Id | null;
  status: GoalStatus;
  priority: Priority;
  targetDate: string | null;
  notes: string;
  confidence: number | null;
}

const emptyDraft = (milestoneId: Id | null): GoalDraft => ({
  title: "",
  description: "",
  milestoneId,
  status: "not_started",
  priority: "important",
  targetDate: null,
  notes: "",
  confidence: null,
});

const CONFIDENCE_OPTIONS = [
  { value: "", label: "Not rated" },
  { value: "1", label: "1 — very new" },
  { value: "2", label: "2" },
  { value: "3", label: "3 — getting there" },
  { value: "4", label: "4" },
  { value: "5", label: "5 — comfortable" },
] as const;

interface Props {
  open: boolean;
  goal?: Goal | null;
  milestoneId: Id | null;
  milestones: Milestone[];
  onClose: () => void;
  /** Resolves when the save has finished (the parent closes the dialog on success). */
  onSave: (draft: GoalDraft) => void | Promise<void>;
}

export function GoalFormDialog({ open, goal = null, milestoneId, milestones, onClose, onSave }: Props) {
  const [draft, setDraft] = useState<GoalDraft>(() => emptyDraft(milestoneId));
  const [error, setError] = useState<string | null>(null);
  const targetDateField = useRef<TypedDateFieldHandle>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  // A double-click (or click + Enter) must not create it twice.
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setDraft(
      goal
        ? {
            title: goal.title,
            description: goal.description,
            milestoneId: goal.milestoneId,
            status: goal.status,
            priority: goal.priority,
            targetDate: goal.targetDate,
            notes: goal.notes,
            confidence: goal.confidence,
          }
        : emptyDraft(milestoneId),
    );
  }, [open, goal?.id, milestoneId]);

  const update = <K extends keyof GoalDraft>(key: K, value: GoalDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const submit = async () => {
    if (saving.current) return;
    // Reading order: the title sits above the date, so it is checked first.
    if (!draft.title.trim()) {
      setError("Give this goal a short name.");
      titleInput.current?.focus();
      return;
    }
    if (!(targetDateField.current?.check() ?? true)) return;
    saving.current = true;
    setBusy(true);
    try {
      await onSave({ ...draft, title: draft.title.trim() });
    } finally {
      // Released either way: on a failed save the dialog stays open so she can retry.
      saving.current = false;
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => { if (!saving.current) onClose(); }}
      dismissible={!busy}
      title={goal ? "Edit goal" : "Add a goal"}
      footer={
        <>
          <Button disabled={busy} onClick={() => { if (!saving.current) onClose(); }}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={busy}>
            {busy ? "Saving…" : goal ? "Save changes" : "Add goal"}
          </Button>
        </>
      }
    >
      <fieldset disabled={busy} className="form-grid" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <Field label="Goal" error={error} full>
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              ref={titleInput}
              value={draft.title}
              placeholder="e.g. Crosswind landings"
              onChange={(e) => update("title", e.target.value)}
            />
          )}
        </Field>

        <Field label="Milestone">
          {({ id }) => (
            <Select
              id={id}
              placeholder="Not part of a milestone"
              options={milestones.map((m) => ({ value: m.id, label: m.title }))}
              value={draft.milestoneId ?? ""}
              onChange={(value) => update("milestoneId", value || null)}
            />
          )}
        </Field>

        <Field label="Status">
          {({ id }) => (
            <Select
              id={id}
              options={GOAL_STATUS_OPTIONS}
              value={draft.status}
              onChange={(value) => update("status", value)}
            />
          )}
        </Field>

        <Field label="Priority">
          {({ id }) => (
            <Select
              id={id}
              options={PRIORITY_OPTIONS}
              value={draft.priority}
              onChange={(value) => update("priority", value)}
            />
          )}
        </Field>

        <Field
          label="How confident do you feel?"
          hint="Your own sense of it, not an official rating."
        >
          {({ id, describedBy }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              options={CONFIDENCE_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
              value={draft.confidence == null ? "" : String(draft.confidence)}
              onChange={(value) => update("confidence", value === "" ? null : Number(value))}
            />
          )}
        </Field>

        <TypedDateField
          key={String(open)}
          ref={targetDateField}
          label="Target date"
          hint="Optional."
          value={draft.targetDate ?? ""}
          onChange={(date) => update("targetDate", date || null)}
        />

        <Field label="Description" full>
          {({ id }) => (
            <TextArea
              id={id}
              rows={2}
              value={draft.description}
              onChange={(e) => update("description", e.target.value)}
            />
          )}
        </Field>

        <Field label="Notes" full>
          {({ id }) => (
            <TextArea
              id={id}
              rows={3}
              value={draft.notes}
              placeholder="What still feels difficult, and what has clicked."
              onChange={(e) => update("notes", e.target.value)}
            />
          )}
        </Field>
      </fieldset>
    </Dialog>
  );
}
