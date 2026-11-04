/**
 * REVIEW-ANYWAY-01: the library's "Review 10 anyway from any book" session.
 *
 * The cards were fixed when the student pressed the button (oldest next review
 * first, across books). Consecutive cards of one book form a run that the
 * usual per-material review hook rates, so every rating is the normal
 * review write with that material's own checks; no new table or rule.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { Button, Card } from "@/components/ui";
import type { ExtraReviewCard } from "@/data/repositories/cardLibraryRepository";
import type { CardReviewRepository } from "@/data/repositories/cardReviewRepository";

import { Notices, SessionView } from "./CardReviewPanel";
import { useCardReview } from "./useCardReview";

export function LibraryExtraReview({
  plan,
  repository,
  onClose,
}: {
  plan: readonly ExtraReviewCard[];
  repository: CardReviewRepository;
  onClose: () => void;
}) {
  const [start, setStart] = useState(0);
  const run = useMemo(() => {
    let end = start;
    while (end < plan.length && plan[end]!.materialId === plan[start]!.materialId) end += 1;
    return plan.slice(start, end);
  }, [plan, start]);
  const finished = start >= plan.length;
  const review = useCardReview(finished ? undefined : run[0]!.materialId, repository);
  /** The run whose session this view started; an older run's session is never read as this one's. */
  const startedFor = useRef<number | null>(null);
  const { read, session, blocked, starting, startSession } = review;

  useEffect(() => {
    if (finished || startedFor.current === start) return;
    if (read.phase !== "ready" || session || blocked || starting) return;
    startedFor.current = start;
    void startSession({ extra: true, itemIds: run.map((card) => card.itemId) });
  }, [finished, start, run, read, session, blocked, starting, startSession]);

  useEffect(() => {
    if (startedFor.current !== start || !session) return;
    if (session.position >= session.cards.length) setStart(start + run.length);
  }, [session, start, run.length]);

  let body: React.ReactNode = null;
  if (finished) {
    body = (
      <div className="stack stack--2">
        <p className="small strong" role="status">
          Done for now · extra review finished
        </p>
        <div>
          <Button size="small" onClick={onClose}>
            Close review
          </Button>
        </div>
      </div>
    );
  } else if (read.phase === "failed") {
    body = (
      <div className="stack stack--2" role="alert">
        <p className="small muted">These cards couldn&rsquo;t be opened just now.</p>
        <div className="row">
          <Button size="small" onClick={review.retryReads}>
            Retry card reviews
          </Button>
          <Button size="small" variant="ghost" onClick={onClose}>
            Done for now
          </Button>
        </div>
      </div>
    );
  } else if (review.sessionUnavailable) {
    body = (
      <div className="stack stack--2" role="alert">
        <p className="small muted">Card reviews couldn&rsquo;t be opened just now.</p>
        <div>
          <Button size="small" onClick={onClose}>
            Done for now
          </Button>
        </div>
      </div>
    );
  } else if (
    read.phase === "ready" &&
    read.snapshot.current.status === "ok" &&
    session &&
    startedFor.current === start &&
    session.position < session.cards.length
  ) {
    body = (
      <SessionView
        key={start}
        review={review}
        items={read.snapshot.current.items}
        states={read.snapshot.states}
        materialId={run[0]!.materialId}
        focusEntry
        onEntryShown={() => {}}
        progress={{ offset: start, total: plan.length, from: run[0]!.materialTitle }}
        onDone={onClose}
      />
    );
  } else {
    body = (
      <p className="tiny dim" role="status">
        Opening cards…
      </p>
    );
  }

  return (
    <Card>
      <section className="card-review stack stack--3" aria-label="Extra review">
        <Notices review={review} />
        {body}
      </section>
    </Card>
  );
}
