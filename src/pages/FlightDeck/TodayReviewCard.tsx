import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { Button, Card } from "@/components/ui";
import type { LibraryReviewMaterialEntry } from "@/domain/types";
import type { CardLibraryRepository } from "@/data/repositories/cardLibraryRepository";
import { practiceReadinessText, type PracticeReadiness } from "@/logic/practiceReadiness";
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

/** The written test pass mark, shown as a line on the practice bar. */
export const PASS_MARK_PERCENT = 70;

/** Checkride areas that have study material, out of all areas. */
export interface AreaCoverage {
  covered: number;
  total: number;
}

function Bar({ percent, mark }: { percent: number; mark?: number }) {
  return (
    <span className="today-review__bar" aria-hidden="true">
      <span className="today-review__bar-fill" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
      {mark !== undefined ? <span className="today-review__bar-mark" style={{ left: `${mark}%` }} /> : null}
    </span>
  );
}

/** Two quiet progress rows; each number comes with a next step. */
function ProgressRows({
  readiness,
  coverage,
}: {
  readiness: PracticeReadiness | null | undefined;
  coverage: AreaCoverage | null | undefined;
}) {
  const text = readiness ? practiceReadinessText(readiness) : null;
  const open = coverage ? coverage.total - coverage.covered : 0;
  if (!text && !coverage) return null;
  return (
    <ul className="today-review__rows">
      {text ? (
        <li className="today-review__row">
          {readiness?.kind === "summary" ? (
            <>
              <p className="today-review__row-head">
                <span>Written test practice</span>
                <span className="numeric strong">{readiness.recentAverage}%</span>
              </p>
              <Bar percent={readiness.recentAverage} mark={PASS_MARK_PERCENT} />
              <p className="tiny muted">Pass mark {PASS_MARK_PERCENT}%</p>
            </>
          ) : null}
          <p className="tiny muted practice-readiness">
            <Link to="/study">{text}</Link>
          </p>
        </li>
      ) : null}
      {coverage ? (
        <li className="today-review__row">
          <p className="today-review__row-head">
            <span>Checkride areas with study material</span>
            <span className="numeric strong">
              {coverage.covered} of {coverage.total}
            </span>
          </p>
          <Bar percent={(coverage.covered / Math.max(1, coverage.total)) * 100} />
          <p className="tiny muted">
            <Link to="/study">{open > 0 ? `See the ${open} open ${open === 1 ? "area" : "areas"}` : "Open Study Library"}</Link>
          </p>
        </li>
      ) : null}
    </ul>
  );
}

export function TodayReviewCard({
  repository,
  dataRevision,
  testsThisWeek = 0,
  readiness,
  coverage,
  onPrimaryChange,
}: {
  repository: CardLibraryRepository | undefined;
  dataRevision: number;
  /** Practice tests finished in the last seven days. */
  testsThisWeek?: number;
  /** Recent written-test practice, shown as a progress row. */
  readiness?: PracticeReadiness | null;
  /** Checkride areas that have study material. */
  coverage?: AreaCoverage | null;
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
      readiness={readiness}
      coverage={coverage}
      onPrimaryChange={onPrimaryChange}
    />
  );
}

function TodayReviewBody({
  repository,
  dataRevision,
  testsThisWeek,
  readiness,
  coverage,
  onPrimaryChange,
}: {
  repository: CardLibraryRepository;
  dataRevision: number;
  testsThisWeek: number;
  readiness?: PracticeReadiness | null;
  coverage?: AreaCoverage | null;
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
  // Reserve the card's height so the page below does not jump when it arrives.
  if (!known) return <div className="today-review-reserve" aria-hidden="true" />;

  if (dueCards === 0) {
    return (
      <section aria-label="Today's review" className="today-review-quiet">
        <p className="today-review-quiet__line">
          <span>Nothing due. Nice work.</span>
          <Button variant="ghost" onClick={() => navigate("/study")}>
            Open Study Library
          </Button>
        </p>
        <ProgressRows readiness={readiness} coverage={coverage} />
      </section>
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
      <ProgressRows readiness={readiness} coverage={coverage} />
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
