import type { ReactNode } from "react";

export type BadgeTone = "neutral" | "berry" | "study" | "flight" | "complete" | "overdue" | "due";

/**
 * Status chip. Tone is a reinforcement, never the only signal — every badge
 * carries readable text so status survives without colour.
 */
export function Badge({
  tone = "neutral",
  icon,
  children,
}: {
  tone?: BadgeTone;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <span className={`badge badge--${tone}`}>
      {icon}
      {children}
    </span>
  );
}
