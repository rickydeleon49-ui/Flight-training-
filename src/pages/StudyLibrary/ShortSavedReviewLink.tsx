import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui";
import { attemptReviewPath } from "@/logic/practiceAttemptReview";
import { useAppData } from "@/state/AppDataContext";

/** Uses only acknowledged completed attempts, including their frozen version. */
export function ShortSavedReviewLink({ materialId }: { materialId: string }) {
  const { repositories, dataRevision } = useAppData();
  const [read, setRead] = useState<{ path: string | null; failed: boolean; loading: boolean }>({ path: null, failed: false, loading: true });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    setRead({ path: null, failed: false, loading: true });
    if (!repositories) return;
    void repositories.practiceSessions.getCompletedHistory(materialId, 1).then(rows => {
      if (live) setRead({ path: rows[0] ? attemptReviewPath(rows[0].historyKey, rows[0].attemptId, "missed") : null, failed: false, loading: false });
    }, () => { if (live) setRead({ path: null, failed: true, loading: false }); });
    return () => { live = false; };
  }, [materialId, repositories, dataRevision, retry]);
  return <span className="stack stack--2">
    {read.path ? <Link className="button button--secondary" to={read.path}>Short saved review</Link> : <Button disabled>Short saved review</Button>}
    {read.failed ? <><span className="tiny muted" role="status">Saved reviews couldn’t be checked.</span><Button onClick={() => setRetry(n => n + 1)}>Retry saved reviews</Button></> : !read.path ? <span className="tiny muted">{read.loading ? "Checking saved reviews…" : "Available after a completed practice test."}</span> : null}
  </span>;
}
