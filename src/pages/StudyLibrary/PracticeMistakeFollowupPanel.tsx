import { useId, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { Badge, Button } from "@/components/ui";
import type {
  PracticeAttempt,
  PracticeResponse,
  PracticeTestItem,
  PracticeTestVersion,
} from "@/domain/types";
import { selectPracticeMistakeFollowups } from "@/logic/practiceMistakeFollowups";
import { SourcePageBadge } from "./navigation/SourcePageBadge";
import { PdfItemLabel } from "./PdfItemLabel";
import "./PracticeMistakeFollowupPanel.css";

export interface PracticeMistakeFollowupPanelProps {
  readonly historyKey: string;
  readonly attempt: PracticeAttempt;
  readonly version: PracticeTestVersion;
  readonly items: readonly PracticeTestItem[];
  readonly responses: readonly PracticeResponse[];
  readonly onOpenMissedReview?: () => void;
}

export function PracticeMistakeFollowupPanel({
  historyKey,
  attempt,
  version,
  items,
  responses,
  onOpenMissedReview,
}: PracticeMistakeFollowupPanelProps) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Context identity string tuple: [historyKey, attemptId, versionId]
  const contextKey = JSON.stringify([historyKey, attempt.id, version.id]);

  const [active, setActive] = useState(false);
  const [limitChoice, setLimitChoice] = useState<3 | 5>(3);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);

  // Reset state when contextKey changes
  const [prevContextKey, setPrevContextKey] = useState(contextKey);
  if (prevContextKey !== contextKey) {
    setPrevContextKey(contextKey);
    setActive(false);
    setLimitChoice(3);
    setCurrentIndex(0);
    setRevealed(false);
  }

  const result = selectPracticeMistakeFollowups({
    attempt,
    version,
    items,
    responses,
    limit: limitChoice,
  });

  const focusHeading = () => {
    if (headingRef.current) {
      headingRef.current.focus();
      if (typeof headingRef.current.scrollIntoView === "function") {
        headingRef.current.scrollIntoView({ block: "nearest" });
      }
    }
  };

  if (result.status === "unavailable") {
    return (
      <section className="card practice-mistake-followup" aria-labelledby={headingId}>
        <div className="card__body">
          <div className="practice-mistake-followup__header">
            <h3
              id={headingId}
              ref={headingRef}
              tabIndex={-1}
              className="ai-guide__title practice-mistake-followup__heading"
            >
              Short saved review
            </h3>
          </div>
          <p className="tiny dim">
            Saved review details for missed questions are unavailable for this attempt.
          </p>
        </div>
      </section>
    );
  }

  // All correct or none eligible: calm and quiet, hide panel
  if (result.totalEligibleCount === 0 || result.suggestions.length === 0) {
    return null;
  }

  const candidate = result.suggestions[currentIndex];
  if (!candidate) {
    return null;
  }

  const handleStartReview = () => {
    setActive(true);
    setCurrentIndex(0);
    setRevealed(false);
    focusHeading();
  };

  const handleDone = () => {
    setActive(false);
    setCurrentIndex(0);
    setRevealed(false);
    focusHeading();
  };

  const handleNext = () => {
    if (currentIndex < result.suggestions.length - 1) {
      setCurrentIndex((prev) => prev + 1);
      setRevealed(false);
      focusHeading();
    }
  };

  const handlePrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex((prev) => prev - 1);
      setRevealed(false);
      focusHeading();
    }
  };

  const handleFullReviewClick = () => {
    setActive(false);
    setCurrentIndex(0);
    setRevealed(false);
    onOpenMissedReview?.();
  };

  const selectedCount = result.suggestions.length;
  const hasMoreThan3 = result.totalEligibleCount > 3;

  let resultTone: "overdue" | "due" = "overdue";
  let resultLabel = "Incorrect";
  if (candidate.outcome === "unanswered") {
    resultTone = "due";
    resultLabel = "Unanswered";
  } else if (candidate.outcome === "dont_know") {
    resultTone = "due";
    resultLabel = "Marked as don't know";
  }

  return (
    <section className="card practice-mistake-followup" aria-labelledby={headingId}>
      <div className="card__body">
        <div className="practice-mistake-followup__header">
          <h3
            id={headingId}
            ref={headingRef}
            tabIndex={-1}
            className="ai-guide__title practice-mistake-followup__heading"
          >
            Short saved review
          </h3>
          {active ? (
            <Button
              type="button"
              size="small"
              variant="secondary"
              onClick={handleDone}
              className="practice-mistake-followup__button"
            >
              Done for now
            </Button>
          ) : null}
        </div>

        {!active ? (
          <div className="stack stack--3 practice-mistake-followup__body">
            <p className="small dim">
              Review questions you missed or skipped in this attempt without retaking the test. This is a historical, read-only review.
            </p>

            {hasMoreThan3 ? (
              <div
                className="row row--wrap row--gap-2 practice-mistake-followup__size-select"
                style={{ alignItems: "center" }}
              >
                <span className="small dim">Review size:</span>
                <div className="filter-chips" role="group" aria-label="Review size">
                  <button
                    type="button"
                    className={`filter-chip${limitChoice === 3 ? " is-active" : ""}`}
                    aria-pressed={limitChoice === 3}
                    onClick={() => setLimitChoice(3)}
                  >
                    Up to 3
                  </button>
                  <button
                    type="button"
                    className={`filter-chip${limitChoice === 5 ? " is-active" : ""}`}
                    aria-pressed={limitChoice === 5}
                    onClick={() => setLimitChoice(5)}
                  >
                    Up to 5
                  </button>
                </div>
              </div>
            ) : null}

            <div className="row row--wrap row--gap-2 practice-mistake-followup__actions">
              <Button
                type="button"
                variant="secondary"
                onClick={handleStartReview}
                className="practice-mistake-followup__button"
              >
                Review {selectedCount} question{selectedCount === 1 ? "" : "s"}
              </Button>
              <Link
                to={result.fullMissedReviewPath}
                className="button button--secondary practice-mistake-followup__button"
                onClick={handleFullReviewClick}
              >
                Review all missed questions
              </Link>
            </div>
          </div>
        ) : (
          <div className="stack stack--3 practice-mistake-followup__body">
            <div className="practice-mistake-followup__meta">
              <div className="row row--wrap row--gap-2" style={{ alignItems: "center" }}>
                <span className="strong">
                  Review {currentIndex + 1} of {selectedCount}
                </span>
                <span className="dim small">
                  (Question {candidate.number} of {attempt.totalQuestions})
                </span>
              </div>
              <Badge tone={resultTone}>{resultLabel}</Badge>
            </div>

            <p className="small strong">{candidate.item.questionText}</p>

            <div
              className="stack stack--2"
              role="group"
              aria-label={`Question ${candidate.number} options`}
            >
              {candidate.item.options.map((opt, optIdx) => {
                const isThisCorrect = revealed && optIdx === candidate.item.correctIndex;
                const userChoice = candidate.response ? candidate.response.selectedIndex : null;
                const isThisSelected = revealed && userChoice !== null && optIdx === userChoice;

                let optionClass = "practice-option";
                if (isThisCorrect) {
                  optionClass += " practice-option--correct";
                } else if (isThisSelected) {
                  optionClass += " practice-option--incorrect";
                }

                return (
                  <div
                    key={optIdx}
                    className={optionClass}
                    style={{ display: "flex", justifyContent: "space-between" }}
                  >
                    <span>{opt}</span>
                    {revealed ? (
                      <span>
                        {isThisCorrect && " (Correct answer)"}
                        {isThisSelected && !isThisCorrect && " (Your choice)"}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <div className="practice-mistake-followup__toggle-row">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setRevealed((prev) => !prev)}
                className="practice-mistake-followup__button"
              >
                {revealed ? "Hide saved answer" : "Show saved answer"}
              </Button>
            </div>

            {revealed ? (
              <div className="stack stack--2 practice-mistake-followup__revealed-details">
                <div className="row row--wrap row--gap-2" style={{ alignItems: "center" }}>
                  <SourcePageBadge
                    page={candidate.item.sourcePage}
                    materialId={attempt.sourceMaterialId}
                  />
                  <PdfItemLabel
                    provenance={candidate.item.pdfProvenance}
                    origin={candidate.item.origin}
                  />
                </div>

                {candidate.outcome === "dont_know" ? (
                  <p className="tiny dim">Marked as don't know during the test.</p>
                ) : null}
                {candidate.outcome === "unanswered" ? (
                  <p className="tiny dim">Unanswered during the test.</p>
                ) : null}

                {candidate.item.explanation ? (
                  <p className="tiny dim ai-copy">{candidate.item.explanation}</p>
                ) : null}

                <p className="tiny dim">
                  Write what confused you in your own words. Notes stay separate from practice history.
                </p>
                <div>
                  <Link
                    to="/notes"
                    className="button button--secondary practice-mistake-followup__button"
                  >
                    Write a note
                  </Link>
                </div>
              </div>
            ) : null}

            <div className="practice-mistake-followup__footer">
              <div className="row row--wrap row--gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={currentIndex === 0}
                  onClick={handlePrevious}
                  className="practice-mistake-followup__button"
                >
                  Previous
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={currentIndex === selectedCount - 1}
                  onClick={handleNext}
                  className="practice-mistake-followup__button"
                >
                  Next
                </Button>
              </div>
              <div>
                <Link
                  to={result.fullMissedReviewPath}
                  className="button button--secondary button--small practice-mistake-followup__button"
                  onClick={handleFullReviewClick}
                >
                  Review all missed questions
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
