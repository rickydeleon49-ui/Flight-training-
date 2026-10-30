import { useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import type { Ref } from "react";

import { formatLongDate, formatTypedDate, parseTypedDate } from "@/lib/dates";

/**
 * One date field for the whole app (QUICKFIX-01, DATES-01).
 *
 * The date is typed as text: the Mac's own date field turned "11052026" typed
 * in one go into December 29 without saying so. A typed date is read back in
 * words as soon as it can be read, or refused plainly; it is never changed.
 */
export const NOT_A_DATE = "That isn't a date — try 11/05/2026.";
export const CHOOSE_A_DATE = "Choose a date.";

// A "today" outside any real year makes the year always show.
const withYear = (date: string) => formatLongDate(date, "0000-01-01");

/** "That's Thursday, November 5, 2026." for a stored day; nothing otherwise. */
export function readBackDate(date: string): string | undefined {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? `That's ${withYear(date)}.` : undefined;
}

export interface TypedDateRules {
  /** Empty is refused with "Choose a date." */
  required?: boolean;
  /** Earliest and latest stored day allowed, as YYYY-MM-DD. Refused, never clamped. */
  min?: string;
  max?: string;
}

/** What is wrong with the typed text, or undefined when it can be saved. */
export function typedDateProblem(text: string, { required = false, min, max }: TypedDateRules = {}): string | undefined {
  if (!text.trim()) return required ? CHOOSE_A_DATE : undefined;
  const date = parseTypedDate(text);
  if (!date) return NOT_A_DATE;
  if (min && date < min) return `Choose ${withYear(min)} or later.`;
  if (max && date > max) return `Choose ${withYear(max)} or earlier.`;
  return undefined;
}

export interface TypedDateFieldHandle {
  /** Shows any problem with what she typed; true when it can be saved. */
  check: () => boolean;
}

interface TypedDateFieldProps extends TypedDateRules {
  label: string;
  /** The stored day, YYYY-MM-DD, or "" for none. */
  value: string;
  /** Called with a day that can be saved, or "" while the box is empty or not yet a date. */
  onChange: (date: string) => void;
  hint?: string;
  /** A problem the form found on save; shown in place of the field's own. */
  error?: string | null;
  full?: boolean;
  disabled?: boolean;
  ref?: Ref<TypedDateFieldHandle>;
}

export function TypedDateField({
  label,
  value,
  onChange,
  hint,
  error,
  full = false,
  disabled,
  required,
  min,
  max,
  ref,
}: TypedDateFieldProps) {
  const id = useId();
  const rules = { required, min, max };
  const [text, setText] = useState(() => formatTypedDate(value));
  // A problem shows once she leaves the box or tries to save, never mid-typing.
  const [revealed, setRevealed] = useState(false);
  const emitted = useRef(value);

  // A day set from outside (a reset, a quick choice) replaces the text.
  useEffect(() => {
    if (value === emitted.current) return;
    emitted.current = value;
    setText(formatTypedDate(value));
    setRevealed(false);
  }, [value]);

  const problem = typedDateProblem(text, rules);
  useImperativeHandle(ref, () => ({
    check: () => {
      setRevealed(true);
      return !problem;
    },
  }), [problem]);

  const message = error || (revealed ? problem : undefined);
  const parsed = parseTypedDate(text);
  const readBack = !message && !problem && parsed ? readBackDate(parsed) : undefined;
  const readBackId = readBack ? `${id}-read-back` : undefined;
  const hintId = hint && !message ? `${id}-hint` : undefined;
  const errorId = message ? `${id}-error` : undefined;
  const describedBy = [readBackId, hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={`field${full ? " field--full" : ""}`}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <input
        className="input"
        id={id}
        type="text"
        autoComplete="off"
        placeholder="e.g. 11/05/2026"
        disabled={disabled}
        aria-describedby={describedBy}
        aria-invalid={message ? true : undefined}
        value={text}
        onChange={(event) => {
          const next = event.target.value;
          const nextProblem = typedDateProblem(next, rules);
          if (!nextProblem) setRevealed(false);
          setText(next);
          const date = nextProblem ? "" : (parseTypedDate(next) ?? "");
          emitted.current = date;
          onChange(date);
        }}
        onBlur={() => setRevealed(true)}
      />
      {readBack ? (
        <p className="field__hint" id={readBackId}>
          {readBack}
        </p>
      ) : null}
      {hintId ? (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {message ? (
        <p className="field__error" id={errorId} role="alert">
          {message}
        </p>
      ) : null}
    </div>
  );
}
