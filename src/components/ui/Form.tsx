import { cloneElement, isValidElement, useId } from "react";
import type {
  InputHTMLAttributes,
  ReactElement,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

import type { Options } from "@/domain/types";

interface FieldProps {
  label: string;
  hint?: string;
  error?: string | null;
  full?: boolean;
  children:
    | ReactNode
    | ((props: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode);
}

/**
 * Labelled form control wrapper.
 *
 * Wiring label, hint and error to the input by id is what makes the form
 * usable with a screen reader, so it happens here once rather than being
 * repeated (and forgotten) at each call site.
 */
export function Field({ label, hint, error, full = false, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  const controlProps = { id, describedBy, invalid: Boolean(error) };
  const control =
    typeof children === "function"
      ? children(controlProps)
      : isValidElement(children)
        ? cloneElement(
            children as ReactElement<{
              id?: string;
              "aria-describedby"?: string;
              "aria-invalid"?: boolean;
            }>,
            {
              id,
              "aria-describedby": describedBy,
              "aria-invalid": Boolean(error) || undefined,
            },
          )
        : children;

  return (
    <div className={`field${full ? " field--full" : ""}`}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {control}
      {hint && !error ? (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="field__error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export const TextInput = (props: InputHTMLAttributes<HTMLInputElement>) => (
  <input className="input" {...props} />
);

export const TextArea = (props: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea className="textarea" {...props} />
);

interface SelectProps<T extends string> extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "onChange"> {
  options: Options<T>;
  /** Adds a leading blank choice for optional relationships. */
  placeholder?: string;
  onChange?: (value: T) => void;
}

export function Select<T extends string>({ options, placeholder, onChange, ...props }: SelectProps<T>) {
  return (
    <select
      className="select"
      onChange={(event) => onChange?.(event.target.value as T)}
      {...props}
    >
      {placeholder ? <option value="">{placeholder}</option> : null}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  /** Supporting detail shown under the label, never struck through. */
  meta?: ReactNode;
  disabled?: boolean;
}

export function Checkbox({ checked, onChange, label, meta, disabled }: CheckboxProps) {
  return (
    <label className="checkbox">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="checkbox__mark" aria-hidden="true">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4.5 12.5 9.5 17.5 19.5 6.5" />
        </svg>
      </span>
      <span className="checkbox__body">
        <span className="checkbox__label">{label}</span>
        {meta ? <span className="checkbox__meta">{meta}</span> : null}
      </span>
    </label>
  );
}
