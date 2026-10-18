import { AlertIcon, Button } from "@/components/ui";
import type { GeminiJob, useGeminiJobs } from "@/state/GeminiJobs";

/**
 * What became of a generation that did not simply save (GEN-REL-02): an answer
 * waiting to be saved, a save that did not work, a document that changed, or a
 * generation cut off by the app closing. Saving here never asks Gemini again.
 */
export function GeminiJobNotice({
  job,
  jobs,
}: {
  job: GeminiJob;
  jobs: ReturnType<typeof useGeminiJobs>;
}) {
  const what = job.kind === "study-aid" ? "study guide and cards" : "practice test";
  const busy = jobs.busy;

  if (job.phase === "recovered") {
    return (
      <div className="stack stack--3" style={{ marginTop: "var(--space-3)" }}>
        <div className="ai-disclaimer" role="status">
          <AlertIcon size={16} />
          <p className="tiny">
            Gemini finished a new {what} for this document before the app was closed or reloaded.
            It has not been saved yet. Saving it replaces what is saved now; completed practice history
            is kept.
          </p>
        </div>
        <div className="row row--wrap">
          <Button size="small" disabled={busy} onClick={() => void jobs.saveAgain(job.key)}>
            Save the new {what}
          </Button>
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
          <Button size="small" disabled={busy} onClick={() => void jobs.saveAgain(job.key)}>
            Save again
          </Button>
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

  if (job.phase === "superseded" || job.phase === "interrupted") {
    const message =
      job.phase === "superseded"
        ? job.error
        : `Creating a new ${what} was interrupted when the app closed. Google may or may not have finished it, so nothing was saved and nothing was sent again. You can try again whenever you like.`;
    return (
      <div className="stack stack--3" style={{ marginTop: "var(--space-3)" }}>
        <div className="ai-disclaimer" role="status">
          <AlertIcon size={16} />
          <p className="tiny">{message}</p>
        </div>
        <div className="row row--wrap">
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
