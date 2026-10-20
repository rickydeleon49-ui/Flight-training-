import { useEffect, useState } from "react";

import { AlertIcon, Button } from "@/components/ui";
import type { GeminiWorkStage } from "@/services/gemini";
import type { GeminiJob, useGeminiJobs } from "@/state/GeminiJobs";

/**
 * What became of a generation that did not simply save (GEN-REL-02): an answer
 * waiting to be saved, a save that did not work, a document that changed, or a
 * generation cut off by the app closing. Saving here never asks Gemini again.
 */
export function GeminiJobNotice({
  job,
  jobs,
  onRetry,
  onReview,
  reviewDisabled = false,
}: {
  job: GeminiJob;
  jobs: ReturnType<typeof useGeminiJobs>;
  /** Start again, through the usual confirmation. Absent when that is not possible now. */
  onRetry?: () => void;
  /**
   * Her study set holds items she wrote, corrected or deleted: the new one is
   * saved only after she reviews it (OFFLINE-03a), never as is.
   */
  onReview?: () => void;
  reviewDisabled?: boolean;
}) {
  const what = job.kind === "study-aid" ? "study guide and cards" : "practice test";
  const busy = jobs.busy;

  if (job.draft && ["failed", "interrupted", "cancelled"].includes(job.phase)) {
    return (
      <div className="stack stack--3" style={{ marginTop: "var(--space-3)" }}>
        <div className="ai-disclaimer" role="status">
          <AlertIcon size={16} />
          <p className="tiny">
            {job.draft.cards.length} / {job.draft.target} cards kept as a draft. Nothing has replaced your saved content.{" "}
            {job.error}
          </p>
        </div>
        <div className="row row--wrap">
          {onRetry && !busy ? (
            <Button size="small" onClick={onRetry}>
              Try again
            </Button>
          ) : null}
          <Button size="small" variant="secondary" disabled={busy} onClick={() => void jobs.dismiss(job.key)}>
            Discard draft
          </Button>
        </div>
      </div>
    );
  }

  if (job.phase === "recovered") {
    return (
      <div className="stack stack--3" style={{ marginTop: "var(--space-3)" }}>
        <div className="ai-disclaimer" role="status">
          <AlertIcon size={16} />
          <p className="tiny">
            {job.cancelAttempted
              ? `Gemini finished a new ${what} before your cancel reached it. It has not been saved: save it, or discard it.`
              : job.local
                ? `A completed new ${what} is ready for this document. It has not been saved yet.`
                : `Gemini finished a new ${what} for this document before the app was closed or reloaded. It has not been saved yet.`}{" "}
            {onReview
              ? `Your ${job.kind === "study-aid" ? "study guide has items" : "practice test has questions"} you wrote, corrected or deleted, so you choose what to keep before anything is saved.`
              : "Saving it replaces what is saved now; completed practice history is kept."}
          </p>
        </div>
        {onReview && reviewDisabled ? <p className="tiny muted">Finish or abandon your current practice attempt before reviewing these questions.</p> : null}
        {job.answer && "sourceNotes" in job.answer ? <p className="tiny">{job.answer.sourceNotes}</p> : null}
        <div className="row row--wrap">
          {onReview ? (
            <Button size="small" disabled={busy || reviewDisabled} onClick={onReview}>
              Review the new {what}
            </Button>
          ) : (
            <Button size="small" disabled={busy} onClick={() => void jobs.saveAgain(job.key)}>
              Save the new {what}
            </Button>
          )}
          <Button size="small" variant="secondary" disabled={busy} onClick={() => void jobs.dismiss(job.key)}>
            Discard it
          </Button>
        </div>
      </div>
    );
  }

  if (job.phase === "save-failed") {
    return (
      <div className="stack stack--3" style={{ marginTop: "var(--space-3)" }}>
        <p className="field__error" role="alert">
          {job.error}
        </p>
        <div className="row row--wrap">
          {onReview ? (
            <Button size="small" disabled={busy || reviewDisabled} onClick={onReview}>
              Review again
            </Button>
          ) : (
            <Button size="small" disabled={busy} onClick={() => void jobs.saveAgain(job.key)}>
              Save again
            </Button>
          )}
          <Button size="small" variant="secondary" disabled={busy} onClick={() => void jobs.dismiss(job.key)}>
            Discard the new {what}
          </Button>
        </div>
      </div>
    );
  }

  if (job.phase === "discarding" || job.phase === "discard-failed") {
    return (
      <div className="stack stack--3" style={{ marginTop: "var(--space-3)" }}>
        {job.phase === "discard-failed" ? (
          <p className="field__error" role="alert">
            {job.error}
          </p>
        ) : (
          <p className="tiny dim" role="status">
            Discarding…
          </p>
        )}
        {job.phase === "discard-failed" ? (
          <div className="row row--wrap">
            <Button size="small" variant="secondary" onClick={() => void jobs.dismiss(job.key)}>
              Try again
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  if (job.phase === "superseded" || job.phase === "interrupted" || job.phase === "cancelled") {
    const message =
      job.phase === "superseded" || job.phase === "cancelled"
        ? job.error
        : `Creating a new ${what} was interrupted when the app closed. Google may or may not have finished it, so nothing was saved and nothing was sent again. You can try again whenever you like.`;
    const retry = job.phase !== "superseded" && onRetry && !busy;
    return (
      <div className="stack stack--3" style={{ marginTop: "var(--space-3)" }}>
        <div className="ai-disclaimer" role="status">
          <AlertIcon size={16} />
          <p className="tiny">{message}</p>
        </div>
        <div className="row row--wrap">
          {retry ? (
            <Button size="small" onClick={onRetry}>
              Try again
            </Button>
          ) : null}
          <Button size="small" variant="secondary" onClick={() => void jobs.dismiss(job.key)}>
            Dismiss
          </Button>
        </div>
      </div>
    );
  }

  return null;
}

/** Earlier Gemini work could not be read back, so nothing new may start yet. */
export function GeminiRecoveryNotice({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="stack stack--3" style={{ marginTop: "var(--space-3)" }}>
      <div className="ai-disclaimer" role="alert">
        <AlertIcon size={16} />
        <p className="tiny">
          Her Flight Deck could not check for study aids Gemini was already working on, so a new one cannot be
          started yet, in case one is waiting to be saved. Saved content is unchanged.
        </p>
      </div>
      <div className="row row--wrap">
        <Button size="small" variant="secondary" onClick={onRetry}>
          Check again
        </Button>
      </div>
    </div>
  );
}

/** Her words for each stage a generation actually reaches. */
export const STAGE_WORDS: Record<GeminiWorkStage, string> = {
  preparing: "Getting the document ready",
  uploading: "Sending the PDF to Google",
  "waiting-for-file": "Google is preparing the PDF",
  "checking-file": "Checking the copy already with Google",
  generating: "Waiting for Gemini's answer",
  reading: "Receiving Gemini's answer",
  validating: "Checking the answer",
  pausing: "Waiting before trying again",
};

function elapsedWords(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes} min ${seconds % 60} s so far` : `${seconds} s so far`;
}

/**
 * A running generation (GEN-REL-04): the stage it has actually reached, the
 * attempt once there has been a retry, how long it has been going, and a way
 * to cancel. There is no percentage, because nothing measures Gemini's own
 * progress.
 */
export function GeminiProgressView({
  job,
  title,
  onCancel,
}: {
  job: GeminiJob;
  title: string;
  onCancel: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const stage =
    job.phase === "saving" ? "Saving" : job.stage ? STAGE_WORDS[job.stage] : "Getting the document ready";
  const attempt =
    job.attempt && job.attempt > 1 && job.maxAttempts ? ` · ${job.kind === "study-aid" ? "request" : "attempt"} ${job.attempt} of ${job.maxAttempts}` : "";
  const elapsed = job.startedAt !== undefined ? elapsedWords(now - job.startedAt) : "";
  return (
    <div className="ai-working">
      <span className="ai-working__dot" aria-hidden="true" />
      <div className="stack stack--2">
        <p className="small strong">{title}</p>
        <p className="tiny">
          <span role="status" aria-live="polite">
            {job.cancelRequested ? "Cancelling…" : `${stage}${attempt}`}
          </span>
          {elapsed ? <><span aria-hidden="true"> · </span><span className="dim">{elapsed}</span></> : null}
        </p>
        {job.progress && !job.cancelRequested ? <p className="tiny dim">{job.progress}</p> : null}
        {job.cancelError ? (
          <p className="field__error" role="alert">
            {job.cancelError}
          </p>
        ) : null}
        {job.phase === "running" ? (
          <div className="row row--wrap">
            <Button size="small" variant="secondary" disabled={Boolean(job.cancelRequested)} onClick={onCancel}>
              {job.cancelRequested ? "Cancelling…" : "Cancel"}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
