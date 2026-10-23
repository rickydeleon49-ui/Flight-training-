import type { ReactNode } from "react";

interface CardProps {
  children: ReactNode;
  variant?: "default" | "quiet" | "accent";
  className?: string;
}

export function Card({ children, variant = "default", className = "" }: CardProps) {
  const variantClass = variant === "default" ? "" : ` card--${variant}`;
  return <section className={`card${variantClass} ${className}`.trim()}>{children}</section>;
}

interface CardHeaderProps {
  title: ReactNode;
  eyebrow?: string;
  action?: ReactNode;
  /** An addressable heading for in-page navigation. */
  headingId?: string;
}

export function CardHeader({ title, eyebrow, action, headingId }: CardHeaderProps) {
  return (
    <header className="card__header">
      <div>
        {eyebrow ? <p className="card__eyebrow">{eyebrow}</p> : null}
        <h2 id={headingId} tabIndex={headingId ? -1 : undefined} className={headingId ? "card__title section-jump-target" : "card__title"}>{title}</h2>
      </div>
      {action}
    </header>
  );
}

export function CardBody({ children, flush = false }: { children: ReactNode; flush?: boolean }) {
  return <div className={`card__body${flush ? " card__body--flush" : ""}`}>{children}</div>;
}
