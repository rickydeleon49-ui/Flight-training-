/**
 * Card reviews inside the Flashcards card of MaterialDetail (M2-3 C1).
 *
 * Flip a card, rate it, see when it comes back; return later to exactly the
 * cards that are due; pause or flag any current card; see recent reviews; and
 * reset this material's reviews behind a clear confirmation. Works offline.
 * Ratings only schedule reviews: they are never scores, mastery, FAA results
 * or readiness, and practice tests are unaffected.
 */
import { useContext, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";

import { Badge, Button } from "@/components/ui";
import type { CardFlagReason, CardRating, CardReviewItemState, CardReviewSnapshotItem } from "@/domain/types";
import type { CardReviewRepository } from "@/data/repositories/cardReviewRepository";
import { nextLocalMidnightUtc, shortLocalDay } from "@/logic/localDay";
import { AppDataContext } from "@/state/AppDataContext";
import { AskGeminiPanel, formatFlashcardContext } from "./AskGeminiPanel";

import { ResetCardReviewsDialog } from "./ResetCardReviewsDialog";
import {
  describeReturn,
  ratingWaits,
  summarizeCards,
  useCardReview,
  type CardReviewController,
  type ItemActionKind,
} from "./useCardReview";
import { SourcePageBadge } from "./navigation/SourcePageBadge";

export const MALFORMED_CARDS_MESSAGE =
  "These saved cards can't be reviewed because they're damaged. Your study guide is still here. Regenerating or re-importing creates a fresh set.";
export const READ_FAILURE_MESSAGE = "Card reviews couldn't be loaded just now. Your cards are still here to browse.";
export const RATING_NOT_A_SCORE = "Your rating only decides when this card comes back. It isn't a score.";

const RATING_LABELS: Record<CardRating, string> = { again: "Again", hard: "Hard", good: "Good", easy: "Easy" };
const RATING_ORDER: CardRating[] = ["again", "hard", "good", "easy"];
const FLAG_LABELS: Record<CardFlagReason, string> = {
  wrong_answer: "Wrong answer",
  unclear: "Unclear",
  not_in_source: "Not in my source",
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

interface CardReviewPanelProps {
  materialId: string;
  materialTitle: string;
  repository: CardReviewRepository | undefined;
  materialFilePath?: string | null;
  /** Changes whenever the saved cards are replaced, so the panel reads again. */
  contentKey?: string;
  /** The card the browse carousel is showing, so it can be paused or flagged. */
  browseCard?: { index: number; front: string; back: string } | null;
  /** Opened from Review due: start this material's session once its cards are read. */
  autoStart?: boolean;
}

export function CardReviewPanel({ materialId, materialTitle, repository, materialFilePath, contentKey, browseCard, autoStart = false }: CardReviewPanelProps) {
  const review = useCardReview(materialId, repository, { contentKey });
  const [resetOpen, setResetOpen] = useState(false);
  const resetWasPending = useRef(false);
  const autoStarted = useRef(false);
  const entrySessionPending = useRef(false);
  const { session, blocked, starting, startSession, clock } = review;
  const reviewRead = review.read;

  // A request from Review due starts at most one session, and only when
  // this material has cards ready (the C1 caps of 10 new / 20 total apply).
  useEffect(() => {
    if (!autoStart || autoStarted.current || session || blocked || starting) return;
    if (reviewRead.phase !== "ready") return;
    autoStarted.current = true;
    if (reviewRead.snapshot.current.status !== "ok") return;
    const now = clock.now();
    const summary = summarizeCards(reviewRead.snapshot, now, nextLocalMidnightUtc(now, clock.timeZone()));
    if (summary.dueNow + summary.newCount > 0) {
      entrySessionPending.current = true;
      void startSession();
    }
  }, [autoStart, reviewRead, session, blocked, starting, startSession, clock]);

  // The dialog closes once its reset is resolved (acknowledged or refused).
  useEffect(() => {
    if (review.resetPending) resetWasPending.current = true;
    else if (resetWasPending.current) {
      resetWasPending.current = false;
      setResetOpen(false);
    }
  }, [review.resetPending]);

  if (!repository) return null;
  const { read } = review;
  if (read.phase === "loading") {
    return (
      <p className="tiny dim" role="status">
        Loading card reviews…
      </p>
    );
  }
  if (read.phase === "failed") {
    return (
      <section className="card-review" aria-label="Card reviews">
        <p className="small muted" role="alert">
          {READ_FAILURE_MESSAGE}
        </p>
        <div>
          <Button size="small" onClick={review.retryReads}>
            Retry card reviews
          </Button>
        </div>
      </section>
    );
  }
  const { snapshot } = read;
  if (snapshot.current.status === "none") return null;
  if (snapshot.current.status === "malformed") {
    return (
      <section className="card-review" aria-label="Card reviews">
        <p className="small muted" role="note">
          {MALFORMED_CARDS_MESSAGE}
        </p>
      </section>
    );
  }

  const items = snapshot.current.items;
  const now = review.clock.now();
  const zone = review.clock.timeZone();
  const summary = summarizeCards(snapshot, now, nextLocalMidnightUtc(now, zone));
  const reviewable = summary.dueNow + summary.newCount > 0;
  const nextAt = [summary.againLater.nextAt, summary.nextDayAt].filter((v): v is string => v !== null).sort()[0] ?? null;
  const browseItem =
    browseCard && items[browseCard.index]?.front === browseCard.front && items[browseCard.index]?.back === browseCard.back
      ? items[browseCard.index]!
      : null;
  const paused = items.filter((item) => {
    const state = snapshot.states[item.itemId];
    return state?.suspended || state?.flag;
  });

  let statusLine: string;
  if (summary.allPaused) statusLine = "Nothing to review — all cards are paused or flagged.";
  else if (!reviewable) {
    statusLine = nextAt
      ? `All caught up. Next review: ${summary.nextDayAt === nextAt ? shortLocalDay(nextAt, zone) : describeReturn(nextAt, now, zone)}.`
      : "All caught up.";
  } else {
    statusLine = [summary.newCount > 0 ? plural(summary.newCount, "new card") : null, summary.dueNow > 0 ? `${plural(summary.dueNow, "card")} due` : "none due"]
      .filter(Boolean)
      .join(" · ");
  }

  return (
    <section className="card-review stack stack--3" aria-labelledby="card-review-title">
      <div className="row row--between">
        <div>
          <p className="eyebrow">Card reviews</p>
          <h3 id="card-review-title" className="ai-guide__title">
            {statusLine}
          </h3>
        </div>
        {review.session ? null : (
          <Button
            size="small"
            variant="primary"
            disabled={!reviewable || review.blocked || review.starting}
            onClick={() => void review.startSession()}
          >
            {review.starting ? "Opening…" : "Review cards"}
          </Button>
        )}
      </div>

      <Notices review={review} />

      {review.sessionUnavailable ? (
        <p className="small muted" role="alert">
          Card reviews couldn&rsquo;t be opened just now. Your cards are still here to browse.
        </p>
      ) : null}

      {review.session ? (
        <SessionView
          review={review}
          items={items}
          states={snapshot.states}
          materialId={materialId}
          materialFilePath={materialFilePath}
          focusEntry={entrySessionPending.current}
          onEntryShown={() => {
            entrySessionPending.current = false;
          }}
        />
      ) : null}

      {!review.session && browseItem ? (
        <div className="row card-review__browse-options">
          <span className="tiny dim">Card {browseItem.ordinal + 1}:</span>
          <CardOptions
            item={browseItem}
            state={snapshot.states[browseItem.itemId]}
            disabled={review.blocked}
            onAction={(kind) => review.itemAction(browseItem.itemId, kind)}
          />
        </div>
      ) : null}

      {paused.length > 0 ? (
        <section className="stack stack--2" aria-labelledby="card-review-paused-title">
          <h4 id="card-review-paused-title" className="small strong">
            Paused and flagged cards
          </h4>
          <ul className="card-review__list">
            {paused.map((item) => {
              const state = snapshot.states[item.itemId]!;
              return (
                <li key={item.itemId} className="row row--between">
                  <span className="small">
                    {item.front}{" "}
                    {state.flag ? <Badge tone="due">Flagged: {FLAG_LABELS[state.flag]}</Badge> : null}
                    {state.suspended ? <Badge tone="neutral">Paused</Badge> : null}
                  </span>
                  <span className="row">
                    {state.suspended ? (
                      <Button
                        size="small"
                        disabled={review.blocked}
                        aria-label={`Resume card: ${item.front}`}
                        onClick={() => review.itemAction(item.itemId, { action: "resume" })}
                      >
                        Resume
                      </Button>
                    ) : null}
                    {state.flag ? (
                      <Button
                        size="small"
                        disabled={review.blocked}
                        aria-label={`Unflag card: ${item.front}`}
                        onClick={() => review.itemAction(item.itemId, { action: "unflag" })}
                      >
                        Unflag
                      </Button>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <RecentReviews review={review} zone={zone} />

      <div className="card-review__reset">
        <Button size="small" variant="secondary" disabled={review.blocked} onClick={() => setResetOpen(true)}>
          Reset card reviews
        </Button>
      </div>

      <ResetCardReviewsDialog
        open={resetOpen}
        materialTitle={materialTitle}
        pending={review.resetPending}
        checking={review.resetCheck}
        onConfirm={review.confirmReset}
        onCancel={() => {
          if (!review.resetPending) setResetOpen(false);
        }}
        onTryAgain={review.tryResetAgain}
        onCheckAgain={() => void review.checkResetAgain()}
      />
    </section>
  );
}

function Notices({ review }: { review: CardReviewController }) {
  const { notice, pending, locked } = review;
  return (
    <>
      {notice?.kind === "saved" ? (
        <p className="small" role="status">
          {notice.text}
        </p>
      ) : null}
      {notice?.kind === "reset-done" ? (
        <p className="small" role="status">
          Card reviews for this material were reset. Your cards are all new again.
        </p>
      ) : null}
      {locked ? (
        <div className="stack stack--2" role="alert">
          <p className="small muted">
            Card reviews couldn&rsquo;t be refreshed just now, so rating and other changes are paused until they are.
          </p>
          <div>
            <Button size="small" onClick={review.retryReads}>
              Retry card reviews
            </Button>
          </div>
        </div>
      ) : null}
      {pending?.status === "unknown" ? (
        <div className="stack stack--2" role="alert">
          <p className="small">
            {pending.action.action === "rate"
              ? "We couldn't confirm that rating. Try again resends the same rating; it won't be counted twice."
              : "We couldn't confirm that change. Try again resends the same change; it won't be applied twice."}
          </p>
          <div>
            <Button size="small" variant="primary" onClick={review.tryAgain}>
              Try again
            </Button>
          </div>
        </div>
      ) : null}
      {notice?.kind === "stale" ? (
        <div className="stack stack--2" role="alert">
          <p className="small">These cards changed since you opened them.</p>
          <div>
            <Button size="small" onClick={review.retryReads}>
              Refresh
            </Button>
          </div>
        </div>
      ) : null}
      {notice?.kind === "clock" ? (
        <p className="small" role="alert">
          Your computer&rsquo;s clock is earlier than this card&rsquo;s last review, so this rating wasn&rsquo;t saved. Check the
          date and time on this computer, then rate the card again.
        </p>
      ) : null}
      {notice?.kind === "paused-or-flagged" ? (
        <p className="small" role="alert">
          That card is paused or flagged, so it wasn&rsquo;t rated.
        </p>
      ) : null}
      {notice?.kind === "not-saved" ? (
        <p className="small" role="alert">
          That change wasn&rsquo;t saved. Your cards are unchanged.
        </p>
      ) : null}
    </>
  );
}

function SessionView({
  review,
  items,
  states,
  materialId,
  materialFilePath,
  focusEntry,
  onEntryShown,
}: {
  review: CardReviewController;
  items: CardReviewSnapshotItem[];
  states: Record<string, CardReviewItemState>;
  materialId: string;
  materialFilePath?: string | null;
  focusEntry: boolean;
  onEntryShown: () => void;
}) {
  const session = review.session!;
  const region = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const entryFocusHandled = useRef(false);
  const navigationFrom = useRef<string | null>(null);
  const shown = session.cards[session.position];
  const item = shown ? items.find((candidate) => candidate.itemId === shown.itemId) : undefined;
  const appData = useContext(AppDataContext);
  const currentMaterial = appData?.data?.materials?.find((m) => m.id === materialId);
  const resolvedFilePath = materialFilePath ?? currentMaterial?.filePath ?? null;

  useLayoutEffect(() => {
    if (focusEntry) {
      if (entryFocusHandled.current) return;
      entryFocusHandled.current = true;
      const behavior = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
      region.current?.scrollIntoView?.({ block: "start", behavior });
      heading.current?.focus({ preventScroll: true });
      onEntryShown();
    } else {
      region.current?.focus({ preventScroll: true });
    }
  }, []);

  useLayoutEffect(() => {
    if (!shown || navigationFrom.current === null || navigationFrom.current === shown.itemId) return;
    navigationFrom.current = null;
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView?.({
      block: "start",
      behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }, [shown?.itemId]);

  const rate = (rating: CardRating) => {
    if (review.blocked || !shown) return;
    navigationFrom.current = shown.itemId;
    review.rate(rating);
  };

  if (!shown || !item) {
    return <DoneForNow review={review} />;
  }
  const state = states[item.itemId];
  const now = review.clock.now();
  const waits = ratingWaits(state, now);
  const busy = review.blocked;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (busy) return;
    const target = event.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable)
    ) {
      return;
    }
    if (!review.revealed && (event.key === " " || event.key === "Enter")) {
      if (event.target !== event.currentTarget && event.target !== heading.current) return; // buttons handle their own keys
      event.preventDefault();
      review.reveal();
      return;
    }
    const index = ["1", "2", "3", "4"].indexOf(event.key);
    if (review.revealed && index >= 0) {
      event.preventDefault();
      rate(RATING_ORDER[index]!);
    }
  };

  return (
    <div
      ref={region}
      className="card-review__session stack stack--3"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      aria-label={`Card review session. Card ${session.position + 1} of ${session.cards.length}.`}
    >
      <div className="row row--between">
        <h4 ref={heading} tabIndex={-1} className="small strong">
          Card {session.position + 1} of {session.cards.length}
          {shown.kind === "new" ? " · new" : ""}
        </h4>
        <SourcePageBadge page={item.sourcePage} materialId={materialId} />
      </div>
      <div className={`flashcard${review.revealed ? " is-revealed" : ""}`} aria-live="polite">
        <span className="tiny dim">{review.revealed ? "Answer" : "Question"}</span>
        <span>{item.front}</span>
        {review.revealed ? <span className="card-review__answer">{item.back}</span> : null}
      </div>
      {review.revealed ? (
        <>
          <p className="tiny dim">{RATING_NOT_A_SCORE}</p>
          <div className="card-review__ratings" role="group" aria-label="Rate this card">
            {RATING_ORDER.map((rating, index) => (
              <Button
                key={rating}
                size="small"
                variant={rating === "good" ? "primary" : "secondary"}
                disabled={busy}
                aria-keyshortcuts={String(index + 1)}
                aria-label={`${RATING_LABELS[rating]}: again in ${waits?.[rating] ?? "a while"}`}
                onClick={() => rate(rating)}
              >
                <span>{RATING_LABELS[rating]}</span>
                <span className="tiny card-review__wait"> · {waits?.[rating] ?? "—"}</span>
              </Button>
            ))}
          </div>
          <AskGeminiPanel
            materialId={materialId}
            relativePath={resolvedFilePath}
            context={formatFlashcardContext(item.front, item.back, item.sourcePage)}
            buttonLabel="Explain this"
          />
        </>
      ) : (
        <div>
          <Button size="small" variant="primary" disabled={busy} aria-keyshortcuts="Space Enter" onClick={review.reveal}>
            Show answer
          </Button>
        </div>
      )}
      <div className="row row--between">
        <CardOptions
          item={item}
          state={state}
          disabled={busy}
          onAction={(kind) => { navigationFrom.current = item.itemId; review.itemAction(item.itemId, kind); }}
        />
        <Button size="small" variant="ghost" onClick={review.endSession}>
          Done for now
        </Button>
      </div>
      <p className="tiny dim">{review.revealed ? "1–4 rate it." : "Space or Enter shows the answer; 1–4 rate it."}</p>
    </div>
  );
}

function DoneForNow({ review }: { review: CardReviewController }) {
  if (review.read.phase !== "ready") return null;
  const now = review.clock.now();
  const zone = review.clock.timeZone();
  const summary = summarizeCards(review.read.snapshot, now, nextLocalMidnightUtc(now, zone));
  const parts = ["Done for now"];
  if (summary.againLater.count > 0 && summary.againLater.nextAt) {
    parts.push(`${plural(summary.againLater.count, "card")} back ${describeReturn(summary.againLater.nextAt, now, zone)}`);
  }
  if (summary.nextDayAt) parts.push(`next review ${describeReturn(summary.nextDayAt, now, zone)}`);
  return (
    <div className="card-review__session stack stack--2">
      <p className="small strong" role="status">
        {parts.join(" · ")}
      </p>
      <div>
        <Button size="small" onClick={review.endSession}>
          Close review
        </Button>
      </div>
    </div>
  );
}

function CardOptions({
  item,
  state,
  disabled,
  onAction,
}: {
  item: CardReviewSnapshotItem;
  state: CardReviewItemState | undefined;
  disabled: boolean;
  onAction: (kind: ItemActionKind) => void;
}) {
  const [open, setOpen] = useState(false);
  const act = (kind: ItemActionKind) => {
    setOpen(false);
    onAction(kind);
  };
  return (
    <div className="card-review__options">
      <Button
        size="small"
        variant="ghost"
        aria-expanded={open}
        aria-label={`More options for card: ${item.front}`}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        Card options
      </Button>
      {open && !disabled ? (
        <div className="card-review__menu" role="group" aria-label={`Options for card: ${item.front}`}>
          {state?.suspended ? (
            <Button size="small" onClick={() => act({ action: "resume" })}>
              Resume this card
            </Button>
          ) : (
            <Button size="small" onClick={() => act({ action: "suspend" })}>
              Pause this card (not now)
            </Button>
          )}
          {state?.flag ? (
            <Button size="small" onClick={() => act({ action: "unflag" })}>
              Unflag this card
            </Button>
          ) : (
            (Object.keys(FLAG_LABELS) as CardFlagReason[]).map((reason) => (
              <Button key={reason} size="small" onClick={() => act({ action: "flag", reason })}>
                Flag: {FLAG_LABELS[reason]}
              </Button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

function RecentReviews({ review, zone }: { review: CardReviewController; zone: string }) {
  const { rows, next, failed, loading } = review.recent;
  if (rows.length === 0) return null;
  const format = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: zone });
  return (
    <section className="stack stack--2" aria-labelledby="card-review-recent-title">
      <h4 id="card-review-recent-title" className="small strong">
        Recent reviews
      </h4>
      <ul className="card-review__list">
        {rows.map((row) => (
          <li key={row.id} className="small">
            <span>{row.front}</span> <span className="dim">· {RATING_LABELS[row.rating]} · {format.format(new Date(row.reviewedAt))}</span>
            {row.earlierVersion ? <span className="tiny dim"> · earlier version of these cards</span> : null}
          </li>
        ))}
      </ul>
      {failed ? (
        <p className="tiny muted" role="alert">
          More reviews couldn&rsquo;t be loaded just now.
        </p>
      ) : null}
      {next ? (
        <div>
          <Button size="small" variant="ghost" disabled={loading} onClick={() => void review.loadMoreRecent()}>
            Show more reviews
          </Button>
        </div>
      ) : null}
    </section>
  );
}
