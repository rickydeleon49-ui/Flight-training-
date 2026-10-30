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
  MILESTONE_STATUS_LABELS,
  type Milestone,
  type MilestoneStatus,
} from "@/domain/types";

export interface MilestoneDraft {
  title: string;
  description: string;
  status: MilestoneStatus;
  targetDate: string | null;
}

const STATUS_OPTIONS = (Object.keys(MILESTONE_STATUS_LABELS) as MilestoneStatus[]).map(
  (value) => ({ value, label: MILESTONE_STATUS_LABELS[value] }),
);

interface Props {
  open: boolean;
  milestone: Milestone | null;
  onClose: () => void;
  /** Resolves when the save has finished (the parent closes the dialog on success). */
  onSave: (draft: MilestoneDraft) => void | Promise<void>;
}

export function MilestoneFormDialog({ open, milestone, onClose, onSave }: Props) {
  const [draft, setDraft] = useState<MilestoneDraft>({
    title: "",
    description: "",
    status: "not_started",
    targetDate: null,
  });
  const [error, setError] = useState<string | null>(null);
  const targetDateField = useRef<TypedDateFieldHandle>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  // A double-click (or click + Enter) must not save it twice.
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !milestone) return;
    setError(null);
    setDraft({
      title: milestone.title,
      description: milestone.description,
      status: milestone.status,
      targetDate: milestone.targetDate,
    });
  }, [open, milestone?.id]);

  const update = <K extends keyof MilestoneDraft>(key: K, value: MilestoneDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const submit = async () => {
    if (saving.current) return;
    // Reading order: the title sits above the date, so it is checked first.
    if (!draft.title.trim()) {
      setError("Give this stage a name.");
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
      onClose={onClose}
      title="Edit milestone"
      description="A stage of your training. These are yours to shape."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={busy}>
            {busy ? "Saving…" : "Save changes"}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Name" error={error} full>
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              ref={titleInput}
              value={draft.title}
              placeholder="Build Landing Confidence"
              onChange={(e) => update("title", e.target.value)}
            />
          )}
        </Field>

        <Field label="Status">
          {({ id }) => (
            <Select
              id={id}
              options={STATUS_OPTIONS}
              value={draft.status}
              onChange={(value) => update("status", value)}
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
              placeholder="Normal, crosswind and short-field landings."
              onChange={(e) => update("description", e.target.value)}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}
