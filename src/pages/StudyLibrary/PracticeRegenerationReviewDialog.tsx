import { useEffect, useRef, useState } from "react";

import { Button, Checkbox, Dialog } from "@/components/ui";
import type { PracticeAuthoringQuestion, PracticeSnapshot } from "@/domain/types";
import { canonicalJson } from "@/data/practiceSessionTransaction";
import { practiceContentHash, practiceRetirementRecord } from "@/data/practiceAuthoring";
import { PracticeAuthoringError, PRACTICE_AUTHORING_ERROR_MESSAGES } from "@/data/persistenceErrors";
import { buildPracticeRegenerationOperation, mergePracticeRegeneration, practiceRegenerationPreview, resolvePracticeRegeneration, type PracticePreviewItem } from "@/logic/practiceRegeneration";
import type { PreviewChoice } from "@/logic/studyAuthoring";
import type { GeneratedPracticeTest } from "@/services/gemini";
import { useAppData } from "@/state/AppDataContext";
import type { GeminiJob } from "@/state/GeminiJobs";
import { reviewedSaveOf, type ReviewedRegeneration } from "@/state/reviewedSaveCheckpoint";

import { ChangedWords } from "./ChangedWords";

/** A question in full; with `compare`, the words that differ from the other version are highlighted. */
function QuestionContent({ question, compare, showAnswers }: { question: PracticeAuthoringQuestion; compare?: { question: PracticeAuthoringQuestion; show: "added" | "removed" }; showAnswers: boolean }) {
  const show = compare?.show ?? "added";
  const other = compare?.question;
  return <div className="stack stack--1">
    <p className="small wrap-anywhere"><strong><ChangedWords text={question.question} other={other?.question} show={show} /></strong></p>
    <ol>{question.options.map((option, index) => <li className="tiny wrap-anywhere" key={index}><ChangedWords text={option} other={other?.options[index]} show={show} /></li>)}</ol>
    {showAnswers ? <>
      <p className="tiny wrap-anywhere">Correct answer: <ChangedWords text={question.options[question.correctIndex] ?? ""} other={other ? other.options[other.correctIndex] : undefined} show={show} /></p>
      <p className="tiny wrap-anywhere">Explanation: <ChangedWords text={question.explanation} other={other?.explanation} show={show} /></p>
    </> : null}
  </div>;
}

