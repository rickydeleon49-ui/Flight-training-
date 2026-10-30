import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

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
import { useAppData } from "@/state/AppDataContext";
import {
  ACTION_CATEGORY_DESCRIPTIONS,
  ACTION_CATEGORY_OPTIONS,
  PRIORITY_OPTIONS,
  type ActionCategory,
  type Id,
  type NextAction,
  type Priority,
  type RelatedType,
} from "@/domain/types";
import { todayIso } from "@/lib/dates";

export interface ActionDraft {
  title: string;
  description: string;
  category: ActionCategory;
  priority: Priority;
  dueDate: string | null;
  estimatedMinutes: number | null;
  relatedType: RelatedType | null;
  relatedId: Id | null;
}

interface ActionFormDialogProps {
  open: boolean;
  onClose: () => void;
  /** Resolves when the save has finished (the parent closes the dialog on success). */
  onSave: (draft: ActionDraft) => void | Promise<void>;
  /** Present when editing; absent when creating. */
  action?: NextAction | null;
  /** Pre-attaches a new action to whatever screen created it. */
  relatedType?: RelatedType | null;
  relatedId?: Id | null;
  defaultCategory?: ActionCategory;
}

const emptyDraft = (
  relatedType: RelatedType | null,
  relatedId: Id | null,
  category: ActionCategory,
): ActionDraft => ({
  title: "",
  description: "",
  category,
  priority: "important",
  dueDate: todayIso(),
  estimatedMinutes: null,
  relatedType,
  relatedId,
});

export function ActionFormDialog({
  open,
  onClose,
  onSave,
  action = null,
  relatedType = null,
  relatedId = null,
  defaultCategory = "prepare",
}: ActionFormDialogProps) {
  const { data } = useAppData();
  const boundHw = action ? data.homework?.find((h) => h.assignment.action_id === action.id && !h.assignment.archived) : undefined;

  const [draft, setDraft] = useState<ActionDraft>(() =>
    emptyDraft(relatedType, relatedId, defaultCategory),
  );
  const [error, setError] = useState<string | null>(null);
  const dueDateField = useRef<TypedDateFieldHandle>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  // A double-click (or click + Enter) must not create the action twice.
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);

  // Reset whenever the dialog opens so a stale draft never leaks between uses.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setDraft(
      action
        ? {
            title: action.title,
            description: action.description,
            category: action.category,
            priority: action.priority,
            dueDate: action.dueDate,
            estimatedMinutes: action.estimatedMinutes,
            relatedType: action.relatedType,
            relatedId: action.relatedId,
          }
        : emptyDraft(relatedType, relatedId, defaultCategory),
    );
  }, [open, action?.id, relatedType, relatedId, defaultCategory]);

  const update = <K extends keyof ActionDraft>(key: K, value: ActionDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const submit = async () => {
    if (saving.current) return;
    // Reading order: the title sits above the date, so it is checked first.
    if (!draft.title.trim()) {
      setError("Give this action a short title so you know what to do.");
      titleInput.current?.focus();
      return;
    }
    if (!(dueDateField.current?.check() ?? true)) return;
    saving.current = true;
    setBusy(true);
    try {
      await onSave({ ...draft, title: draft.title.trim(), description: draft.description.trim() });
    } finally {
      // Released either way: on a failed save the dialog stays open so she can retry.
      saving.current = false;
      setBusy(false);
    }
  };

  if (boundHw) {
    return (
      <Dialog
        open={open}
        onClose={onClose}
        title="Edit action"
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

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={action ? "Edit action" : "Add a next action"}
      description="Say what to do next, specifically enough to act on."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={busy}>
            {busy ? "Saving…" : action ? "Save changes" : "Add action"}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="What needs to happen?" error={error} full>
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              ref={titleInput}
              value={draft.title}
              placeholder="Review crosswind landing notes"
              onChange={(e) => update("title", e.target.value)}
            />
          )}
        </Field>

        <Field label="Section" hint={ACTION_CATEGORY_DESCRIPTIONS[draft.category]}>
          {({ id, describedBy }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              options={ACTION_CATEGORY_OPTIONS}
              value={draft.category}
              onChange={(value) => update("category", value)}
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

        <TypedDateField
          key={String(open)}
          ref={dueDateField}
          label="Due date"
          hint="Leave empty if it has no particular day."
          value={draft.dueDate ?? ""}
          onChange={(date) => update("dueDate", date || null)}
        />

        <Field label="How long will it take?" hint="Minutes. Optional.">
          {({ id, describedBy }) => (
            <TextInput
              id={id}
              aria-describedby={describedBy}
              type="number"
              min={0}
              step={5}
              value={draft.estimatedMinutes ?? ""}
              placeholder="30"
              onChange={(e) =>
                update("estimatedMinutes", e.target.value === "" ? null : Number(e.target.value))
              }
            />
          )}
        </Field>

        <Field label="Notes" full>
          {({ id }) => (
            <TextArea
              id={id}
              rows={3}
              value={draft.description}
              placeholder="Pages 4–8, focus on rudder timing."
              onChange={(e) => update("description", e.target.value)}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}
