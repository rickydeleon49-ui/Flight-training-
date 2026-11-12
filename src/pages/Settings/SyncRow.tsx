import type { ReactNode } from "react";

interface SyncRowProps {
  title: string;
  /** One quiet line: last done, or what this does. */
  meta?: ReactNode;
  headingId?: string;
  /** The row's one quiet button. */
  action?: ReactNode;
  /** Results, errors and extra steps that expand below the row. */
  children?: ReactNode;
}

/** One row inside the "iPhone and Mac" group: title, meta line, quiet button. */
export function SyncRow({ title, meta, headingId, action, children }: SyncRowProps) {
  return (
    <div className="sync-row">
      <div className="sync-row__main">
        <div className="sync-row__text">
          <h3 id={headingId} tabIndex={headingId ? -1 : undefined} className={headingId ? "sync-row__title section-jump-target" : "sync-row__title"}>{title}</h3>
          {meta ? <p className="small sync-row__meta">{meta}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}
