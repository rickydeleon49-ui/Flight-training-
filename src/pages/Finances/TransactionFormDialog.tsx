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
  EXPENSE_CATEGORY_OPTIONS,
  type ExpenseCategory,
  type Id,
  type ScheduleEvent,
  type Transaction,
  type TransactionType,
} from "@/domain/types";
import { todayIso } from "@/lib/dates";
import { moneyToInput, parseMoney } from "@/lib/money";

export interface TransactionDraft {
  type: TransactionType;
  amount: number;
  date: string;
  category: ExpenseCategory;
  description: string;
  notes: string;
  eventId: Id | null;
}

interface Props {
  open: boolean;
  type: TransactionType;
  transaction?: Transaction | null;
  events: ScheduleEvent[];
  onClose: () => void;
  /** Resolves when the save has finished (the parent closes the dialog on success). */
  onSave: (draft: TransactionDraft) => void | Promise<void>;
}

export function TransactionFormDialog({
  open,
  type,
  transaction = null,
  events,
  onClose,
  onSave,
}: Props) {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayIso());
  const [category, setCategory] = useState<ExpenseCategory>("flight_lesson");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [eventId, setEventId] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const dateField = useRef<TypedDateFieldHandle>(null);
  // A double-click (or click + Enter) must not record the money twice.
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);

  const effectiveType = transaction?.type ?? type;
  const isExpense = effectiveType === "expense";

  useEffect(() => {
    if (!open) return;
    setErrors({});
    if (transaction) {
      setAmount(moneyToInput(transaction.amount));
      setDate(transaction.date);
      setCategory(transaction.category);
      setDescription(transaction.description);
      setNotes(transaction.notes);
      setEventId(transaction.eventId ?? "");
    } else {
      setAmount("");
      setDate(todayIso());
      setCategory(isExpense ? "flight_lesson" : "other");
      setDescription("");
      setNotes("");
      setEventId("");
    }
  }, [open, transaction?.id, isExpense]);

  const submit = async () => {
    if (saving.current) return;
    const found: Record<string, string> = {};
    const cents = parseMoney(amount);
    if (cents === null) found.amount = "Enter an amount like 275 or 275.50.";
    else if (cents <= 0) found.amount = "Enter an amount greater than zero.";
    // The date field shows its own problem (not a date, or empty).
    const dateOk = dateField.current?.check() ?? Boolean(date);

    setErrors(found);
    if (Object.keys(found).length > 0 || !dateOk || !date) return;

    saving.current = true;
    setBusy(true);
    try {
      await onSave({
        type: effectiveType,
        amount: cents as number,
        date,
        category: isExpense ? category : "other",
        description: description.trim(),
        notes: notes.trim(),
        eventId: eventId || null,
      });
    } finally {
      // Released either way: on a failed save the dialog stays open so she can retry.
      saving.current = false;
      setBusy(false);
    }
  };

  const title = transaction
    ? "Edit transaction"
    : isExpense
      ? "Record an expense"
      : "Add to your Flight Fund";

  return (
    <Dialog
      open={open}
      onClose={() => { if (!saving.current) onClose(); }}
      dismissible={!busy}
      title={title}
      footer={
        <>
          <Button disabled={busy} onClick={() => { if (!saving.current) onClose(); }}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={busy}>
            {busy ? "Saving…" : transaction ? "Save changes" : isExpense ? "Record expense" : "Add funds"}
          </Button>
        </>
      }
    >
      <fieldset disabled={busy} className="form-grid" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <Field label="Amount" hint="Dollars." error={errors.amount}>
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              inputMode="decimal"
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={amount}
              placeholder="e.g. 275"
              onChange={(e) => setAmount(e.target.value)}
            />
          )}
        </Field>

        <TypedDateField ref={dateField} label="Date" required value={date} onChange={setDate} />

        {isExpense ? (
          <Field label="Category">
            {({ id }) => (
              <Select
                id={id}
                options={EXPENSE_CATEGORY_OPTIONS}
                value={category}
                onChange={(value) => setCategory(value)}
              />
            )}
          </Field>
        ) : null}

        {isExpense ? (
          <Field label="Related lesson" hint="Optional.">
            {({ id, describedBy }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                placeholder="Not linked to a lesson"
                options={events.map((event) => ({
                  value: event.id,
                  label: `${event.title} · ${event.date}`,
                }))}
                value={eventId}
                onChange={(value) => setEventId(value)}
              />
            )}
          </Field>
        ) : null}

        <Field label="Description" full>
          {({ id }) => (
            <TextInput
              id={id}
              value={description}
              placeholder={isExpense ? "Flight lesson" : "Saved paycheck money"}
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
        </Field>

        <Field label="Notes" full>
          {({ id }) => (
            <TextArea id={id} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          )}
        </Field>
      </fieldset>
    </Dialog>
  );
}
