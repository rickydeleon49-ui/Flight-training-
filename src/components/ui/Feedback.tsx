import type { ReactNode } from "react";

import { AlertIcon, RouteIcon } from "./Icons";

export const Loading = ({ label = "Loading" }: { label?: string }) => (
  <div className="loading" role="status">
    <span className="spinner" aria-hidden="true" />
    <span>{label}…</span>
  </div>
);

export const ErrorNote = ({ children }: { children: ReactNode }) => (
  <div className="error-note" role="alert">
    <AlertIcon />
    <div>{children}</div>
  </div>
);

interface EmptyStateProps {
  title: string;
  body?: string;
  action?: ReactNode;
  icon?: ReactNode;
}

/**
 * Empty states are invitations, never "No data found." They say what this
 * space is for and offer the first step.
 */
export function EmptyState({ title, body, action, icon }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <span className="empty-state__mark" aria-hidden="true">
        {icon ?? <RouteIcon size={28} />}
      </span>
      <h3 className="empty-state__title">{title}</h3>
      {body ? <p className="empty-state__body">{body}</p> : null}
      {action}
    </div>
  );
}

interface MeterProps {
  value: number;
  max: number;
  startLabel: string;
  endLabel: string;
  /** Describes what the meter measures, for assistive technology. */
  ariaLabel: string;
}

/**
 * Progress meter. Deliberately rare: the product only permits a percentage
 * where it reflects real arithmetic against a user-chosen target.
 */
export function Meter({ value, max, startLabel, endLabel, ariaLabel }: MeterProps) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div>
      <div
        className="meter__track"
        role="progressbar"
        aria-label={ariaLabel}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={`${startLabel} of ${endLabel}`}
      >
        <div className="meter__fill" style={{ width: `${ratio * 100}%` }} />
      </div>
      <div className="meter__labels">
        <span className="numeric strong">{startLabel}</span>
        <span className="numeric">{endLabel}</span>
      </div>
    </div>
  );
}
