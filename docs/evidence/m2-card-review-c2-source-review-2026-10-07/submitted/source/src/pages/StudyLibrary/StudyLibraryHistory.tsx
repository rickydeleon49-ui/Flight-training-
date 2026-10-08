/**
 * Card review history across the library (M2-4 / C2, C2-D6/C2-D7).
 *
 * Newest first, 20 at a time, filterable by material and topic. Each rating
 * shows the card text as it was reviewed; "Earlier version" is decided by
 * comparing the event's own version with the material's current saved cards,
 * and stays unknown until those cards have been read. Viewing a past card is
 * read-only. Card ratings are kept apart from practice test scores, which
 * have their own history.
 */
import { useState } from "react";
import { Link } from "react-router-dom";

import { Badge, Button, Card, Dialog, EmptyState, Select } from "@/components/ui";
import type { CardRating, LibraryRecentReviewEntry, StudyMaterial } from "@/domain/types";
import { TOPIC_OPTIONS, type Topic } from "@/domain/types";
import type { CardLibraryRepository } from "@/data/repositories/cardLibraryRepository";
import { CardLibraryReadError } from "@/logic/cardLibrary";
import { isOneOf, isText, useRememberedState } from "@/state/useRememberedState";

import { CARD_RATINGS_ARE_NOT_SCORES } from "./StudyLibraryReviewDue";
import { useLibraryHistoryStream } from "./useLibraryReviews";

const RATING_LABELS: Record<CardRating, string> = { again: "Again", hard: "Hard", good: "Good", easy: "Easy" };
const RATING_TONES: Record<CardRating, "overdue" | "due" | "study" | "complete"> = {
  again: "overdue",
  hard: "due",
  good: "study",
  easy: "complete",
};

export function describeInterval(label: string | null): string | null {
  if (!label) return null;
  const minutes = /^(\d+)m$/.exec(label);
  if (minutes) return `back in ${minutes[1]} minutes`;
  const days = /^(\d+)d$/.exec(label);
  if (days) return Number(days[1]) === 1 ? "back in 1 day" : `back in ${days[1]} days`;
  return null;
}

/** What she can know about the card text this rating was given on. */
export function describeProvenance(row: LibraryRecentReviewEntry): string | null {
  switch (row.contentStatus) {
    case "current":
      return null;
    case "earlier":
      return "Earlier version of these cards";
    case "pending":
      return row.blockedReason === "oversize"
        ? "These cards are too large to compare here"
        : "Not checked against the current cards yet";
    case "valid_empty":
      return "This material has no cards now";
    case "malformed":
      return "This material's saved cards are damaged";
    case "unavailable":
      return "These cards are no longer saved";
  }
}

const needsStartOver = (error: unknown) =>
  error instanceof CardLibraryReadError && (error.code === "STALE_CURSOR" || error.code === "INVALID_CURSOR");

