import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui";
import type { CompletedHistoryItem } from "@/domain/types";
import type { PracticeSessionRepository } from "@/data/repositories/practiceSessionRepository";
import { selectRelatedStudy, type RelatedStudyRead } from "@/logic/relatedStudy";
import { useAppData } from "@/state/AppDataContext";
import { jumpToMaterialHeading } from "./materialJump";

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
    <summary ref={summaryRef}>Related study</summary>
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
  const listRef = useRef<HTMLUListElement>(null);
  const [read, setRead] = useState<{ repository: typeof repository; value: RelatedStudyRead<readonly CompletedHistoryItem[]> }>({ repository, value: { status: "loading" } });
  const recentReviews = read.repository === repository ? read.value : { status: "loading" as const };
  useEffect(() => {
    if (expanded) listRef.current?.children[3]?.querySelector<HTMLElement>("a, button")?.focus();
  }, [expanded]);
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
    studySets: data.aiStudySets, questions: data.questions, events: data.events, recentReviews, limit: expanded ? 5 : 3 });
  return <div className="stack stack--2 related-study__contents">
    {result.rows.length ? <ul ref={listRef} aria-label="Related study destinations">{result.rows.map(row => <li key={row.kind}>
      {"path" in row.target ? <Link className="related-study__row" to={row.target.path}>
        <span>{row.label}</span>{" "}<span className="tiny muted">{row.reason}</span>
      </Link> : <button type="button" className="related-study__row" onClick={() => { if ("heading" in row.target) jumpToMaterialHeading(row.target.heading); }}>
        <span>{row.label}</span>{" "}<span className="tiny muted">{row.reason}</span>
      </button>}
    </li>)}</ul> : result.status === "ready" ? <p className="small muted">Nothing linked here yet.</p> : null}
    {result.status === "loading" ? <p className="small muted" role="status">Checking recent saved reviews…</p> : null}
    {result.status === "failed" ? <div role="status"><p className="small muted">Recent saved reviews couldn't be checked.</p><Button variant="ghost" onClick={onRetry}>Try again</Button></div> : null}
    {result.hasMore ? <Button variant="ghost" aria-expanded={expanded} onClick={() => setExpanded(true)}>Show more</Button> : null}
  </div>;
}
