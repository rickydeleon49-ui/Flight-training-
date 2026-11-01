import { KIT_PRACTICE_ATTEMPT_MESSAGE } from "@/data/persistenceErrors";
import { GuideBody } from "./GuideBody";
import { providerCompany, providerWording } from "@/services/provider";
import { useEffect, useRef, useState } from "react";

import { AlertIcon, Button, ConfirmDialog } from "@/components/ui";
import { geminiModelName, SECTION_GUIDE_MESSAGES, SectionGuideError, type GeminiWorkStage } from "@/services/gemini";
import { splitGeminiError } from "@/logic/geminiErrorText";
import { useAppData } from "@/state/AppDataContext";
import { EMPTY_FLASHCARDS_MESSAGE, isNewerJob, type GeminiJob, type useGeminiJobs } from "@/state/GeminiJobs";

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
  model,
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
  model?: string;
}) {
  const helperModel = job.answer?.model ?? job.sections?.model ?? model;
  const helper = providerCompany(helperModel) === "Anthropic" ? "Claude" : "Gemini";
  const company = providerCompany(helperModel);
  const what = job.kind === "study-kit" ? "study kit" : job.kind === "study-aid" ? "study guide" : job.kind === "flashcards" ? "flashcards" : "practice test";
  const readyTitle =
    job.kind === "study-aid"
      ? "Your new study guide is ready."
      : job.kind === "flashcards"
        ? "Your new flashcards are ready."
        : "Your new practice test is ready.";
  const busy = jobs.busy;

  if (
    job.sectionGuide &&
    jobs.jobs.some(
      (other) =>
        other.key !== job.key &&
        other.materialId === job.materialId &&
        other.kind === "study-aid" &&
        other.sectionGuide &&
        isNewerJob(other, job),
    )
  ) {
    return null;
  }

  if (
    job.sectionGuide &&
    job.phase !== "cancelled" &&
    job.queueState !== "cancelled" &&
    (job.phase === "waiting-for-her" || job.queueState === "waiting-for-her")
  ) {
    return <QueuedSectionGuideNotice job={job} jobs={jobs} />;
  }

  if (
    job.sectionGuide &&
    (["failed", "interrupted", "cancelled"].includes(job.phase) || job.queueState === "cancelled")
  ) {
    return <SectionGuideNotice job={job} jobs={jobs} model={helperModel} />;
  }

  if (job.draft && ["failed", "interrupted", "cancelled"].includes(job.phase)) {
    return (
      <div className="stack stack--3" style={{ marginTop: "var(--space-3)" }}>
        <div className="ai-disclaimer" role="status">
          <AlertIcon size={16} />
          <div className="stack stack--1">
            {job.draft.cards.length > 0 ? (
              <p className="tiny">
                {job.draft.cards.length} / {job.draft.target} cards kept as a draft. Nothing has replaced your saved content.
              </p>
            ) : null}
            {job.error ? (
              <GeminiErrorText model={job.answer?.model ?? job.sections?.model ?? model} message={job.error} calm />
            ) : job.phase === "failed" && job.draft.cards.length === 0 ? (
              // Never just buttons: a failed empty draft always says what happened.
              <p className="tiny">{providerWording(EMPTY_FLASHCARDS_MESSAGE, helperModel)}</p>
            ) : null}
          </div>
        </div>
        <div className="row row--wrap">
          {onRetry && !busy ? (
            <Button size="small" onClick={onRetry}>
              Try again
            </Button>
          ) : null}
          <Button size="small" variant="secondary" disabled={busy} onClick={() => void jobs.dismiss(job.key)}>
            {job.draft.cards.length > 0 ? "Discard draft" : "Dismiss"}
          </Button>
        </div>
      </div>
    );
  }

  if (job.phase === "recovered") {
    const summary = readySummary(job);
    return (
      <div className="stack stack--3" style={{ marginTop: "var(--space-3)" }}>
        <div className="file-row" role="status">
          <p className="tiny">
            {job.studyKitPart && !onReview && !job.cancelAttempted
              ? `Review the new ${what} below, then save or discard it.`
              : job.cancelAttempted
              ? `${helper} finished a new ${what} before your cancel reached it. It has not been saved: save it, or discard it.`
              : job.local || job.studyKitPart
                ? `${readyTitle} It has not been saved yet.`
                : `${helper} finished a new ${what} for this document before the app was closed or reloaded. It has not been saved yet.`}
            {job.answer?.model && !job.studyKitPart ? <> <span>Made with {geminiModelName(job.answer.model)}.</span></> : null}{" "}
            {job.studyKitPart && !onReview ? "" : onReview
              ? `Your ${job.kind === "study-aid" ? "study guide has items" : job.kind === "flashcards" ? "study set has flashcards" : "practice test has questions"} you wrote, corrected or deleted, so you choose what to keep before anything is saved.`
              : job.kind === "study-aid" ? "Saving it replaces your saved guide; any saved flashcards stay as they are." : job.kind === "flashcards" ? "Saving it replaces your saved cards; your study guide stays as it is." : "Saving it replaces what is saved now; completed practice history is kept."}
          </p>
        </div>
        {job.error === KIT_PRACTICE_ATTEMPT_MESSAGE ? <p className="small" role="status">{KIT_PRACTICE_ATTEMPT_MESSAGE}</p> : null}
        {onReview && reviewDisabled ? <p className="tiny muted">Finish or abandon your current practice attempt before reviewing these questions.</p> : null}
        {job.studyKitPart && !job.checkpointed ? <p className="tiny" role="alert">This draft could not be kept on this computer. Keep this window open until you save or discard it.</p> : null}
        {summary ? <p className="tiny">{summary}</p> : null}
        {job.studyKitPart && job.answer ? <StudyKitPartPreview job={job} what={what} /> : null}
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
          {(job.sectionGuide || job.studyKitPart) ? <SectionDraftDiscard job={job} jobs={jobs} label="Discard it" /> : (
          <Button size="small" variant="secondary" disabled={busy} onClick={() => void jobs.dismiss(job.key)}>
            Discard it
          </Button>
          )}
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
          {(job.sectionGuide || job.studyKitPart) ? <SectionDraftDiscard job={job} jobs={jobs} label={`Discard the new ${what}`} /> : (
          <Button size="small" variant="secondary" disabled={busy} onClick={() => void jobs.dismiss(job.key)}>
            Discard the new {what}
          </Button>
          )}
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

  if (job.phase === "superseded" || job.phase === "interrupted" || job.phase === "cancelled" || (job.phase === "failed" && !job.draft)) {
    const message =
      job.phase === "superseded" || job.phase === "cancelled" || job.phase === "failed"
        ? job.error
        : `Creating a new ${what} was interrupted when the app closed. ${company} may or may not have finished it, so nothing was saved and nothing was sent again. You can try again whenever you like.`;
    const retry = job.phase !== "superseded" && onRetry && !busy;
    return (
      <div className="stack stack--3" style={{ marginTop: "var(--space-3)" }}>
        <div className="ai-disclaimer" role="status">
          <AlertIcon size={16} />
          <GeminiErrorText model={job.answer?.model ?? job.sections?.model ?? model} message={message ?? "Gemini could not finish. Try again."} calm />
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

/**
 * How much Gemini actually made, in her words. The answer's own provenance
 * note is hashes and JSON for a section guide, which pushed the buttons off
 * the screen; it stays stored and is shown under the saved study aid.
 */
/** Use the same guide renderer and plain card/question fields as saved study aids. */
function StudyKitPartPreview({ job, what }: { job: GeminiJob; what: string }) {
  // Reading the draft should not spoil the test, so answers start hidden.
  const [showAnswers, setShowAnswers] = useState(false);
  const answer = job.answer;
  if (!answer) return null;
  return <details>
    <summary>Read the new {what}</summary>
    <div className="stack stack--3">
      {"questions" in answer ? <div className="row row--wrap">
        <Button size="small" variant="secondary" onClick={() => setShowAnswers((shown) => !shown)}>{showAnswers ? "Hide answers" : "Show answers"}</Button>
      </div> : null}
      {"questions" in answer ? answer.questions.map((question, index) => <div key={index}>
        <p>{question.question}</p>
        <ol>{question.options.map((option, n) => <li key={n}>{option}{showAnswers && n === question.correctIndex ? " (correct answer)" : ""}</li>)}</ol>
        {showAnswers ? <p>{question.explanation}</p> : null}
        <p>Source page {question.sourcePage}</p>
        {question.verificationNote ? <p className="tiny muted">{question.verificationNote}</p> : null}
      </div>) : job.kind === "flashcards" ? answer.flashcards.map((card, index) => <div key={index}>
        <p><strong>{card.front}</strong></p><p>{card.back}</p><p>Source page {card.sourcePage}</p>
        {card.verificationNote ? <p className="tiny muted">{card.verificationNote}</p> : null}
      </div>) : <>
        {answer.sections.map((section, index) => <div key={index}>
          <p><strong>{section.heading}</strong></p><GuideBody text={section.body} />
        </div>)}
        <p className="tiny muted">{answer.sourceNotes}</p>
      </>}
      <p className="tiny muted">AI study aid. Check against current FAA material and your instructor.</p>
    </div>
  </details>;
}

function readySummary(job: GeminiJob): string | null {
  const answer = job.answer;
  if (!answer) return null;
  if ("questions" in answer) {
    const n = answer.questions.length;
    return `${n} ${n === 1 ? "question" : "questions"} ready.`;
  }
  if (job.kind === "flashcards" && "flashcards" in answer) {
    const n = answer.flashcards.length;
    return `${n} ${n === 1 ? "flashcard" : "flashcards"} ready.`;
  }
  if ("sections" in answer) {
    const n = answer.sections.length;
    return `${n} ${n === 1 ? "section" : "sections"}, ready to review and save.`;
  }
  return null;
}

function QueuedSectionGuideNotice({
  job,
  jobs,
}: {
  job: GeminiJob;
  jobs: ReturnType<typeof useGeminiJobs>;
}) {
  const [pending, setPending] = useState(false);
  const intent = useRef(false);
  const { data } = useAppData();
  const material = data.materials.find((m) => m.id === job.materialId);
  const materialTitle = material?.title ?? "";
  const total = job.sections?.total ?? 0;

  const activate = () => {
    if (intent.current || jobs.locked()) return;
    intent.current = true;
    setPending(true);
    void jobs.continueGuide(job.key, false).finally(() => {
      intent.current = false;
      setPending(false);
    });
  };

  const cancel = () => {
    if (pending) return;
    setPending(true);
    void jobs.cancel(job.key).finally(() => {
      setPending(false);
    });
  };

  return (
    <div className="stack stack--3" style={{ marginTop: "var(--space-3)" }}>
      <div className="ai-disclaimer" role="status">
        <AlertIcon size={16} />
        <p className="tiny">
          Waiting for you to start. Press Start now when you have a good connection.
        </p>
      </div>
      <div className="stack stack--1">
        {materialTitle ? <p className="small strong">{materialTitle}</p> : null}
        <p className="tiny dim">
          {total} {total === 1 ? "section planned" : "sections planned"}
        </p>
      </div>
      <div className="row row--wrap">
        <Button size="small" disabled={jobs.busy || pending} onClick={activate}>
          Start now
        </Button>
        <Button size="small" variant="secondary" disabled={pending} onClick={cancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** Section drafts never share the legacy retry or one-click discard path. */
function SectionGuideNotice({ job, jobs, model }: { job: GeminiJob; jobs: ReturnType<typeof useGeminiJobs>; model?: string }) {
  const [keeping, setKeeping] = useState(false);
  const [pending, setPending] = useState(false);
  const intent = useRef(false);
  const code = job.sectionError;
  const sourceChanged = code === "SOURCE_CHANGED" || code === "PLAN_CHANGED" || code === "CONSENT_REQUIRED";
  const activate = (restart = false) => {
    if (intent.current || jobs.locked()) return;
    intent.current = true;
    setPending(true);
    void jobs.continueGuide(job.key, restart).finally(() => { intent.current = false; setPending(false); });
  };
  const saved = job.sections?.ready ?? 0;
  // Never imply there are finished sections when the first request failed.
  const message =
    job.phase === "cancelled" || job.queueState === "cancelled"
      ? SECTION_GUIDE_MESSAGES.CANCELLED
      : saved === 0
        ? "Nothing was finished yet."
        : keeping || !job.local
          ? "Your finished sections are here. Continue when you're ready."
          : saved === 1
            ? "Your 1 finished section is saved. Try again to continue with section 2."
            : `Your ${saved} finished sections are saved. Try again to continue with section ${saved + 1}.`;
  return (
    <div className="stack stack--3" style={{ marginTop: "var(--space-3)" }}>
      {message ? <div className="ai-disclaimer" role="status"><AlertIcon size={16} /><p className="tiny">{message}</p></div> : null}
      {/* Only a reason classified as plain on the wire this session is shown as written; a
          recovered journal string may be internal text, so it gets the generic sentence. */}
      {code && code !== "CANCELLED" && !keeping ? <div role="alert"><GeminiErrorText model={model} message={code === "GUIDE_FAILED" ? new SectionGuideError(code, job.local ? job.error ?? undefined : undefined).message : SECTION_GUIDE_MESSAGES[code]} calm /></div> : null}
      <div className="row row--wrap">
        {sourceChanged && !keeping ? <>
          <Button size="small" variant="secondary" onClick={() => setKeeping(true)}>Keep my earlier work</Button>
          <Button size="small" disabled={jobs.busy || pending} onClick={() => activate(true)}>Start a new guide</Button>
        </> : code === "KEY_CHANGED" ? (
          <Button size="small" disabled={jobs.busy || pending} onClick={() => activate(true)}>Continue</Button>
        ) : code !== "TOO_MANY_SECTIONS" && job.jobId && job.sections ? (
          <Button size="small" disabled={jobs.busy || pending} onClick={() => activate()}>Try again</Button>
        ) : null}
        <SectionDraftDiscard job={job} jobs={jobs} disabled={pending} />
      </div>
    </div>
  );
}

export function SectionDraftDiscard({ job, jobs, label = "Discard", disabled = false }: {
  job: GeminiJob;
  jobs: ReturnType<typeof useGeminiJobs>;
  label?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const intent = useRef(false);
  return <>
    <Button size="small" variant="secondary" disabled={jobs.busy || disabled || pending} onClick={() => setOpen(true)}>{label}</Button>
    <ConfirmDialog open={open} title="Discard this draft?"
      message="Discard this draft? Your saved material stays."
      confirmLabel="Discard draft" pending={pending} pendingLabel="Discarding…"
      onCancel={() => setOpen(false)} onConfirm={() => {
        if (intent.current) return;
        intent.current = true;
        setPending(true);
        void jobs.dismiss(job.key).finally(() => { intent.current = false; setPending(false); setOpen(false); });
      }} />
  </>;
}

/**
 * One Gemini failure: the plain sentence, with any technical trace folded
 * away under "Details" so it never competes with what she should do next.
 */
export function GeminiErrorText({ message, calm = false, model }: { message: string; calm?: boolean; model?: string }) {
  const { text: original, details } = splitGeminiError(message);
  const text = providerWording(original, model);
  return (
    <div className="stack stack--1">
      <p className={calm ? "tiny" : "field__error"} role={calm ? undefined : "alert"} style={{ whiteSpace: "pre-line" }}>
        {text}
      </p>
      {details ? (
        <details className="tiny dim">
          <summary style={{ cursor: "pointer" }}>Details</summary>
          <p className="tiny dim" style={{ whiteSpace: "pre-line" }}>{details}</p>
        </details>
      ) : null}
    </div>
  );
}

/** Earlier Gemini work could not be read back, so nothing new may start yet. */
export function GeminiRecoveryNotice({ onRetry, model }: { onRetry: () => void; model?: string }) {
  const helper = providerCompany(model) === "Anthropic" ? "Claude" : "Gemini";
  return (
    <div className="stack stack--3" style={{ marginTop: "var(--space-3)" }}>
      <div className="ai-disclaimer" role="alert">
        <AlertIcon size={16} />
        <p className="tiny">
          Her Flight Deck could not check for study aids {helper} was already working on, so a new one cannot be
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
 * A running generation (GEN-REL-04): the stage it has actually reached,
 * a calm retry message, how long it has been going, and a way
 * to cancel. There is no percentage, because nothing measures Gemini's own
 * progress.
 */
export function GeminiProgressView({
  job,
  title,
  onCancel,
  model,
}: {
  job: GeminiJob;
  title: string;
  onCancel: () => void;
  model?: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const words = (text: string) => providerWording(text, job.answer?.model ?? job.sections?.model ?? model);
  const stage =
    job.phase === "saving" ? (job.kind === "study-aid" ? "Saving your guide…" : "Saving") : job.stage ? STAGE_WORDS[job.stage] : "Getting the document ready";
  const retrying = job.attempt !== undefined && job.attempt > 1;
  const elapsed = job.startedAt !== undefined ? elapsedWords(now - job.startedAt) : "";
  return (
    <div className="ai-working">
      <span className="ai-working__dot" aria-hidden="true" />
      <div className="stack stack--2">
        <p className="small strong">{words(title)}</p>
        <p className="tiny">
          <span role="status" aria-live="polite">
            {job.cancelRequested ? "Cancelling…" : retrying && job.phase !== "saving" ? words("Gemini is busy — trying again") : words(stage)}
          </span>
          {elapsed ? <><span aria-hidden="true"> · </span><span className="dim">{elapsed}</span></> : null}
        </p>
        {job.stage === "uploading" && !job.cancelRequested && job.startedAt !== undefined && now - job.startedAt >= 1000 ? (
          <p className="tiny dim">Your PDF is still uploading. A slower connection can take a little longer.</p>
        ) : null}
        {job.sectionGuide && job.sections && job.sections.total > 0 ? (
          <p className="tiny" role="status">{job.sections.ready} of {job.sections.total} {job.sections.total === 1 ? "section" : "sections"} ready</p>
        ) : null}
        {job.sectionGuide && job.sections?.heading && !/files\/|https?:\/\//i.test(job.sections.heading) ? <p className="tiny dim">{job.sections.heading}</p> : null}
        {job.progress && job.phase !== "saving" && !job.cancelRequested ? <p className="tiny dim">{words(job.progress)}</p> : null}
        {job.sectionGuide && job.stage === "generating" && !job.cancelRequested && now - (job.stageSince ?? job.startedAt ?? now) >= 60_000 ? (
          <p className="tiny dim">{words("Taking longer than usual. Gemini can take a few minutes on a long PDF. Cancel keeps any finished part.")}</p>
        ) : null}
        {job.cancelError ? (
          <p className="field__error" role="alert">
            {words(job.cancelError)}
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