/** Her reviewed choices stay local until Save; the provider owns the acknowledgement. */
export function PracticeRegenerationReviewDialog({ job, materialId, onClose, onSave }: {
  job: GeminiJob; materialId: string; onClose: () => void;
  onSave: (reviewed: ReviewedRegeneration) => Promise<boolean>;
}) {
  const { repositories } = useAppData();
  const answer = job.answer as GeneratedPracticeTest;
  const [current, setCurrent] = useState<PracticeSnapshot | null>(null);
  const [preview, setPreview] = useState<readonly PracticePreviewItem[] | null>(null);
  const [wording, setWording] = useState<ReadonlyMap<string, PracticeAuthoringQuestion>>(new Map());
  const [mode, setMode] = useState<"keep" | "replace">("keep");
  const [choices, setChoices] = useState<Map<string, PreviewChoice>>(new Map());
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Reading the new questions should not spoil the test, so answers start hidden.
  const [showAnswers, setShowAnswers] = useState(false);
  const [settling, setSettling] = useState(false);
  const busyRef = useRef(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const operationRef = useRef<{ key: string; reviewed: ReviewedRegeneration } | null>(null);
  const saveRef = useRef(onSave);
  saveRef.current = onSave;

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const read = await repositories?.documents.readPracticeSnapshot(materialId);
        if (!read) throw new Error("missing");
        const pending = job.reviewed ?? reviewedSaveOf(job.jobId);
        if (pending?.kind === "practice" && pending.operation.sourceMaterialId === materialId && pending.operation.next &&
            read.title === pending.operation.next.title && read.provider === pending.operation.next.provider && read.model === pending.operation.next.model &&
            await practiceContentHash(read.questions) === await practiceContentHash(pending.operation.next.questions) &&
            canonicalJson(read.retired) === canonicalJson(pending.operation.next.retired)) {
          if (!live) return;
          busyRef.current = true;
          setBusy(true);
          setSettling(true);
          try {
            const saved = await saveRef.current(pending);
            if (live && !saved) setProblem(PRACTICE_AUTHORING_ERROR_MESSAGES.IPC_TRANSPORT_ERROR);
          } finally {
            busyRef.current = false;
            if (live) setBusy(false);
          }
          return;
        }
        if (await repositories!.practiceSessions.getCurrentAttempt(materialId)) throw new PracticeAuthoringError("ATTEMPT_ACTIVE");
        const classified = await practiceRegenerationPreview(read, answer.questions);
        const earlier = new Map<string, PracticeAuthoringQuestion>();
        try {
          const history = await repositories!.documents.listPracticeHistory(materialId);
          for (const entry of history) for (const question of entry.snapshot?.questions ?? []) {
            const record = await practiceRetirementRecord(question, "deleted");
            const key = `${record.itemId}\u0000${record.textKey}`;
            if (!earlier.has(key)) earlier.set(key, question);
          }
        } catch {
          // The fingerprints still protect her questions when earlier wording is unavailable.
        }
        if (!live) return;
        setCurrent(read);
        setPreview(classified);
        setWording(earlier);
      } catch (failure) {
        if (live) setProblem(failure instanceof PracticeAuthoringError ? failure.message : "Your saved practice test couldn't be read. Nothing has been changed; try again.");
      }
    })();
    return () => { live = false; };
    // A failed save updates job.error/reviewed; it must not reset her choices.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repositories, materialId, answer]);

  const unresolved = preview?.filter((entry) => entry.status === "near" && !choices.has(entry.item.identity)).length ?? 0;
  const mine = current?.questions.filter((q) => q.origin !== undefined).length ?? 0;
  const choose = (id: string, choice: PreviewChoice | undefined) => setChoices((before) => {
    const next = new Map(before);
    if (choice) next.set(id, choice); else next.delete(id);
    return next;
  });
  const save = async () => {
    if (!current || !preview || unresolved || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setProblem(null);
    try {
      if (await repositories?.practiceSessions.getCurrentAttempt(materialId)) throw new PracticeAuthoringError("ATTEMPT_ACTIVE");
      const merged = await mergePracticeRegeneration(current, resolvePracticeRegeneration(preview, choices), mode);
      const key = canonicalJson(merged);
      if (operationRef.current?.key !== key) {
        const operationId = crypto.randomUUID();
        operationRef.current = { key, reviewed: { kind: "practice", operationId,
          operation: buildPracticeRegenerationOperation(operationId, current, merged, { ...answer, sourceMaterialId: materialId }) } };
      }
      if (!await onSave(operationRef.current.reviewed)) setProblem(PRACTICE_AUTHORING_ERROR_MESSAGES.IPC_TRANSPORT_ERROR);
    } catch (failure) {
      setProblem(failure instanceof PracticeAuthoringError ? failure.message : PRACTICE_AUTHORING_ERROR_MESSAGES.STORAGE_ERROR);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const close = () => { if (!busyRef.current) onClose(); };

  return <Dialog open onClose={close} initialFocus={() => cancelRef.current} dismissible={!busy} title="Review the new practice test"
    description="Your practice test has questions you wrote, corrected or deleted. Choose what to keep; nothing is saved until you do."
    footer={<><Button ref={cancelRef} onClick={close} disabled={busy}>Cancel</Button>
      <Button variant="primary" onClick={() => void save()} disabled={busy || !preview || unresolved > 0}>
        {busy ? "Saving…" : unresolved ? `Choose for ${unresolved} more` : "Save the reviewed practice test"}
      </Button></>}>
    <div className="stack stack--3">
      {problem ? <p className="field__error" role="alert">{job.error ?? problem}</p> : null}
      {!preview && !problem ? <p role="status" className="tiny muted">{settling ? "Checking whether your reviewed practice test was saved…" : "Comparing with your practice test…"}</p> : null}
      {preview ? <>
        <fieldset className="stack stack--2" disabled={busy}>
          <legend>Your own questions</legend>
          <label className="row"><input type="radio" name="practice-regeneration-mode" checked={mode === "keep"} onChange={() => setMode("keep")} />Keep my questions</label>
          <label className="row"><input type="radio" name="practice-regeneration-mode" checked={mode === "replace"} onChange={() => setMode("replace")} />Replace everything</label>
          {mode === "replace" ? <p className="tiny">{mine} of your questions will be removed.</p> : null}
          <p className="tiny muted">Either way, what you have now is kept in Previous versions.</p>
        </fieldset>
        <p className="tiny">Questions worded differently from something you deleted or corrected can't always be recognised. Check the new questions.</p>
        <div className="row row--wrap">
          <Button size="small" variant="secondary" onClick={() => setShowAnswers((shown) => !shown)}>{showAnswers ? "Hide answers" : "Show answers"}</Button>
        </div>
        {(["near", "held", "new"] as const).map((status) => <section key={status} className="stack stack--2" aria-label={status === "near" ? "Needs your choice" : status === "held" ? "Left out" : "New"}>
          <p className="small"><strong>{status === "near" ? "Needs your choice" : status === "held" ? "Left out: matches something you deleted or corrected" : "New"}</strong></p>
          {preview.filter((entry) => entry.status === status).map((entry) => {
            const earlier = entry.match ? wording.get(`${entry.match.itemId}\u0000${entry.match.textKey}`) : null;
            return <div key={entry.item.identity} className="stack stack--2">
              {answer.questions.find((q) => q.question === entry.item.question)?.verificationNote ? <p className="tiny muted">{answer.questions.find((q) => q.question === entry.item.question)?.verificationNote}</p> : null}
              <QuestionContent question={entry.item} compare={earlier ? { question: earlier, show: "added" } : undefined} showAnswers={showAnswers} />
              {entry.match ? <div className="stack stack--1">
                <p className="tiny muted">It looks like {entry.match.reason === "deleted" ? "something you deleted" : "something you corrected or rewrote"}:</p>
                {earlier ? <QuestionContent question={earlier} compare={{ question: entry.item, show: "removed" }} showAnswers={showAnswers} /> : <p className="tiny muted">That earlier wording is no longer in Previous versions.</p>}
              </div> : null}
              {status === "held" ? <Checkbox disabled={busy} checked={choices.get(entry.item.identity) === "keep"}
                onChange={(checked) => choose(entry.item.identity, checked ? "keep" : undefined)} label={`Bring it back: ${entry.item.question}`} /> : null}
              {status === "near" ? <fieldset disabled={busy}><legend className="tiny">Keep this similar question?</legend>
                <label><input type="radio" name={`choice-${entry.item.identity}`} checked={choices.get(entry.item.identity) === "omit"} onChange={() => choose(entry.item.identity, "omit")} />Leave it out</label>
                <label><input type="radio" name={`choice-${entry.item.identity}`} checked={choices.get(entry.item.identity) === "keep"} onChange={() => choose(entry.item.identity, "keep")} />Keep it</label>
              </fieldset> : null}
            </div>;
          })}
        </section>)}
      </> : null}
    </div>
  </Dialog>;
}
