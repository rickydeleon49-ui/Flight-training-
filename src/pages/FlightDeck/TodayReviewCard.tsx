import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Button, Card } from "@/components/ui";
import type { LibraryReviewMaterialEntry } from "@/domain/types";
import type { CardLibraryRepository } from "@/data/repositories/cardLibraryRepository";
import { estimateReviewMinutes } from "@/logic/reviewTime";
import { useLibraryDueStream } from "@/pages/StudyLibrary/useLibraryReviews";

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

type CountRow = Pick<LibraryReviewMaterialEntry, "againCount" | "dayCount" | "newCount">;
type DueRow = Pick<LibraryReviewMaterialEntry, "materialId" | "title"> & CountRow;

/** Same count the Review due tab shows per material: again + due today + new. */
const rowDue = (row: CountRow) => row.againCount + row.dayCount + row.newCount;

/** Cards due now (same rows and counts as the Study Library Review due tab). */
export function dueCardCount(rows: readonly CountRow[]): number {
  return rows.reduce((sum, row) => sum + rowDue(row), 0);
}

export function reviewTitle(dueCards: number, testsThisWeek: number): string {
  const cards = `${plural(dueCards, "card")} due`;
  return testsThisWeek > 0 ? `${cards} · ${plural(testsThisWeek, "practice test")} done this week` : cards;
}

export function fromLine(rows: readonly Pick<LibraryReviewMaterialEntry, "title">[]): string {
  const [a, b] = rows;
  if (!a) return "";
  if (!b) return `From ${a.title}`;
  const more = rows.length - 2;
  return more > 0 ? `From ${a.title}, ${b.title} and ${more} more` : `From ${a.title} and ${b.title}`;
}

export function TodayReviewCard({
  repository,
  dataRevision,
  testsThisWeek = 0,
  onPrimaryChange,
}: {
  repository: CardLibraryRepository | undefined;
  dataRevision: number;
  /** Practice tests finished in the last seven days. */
  testsThisWeek?: number;
  /** Tells the page whether this card is showing its filled primary button. */
  onPrimaryChange?: (hasPrimary: boolean) => void;
}) {
  useEffect(() => {
    if (!repository) onPrimaryChange?.(false);
  }, [repository, onPrimaryChange]);
  if (!repository) return null;
  return (
    <TodayReviewBody
      repository={repository}
      dataRevision={dataRevision}
      testsThisWeek={testsThisWeek}
      onPrimaryChange={onPrimaryChange}
    />
  );
}

function TodayReviewBody({
  repository,
  dataRevision,
  testsThisWeek,
  onPrimaryChange,
}: {
  repository: CardLibraryRepository;
  dataRevision: number;
  testsThisWeek: number;
  onPrimaryChange?: (hasPrimary: boolean) => void;
}) {
  const navigate = useNavigate();
  const { state } = useLibraryDueStream(repository, { statusFilter: "all", topic: null }, dataRevision, 250);
  const rows: DueRow[] = state.rows.filter((row) => rowDue(row) > 0);
  const dueCards = dueCardCount(rows);
  // Until the whole stream has been read, only a positive count is known.
  const known = dueCards > 0 || state.isComplete;
  useEffect(() => {
    if (known) onPrimaryChange?.(dueCards > 0);
  }, [known, dueCards, onPrimaryChange]);
  // Say "Nothing due" only once every page has been read.
  if (!known) return null;

  if (dueCards === 0) {
    return (
      <Card ariaLabel="Today's review" className="today-review">
        <p className="today-review__label">Today&rsquo;s review</p>
        <h2 className="today-review__title">Nothing due. Nice work.</h2>
        <div className="today-review__actions">
          <Button variant="ghost" onClick={() => navigate("/study")}>
            Open Study Library
          </Button>
        </div>
      </Card>
    );
  }

  const first = rows[0]!;
  return (
    <Card ariaLabel="Today's review" className="today-review">
      <p className="today-review__label">Today&rsquo;s review</p>
      <h2 className="today-review__title">{reviewTitle(dueCards, testsThisWeek)}</h2>
      <p className="small muted today-review__note">
        {fromLine(rows)} &nbsp;·&nbsp; about {estimateReviewMinutes(dueCards)} min
      </p>
      <div className="today-review__actions">
        <Button
          variant="primary"
          onClick={() =>
            navigate(`/study/${encodeURIComponent(first.materialId)}`, { state: { startCardReview: true } })
          }
        >
          Start today&rsquo;s review
        </Button>
        <Button variant="ghost" onClick={() => navigate("/study?tab=due")}>
          Choose what to study
        </Button>
      </div>
    </Card>
  );
}

/** Practice tests finished in the last seven days; 0 when they can't be read. */
export function useTestsThisWeek(
  read: ((limit: number) => Promise<{ completedAt: string | null }[]>) | undefined,
  dataRevision: number,
): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!read) return;
    let live = true;
    const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
    read(100).then(
      (rows) => {
        if (live) setCount(rows.filter((r) => r.completedAt && Date.parse(r.completedAt) >= since).length);
      },
      () => {
        if (live) setCount(0);
      },
    );
    return () => {
      live = false;
    };
  }, [read, dataRevision]);
  return count;
}
