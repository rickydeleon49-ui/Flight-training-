import { useId, type ReactNode } from "react";

interface SectionProps {
  title: ReactNode;
  /** Optional id for the heading; generated when omitted. */
  headingId?: string;
  actions?: ReactNode;
  children: ReactNode;
}

/** Paper-logbook section: a title, a hairline rule, then content with no box. */
export function Section({ title, headingId, actions, children }: SectionProps) {
  const generated = useId();
  const id = headingId ?? `section-${generated.replace(/:/g, "")}`;
  return (
    <section className="section" aria-labelledby={id}>
      <div className="section__header">
        <h2 id={id} className="section__title">{title}</h2>
        {actions}
      </div>
      <hr className="section__rule" aria-hidden="true" />
      {children}
    </section>
  );
}
