/**
 * Review due (M2-4 / C2): which materials have flashcards to review now.
 *
 * Bounded, read-only and urgency-ranked within each checked batch (C2-D3).
 * Opening a material starts its own focused card session (C2-D2). The
 * counts on screen describe what has been checked so far, never the whole
 * library, and "All caught up" appears only when every material has been
 * checked, nothing is actionable and nothing was blocked.
 */
import { Link, useNavigate } from "react-router-dom";

import { Badge, Button, Card, EmptyState, Select } from "@/components/ui";
import type { LibraryReviewMaterialEntry } from "@/domain/types";
import { TOPIC_LABELS, TOPIC_OPTIONS, type Topic } from "@/domain/types";
import type { CardLibraryRepository } from "@/data/repositories/cardLibraryRepository";
import { CardLibraryReadError } from "@/logic/cardLibrary";
import { isOneOf, useRememberedState } from "@/state/useRememberedState";

import { useLibraryDueStream } from "./useLibraryReviews";

export const CARD_RATINGS_ARE_NOT_SCORES =
  "Card ratings only decide when a card comes back. They aren't practice test scores or a measure of exam readiness.";

const STATUS_CHOICES = [
  { value: "all", label: "All actionable" },
  { value: "due_today", label: "Due today" },
  { value: "new_only", label: "New only" },
] as const;
type StatusChoice = (typeof STATUS_CHOICES)[number]["value"];

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

export function describeCounts(entry: Pick<LibraryReviewMaterialEntry, "againCount" | "dayCount" | "newCount">): string {
  const parts: string[] = [];
  if (entry.againCount > 0) parts.push(`${plural(entry.againCount, "card")} to try again`);
  if (entry.dayCount > 0) parts.push(`${plural(entry.dayCount, "card")} due today`);
  if (entry.newCount > 0) parts.push(`${plural(entry.newCount, "new card")}`);
  return parts.join(" · ");
}

/** Cursor problems cannot be fixed by repeating the same read; start over instead. */
const needsStartOver = (error: unknown) =>
  error instanceof CardLibraryReadError && (error.code === "STALE_CURSOR" || error.code === "INVALID_CURSOR");

export function StudyLibraryReviewDue({ repository, dataRevision }: { repository: CardLibraryRepository; dataRevision: number }) {
  const navigate = useNavigate();
  const [status, setStatus] = useRememberedState<StatusChoice>(
    "library.due.status",
    "all",
    isOneOf(STATUS_CHOICES.map((choice) => choice.value)),
  );
  const [topic, setTopic] = useRememberedState<Topic | "">(
    "library.due.topic",
    "",
    isOneOf(["", ...TOPIC_OPTIONS.map((option) => option.value)]),
  );
  const { stream, state, refresh } = useLibraryDueStream(repository, { statusFilter: status, topic: topic || null }, dataRevision);
  const summary = state.lastPageSummary;
  const loadingFirst = state.loading === "page" && state.pagesLoaded === 0;

  return (
    <section className="stack stack--4" aria-labelledby="review-due-title">
      <div className="row row--between row--wrap">
        <div>
          <h2 id="review-due-title" className="section-title">
            Review due
          </h2>
          <p className="small muted">Flashcards ready now, most urgent first. Open one material to review its cards.</p>
        </div>
        <Button size="small" onClick={refresh} disabled={state.loading !== null}>
          Check again
        </Button>
      </div>

      <div className="row row--wrap library-review__filters">
        <div className="filter-chips" role="group" aria-label="Which cards">
          {STATUS_CHOICES.map((choice) => (
            <button
              type="button"
              key={choice.value}
              className={`filter-chip${status === choice.value ? " is-active" : ""}`}
              aria-pressed={status === choice.value}
              onClick={() => setStatus(choice.value)}
            >
              {choice.label}
            </button>
          ))}
        </div>
        <Select
          aria-label="Filter review due by topic"
          placeholder="Any topic"
          options={TOPIC_OPTIONS}
          value={topic}
          onChange={(value) => setTopic(value)}
          style={{ width: "auto" }}
        />
      </div>

      <p className="tiny dim">{CARD_RATINGS_ARE_NOT_SCORES}</p>

      {loadingFirst ? (
        <p className="small muted" role="status">
          Checking your flashcards…
        </p>
      ) : null}

      {state.rows.length > 0 ? (
        <ul className="library-review__list" aria-label="Materials with cards to review">
          {state.rows.map((entry) => (
            <li key={entry.materialId}>
              <Card className="library-review__item">
                <div className="row row--between row--wrap">
                  <div style={{ minWidth: 0 }}>
                    <p className="strong wrap-anywhere">{entry.title}</p>
                    <p className="small muted">{describeCounts(entry)}</p>
                    <span className="row row--wrap" style={{ gap: "var(--space-2)", marginTop: "var(--space-2)" }}>
                      <Badge tone="study">{TOPIC_LABELS[entry.topic as Topic] ?? entry.topic}</Badge>
                      {entry.priority === "next_up" ? <Badge tone="berry">Next Up</Badge> : null}
                    </span>
                  </div>
                  <Button
                    variant="primary"
                    size="small"
                    aria-label={`Review cards for ${entry.title}`}
                    onClick={() => navigate(`/study/${encodeURIComponent(entry.materialId)}`, { state: { startCardReview: true } })}
                  >
                    Review cards
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      ) : null}

      {state.issues.length > 0 ? (
        <div className="library-review__issues" role="note">
          <p className="small strong">Some card sets are too large to check here</p>
          <ul className="card-review__list">
            {state.issues.map((issue) => (
              <li key={`${issue.materialId}:${issue.code}`} className="small">
                {issue.title} — its saved cards are larger than this view can safely read.{" "}
                <Link to={issue.inspectionTarget}>Open {issue.title}</Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {state.error ? (
        <div className="stack stack--2" role="alert">
          <p className="small">Card reviews couldn&rsquo;t be read just now. Nothing was changed.</p>
          <div>
            {needsStartOver(state.error) ? (
              <Button size="small" onClick={refresh}>
                Start over
              </Button>
            ) : (
              <Button size="small" onClick={() => void stream.retryRead()} disabled={state.loading !== null}>
                Retry
              </Button>
            )}
          </div>
        </div>
      ) : null}

      {stream.isCaughtUp ? (
        <Card>
          <EmptyState title="All caught up!" body="No cards are due for review right now. New and returning cards will show up here." />
        </Card>
      ) : null}

      {state.isComplete && state.rows.length === 0 && state.issues.length > 0 && !state.error ? (
        <p className="small muted">Nothing else is ready to review. The sets above couldn&rsquo;t be checked here.</p>
      ) : null}

      {!state.isComplete && state.pagesLoaded > 0 && !state.error ? (
        <div className="stack stack--2">
          {state.rows.length === 0 ? (
            <p className="small muted">Nothing ready yet in the materials checked so far.</p>
          ) : null}
          <div>
            <Button size="small" onClick={() => void stream.loadNextPage()} disabled={state.loading !== null}>
              {state.loading === "page" ? "Checking…" : state.rows.length === 0 ? "Keep looking" : "Load more"}
            </Button>
          </div>
        </div>
      ) : null}

      {summary ? (
        <p className="tiny dim" role="status">
          Last check looked at {plural(summary.scannedCandidates, "material")} and {plural(summary.evaluatedCards, "card")}
          {state.isComplete ? "; every material with cards has now been checked." : "; more materials remain to check."}
        </p>
      ) : null}
    </section>
  );
}