export function StudyLibraryHistory({
  repository,
  materials,
  contentKey,
}: {
  repository: CardLibraryRepository;
  materials: StudyMaterial[];
  contentKey: string;
}) {
  const [materialId, setMaterialId] = useRememberedState<string>("library.history.material", "", isText);
  const [topic, setTopic] = useRememberedState<Topic | "">(
    "library.history.topic",
    "",
    isOneOf(["", ...TOPIC_OPTIONS.map((option) => option.value)]),
  );
  const material = materials.some((m) => m.id === materialId) ? materialId : "";
  const { stream, state, refresh } = useLibraryHistoryStream(
    repository,
    { materialId: material || null, topic: topic || null },
    contentKey,
  );
  const [inspecting, setInspecting] = useState<LibraryRecentReviewEntry | null>(null);
  const pending = stream.pendingTargets();
  const format = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

  return (
    <section className="stack stack--4" aria-labelledby="card-history-title">
      <div className="row row--between row--wrap">
        <div>
          <h2 id="card-history-title" className="section-title">
            Card review history
          </h2>
          <p className="small muted">
            Every flashcard rating, newest first. <Link to="/study/history">Practice test history</Link> is kept separately.
          </p>
        </div>
        <Button size="small" onClick={refresh} disabled={state.loading !== null}>
          Refresh
        </Button>
      </div>

      <div className="row row--wrap library-review__filters">
        <Select
          aria-label="Filter history by material"
          placeholder="Every material"
          options={materials.map((m) => ({ value: m.id, label: m.title }))}
          value={material}
          onChange={(value) => setMaterialId(value)}
          style={{ width: "auto", maxWidth: "100%" }}
        />
        <Select
          aria-label="Filter history by topic"
          placeholder="Any topic"
          options={TOPIC_OPTIONS}
          value={topic}
          onChange={(value) => setTopic(value)}
          style={{ width: "auto" }}
        />
      </div>

      <p className="tiny dim">{CARD_RATINGS_ARE_NOT_SCORES}</p>

      {state.loading === "page" && state.pagesLoaded === 0 ? (
        <p className="small muted" role="status">
          Loading card review history…
        </p>
      ) : null}

      {state.rows.length > 0 ? (
        <ul className="library-review__list" aria-label="Card ratings">
          {state.rows.map((row) => {
            const provenance = describeProvenance(row);
            const interval = describeInterval(row.intervalLabel);
            return (
              <li key={row.id}>
                <Card className="library-review__item">
                  <div className="row row--between row--wrap">
                    <div style={{ minWidth: 0 }}>
                      <p className="small strong wrap-anywhere">{row.front}</p>
                      <p className="tiny muted">
                        {row.materialTitle} · {format.format(new Date(row.reviewedAt))}
                        {interval ? ` · ${interval}` : ""}
                      </p>
                      <span className="row row--wrap" style={{ gap: "var(--space-2)", marginTop: "var(--space-2)" }}>
                        <Badge tone={RATING_TONES[row.rating]}>{RATING_LABELS[row.rating]}</Badge>
                        {provenance ? <Badge tone="neutral">{provenance}</Badge> : null}
                        {row.inspectionTarget ? (
                          <Link className="tiny" to={row.inspectionTarget}>
                            Open {row.materialTitle}
                          </Link>
                        ) : null}
                      </span>
                    </div>
                    <Button size="small" variant="ghost" aria-label={`View card: ${row.front}`} onClick={() => setInspecting(row)}>
                      View card
                    </Button>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      ) : null}

      {pending.length > 0 ? (
        <div className="row row--wrap">
          <p className="small muted">
            {pending.length === 1 ? "1 material hasn't" : `${pending.length.toLocaleString()} materials haven't`} been compared with
            their current cards yet.
          </p>
          <Button size="small" onClick={() => void stream.enrichPending()} disabled={state.loading !== null}>
            {state.loading === "enrich" ? "Checking…" : "Check versions"}
          </Button>
        </div>
      ) : null}

      {state.error ? (
        <div className="stack stack--2" role="alert">
          <p className="small">Card review history couldn&rsquo;t be read just now. Nothing was changed.</p>
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

      {state.isComplete && state.rows.length === 0 && !state.error ? (
        <Card>
          <EmptyState
            title="No card reviews yet"
            body={material || topic ? "Nothing matches these filters." : "Ratings you give flashcards will appear here."}
          />
        </Card>
      ) : null}

      {!state.isComplete && state.pagesLoaded > 0 && !state.error ? (
        <div>
          <Button size="small" onClick={() => void stream.loadNextPage()} disabled={state.loading !== null}>
            {state.loading === "page" ? "Loading…" : "Load more"}
          </Button>
        </div>
      ) : null}

      {state.pagesLoaded > 0 ? (
        <p className="tiny dim" role="status">
          Showing {state.rows.length.toLocaleString()} rating{state.rows.length === 1 ? "" : "s"} loaded so far
          {state.lastEnrichmentSummary ? `; the last version check read ${state.lastEnrichmentSummary.rawReads.toLocaleString()} card set${state.lastEnrichmentSummary.rawReads === 1 ? "" : "s"}` : ""}
          .
        </p>
      ) : null}

      <HistoricalCardDialog row={inspecting} onClose={() => setInspecting(null)} />
    </section>
  );
}

/** A past card exactly as it was reviewed. Nothing here can change her cards. */
export function HistoricalCardDialog({ row, onClose }: { row: LibraryRecentReviewEntry | null; onClose: () => void }) {
  const provenance = row ? describeProvenance(row) : null;
  const interval = row ? describeInterval(row.intervalLabel) : null;
  return (
    <Dialog
      open={row !== null}
      onClose={onClose}
      title="Card as you reviewed it"
      description={row ? `${row.materialTitle} · card ${row.ordinal + 1}` : undefined}
      footer={
        <>
          {row ? (
            <Link className="button button--secondary" to={`/study/${encodeURIComponent(row.materialId)}`}>
              Open material
            </Link>
          ) : null}
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      {row ? (
        <div className="stack stack--3">
          <div>
            <p className="eyebrow">Question</p>
            <p className="ai-copy">{row.front}</p>
          </div>
          <div>
            <p className="eyebrow">Answer</p>
            <p className="ai-copy">{row.back}</p>
          </div>
          <p className="small muted">
            Rated {RATING_LABELS[row.rating]} on {new Date(row.reviewedAt).toLocaleString("en-GB")}
            {interval ? `, ${interval}` : ""}.{row.sourcePage ? ` Source page ${row.sourcePage}.` : ""}
          </p>
          {provenance ? <p className="small">{provenance}.</p> : null}
          <p className="tiny dim">This is a read-only record. Your saved cards and their reviews are not changed here.</p>
        </div>
      ) : null}
    </Dialog>
  );
}
