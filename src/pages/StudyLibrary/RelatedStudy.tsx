import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui";
import type { CompletedHistoryItem } from "@/domain/types";
import type { PracticeSessionRepository } from "@/data/repositories/practiceSessionRepository";
import { selectRelatedStudy, type RelatedStudyRead } from "@/logic/relatedStudy";
import { useAppData } from "@/state/AppDataContext";

export function RelatedStudy({ materialId }: { materialId: string }) {
  const { data, dataRevision, repositories } = useAppData();
  const [open, setOpen] = useState(false);
  const [retry, setRetry] = useState(0);
  const summaryRef = useRef<HTMLElement>(null);
  // Keying the reader retires results on restore/refresh and A→B→A visits,
  // including the render before its effect runs. Collapsing also retires it.
  return <details className="related-study" open={open} onToggle={e => {
    setOpen(e.currentTarget.open);
  }}>
    <summary id="related-study" ref={summaryRef} tabIndex={-1}>Related study</summary>
    {open ? <RelatedStudyContents key={JSON.stringify([materialId, dataRevision, retry])}
      materialId={materialId} data={data} repository={repositories?.practiceSessions}
      onRetry={() => { setRetry(n => n + 1); summaryRef.current?.focus(); }} /> : null}
  </details>;
}

function RelatedStudyContents({ materialId, data, repository, onRetry }: {
  materialId: string;
  data: ReturnType<typeof useAppData>["data"];
  repository: PracticeSessionRepository | undefined;
  onRetry: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [read, setRead] = useState<{ repository: typeof repository; value: RelatedStudyRead<readonly CompletedHistoryItem[]> }>({ repository, value: { status: "loading" } });
  const recentReviews = read.repository === repository ? read.value : { status: "loading" as const };
  useEffect(() => {
    let live = true;
    setRead({ repository, value: { status: "loading" } });
    if (!repository) { setRead({ repository, value: { status: "failed" } }); return; }
    void repository.getCompletedHistory(materialId, 10).then(
      value => { if (live) setRead({ repository, value: { status: "ready", value } }); },
      () => { if (live) setRead({ repository, value: { status: "failed" } }); },
    );
    return () => { live = false; };
  }, [materialId, repository]);
  const result = selectRelatedStudy({ material: data.materials.find(m => m.id === materialId) ?? null,
    questions: data.questions, events: data.events, recentReviews, limit: expanded ? 5 : 3 });
  return <RelatedStudyList label="Related study destinations" rows={result.rows} hasMore={result.hasMore}
    expanded={expanded} onShowMore={() => setExpanded(true)} empty={result.status === "ready" ? "Nothing linked here yet." : null}>
    {result.status === "loading" ? <p className="small muted" role="status">Checking recent saved reviews…</p> : null}
    {result.status === "failed" ? <div role="status"><p className="small muted">Recent saved reviews couldn't be checked.</p><Button variant="ghost" onClick={onRetry}>Try again</Button></div> : null}
  </RelatedStudyList>;
}

/** The shared list: also used by the ACS code lookup (HUB-02c). Callers pass rows already capped. */
export function RelatedStudyList({ label, rows, hasMore, expanded, onShowMore, empty, children }: {
  label: string;
  rows: readonly { kind: string; id: string; label: string; reason: string; detail?: string; target: { path: string } }[];
  hasMore: boolean;
  expanded: boolean;
  onShowMore: () => void;
  /** Shown only when the rows are known to be empty. */
  empty: string | null;
  /** Loading/failure notes from the caller. */
  children?: ReactNode;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (expanded) listRef.current?.children[3]?.querySelector<HTMLElement>("a, button")?.focus();
  }, [expanded]);
  return <div className="stack stack--2 related-study__contents">
    {rows.length ? <ul ref={listRef} aria-label={label}>{rows.map(row => <li key={`${row.kind}:${row.id}`}>
      <Link className="related-study__row" to={row.target.path}>
        <span>{row.label}</span>{" "}<span className="tiny muted">{row.reason}</span>
        {row.detail ? <span className="tiny muted">{row.detail}</span> : null}
        <span className="related-study__go" aria-hidden="true">›</span>
      </Link>
    </li>)}</ul> : empty ? <p className="small muted">{empty}</p> : null}
    {children}
    {hasMore ? <Button variant="ghost" aria-expanded={expanded} onClick={onShowMore}>Show more</Button> : null}
  </div>;
}
