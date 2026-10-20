import { useEffect, useRef, useState } from "react";

import { Button, Checkbox, Dialog } from "@/components/ui";
import type { StoredSetRow } from "@/data/studySetTransaction";
import { newId } from "@/lib/id";
import { resolveRegeneration, StudyAuthoringError, type AuthoringState, type PreviewChoice, type PreviewItem } from "@/logic/studyAuthoring";
import {
  authoringStateOf,
  mergeRegeneration,
  nextSetOf,
  regenerationPreview,
  type RegenerationMode,
} from "@/logic/studySetEditing";
import type { GeneratedStudyAid } from "@/services/gemini";
import { useAppData } from "@/state/AppDataContext";
import type { GeminiJob, ReviewedRegeneration } from "@/state/GeminiJobs";

const describe = (entry: PreviewItem) =>
  entry.item.kind === "summary" ? "Summary" : entry.item.kind === "section" ? `Section: ${entry.item.fields[0]}` : `Card: ${entry.item.fields[0]}`;

const resembles = (entry: PreviewItem) =>
  entry.match?.reason === "deleted" ? "something you deleted" : "something you corrected or rewrote";

/**
 * Before a regenerated study guide replaces one holding her own items
 * (OFFLINE-03a §2.4): new items that repeat what she deleted or corrected are
 * left out unless she brings them back; near-repeats wait for her choice;
 * her own items are kept by default. Cancel writes nothing.
 */
export function RegenerationReviewDialog({
  job,
  materialId,
  onClose,
  onSave,
}: {
  job: GeminiJob;
  materialId: string;
  onClose: () => void;
  /** True once saved; on false the dialog stays open with her choices. */
  onSave: (reviewed: ReviewedRegeneration) => Promise<boolean>;
}) {
  const { repositories } = useAppData();
  const answer = job.answer as GeneratedStudyAid;
  const [opened, setOpened] = useState<{ stored: StoredSetRow; state: AuthoringState } | null>(null);
  const [preview, setPreview] = useState<readonly PreviewItem[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [mode, setMode] = useState<RegenerationMode>("keep");
  const [keepMySummary, setKeepMySummary] = useState(true);
  const [choices, setChoices] = useState<Map<string, PreviewChoice>>(new Map());
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  // One operation per set of choices, so saving again after an uncertain
  // failure can't apply it twice.
  const operationRef = useRef<{ key: string; id: string } | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const read = await repositories?.documents.readStudySetForEdit(materialId);
        if (!read) throw new Error("missing");
        const state = authoringStateOf(read.set);
        const classified = await regenerationPreview(state, answer);
        if (!live) return;
        setOpened({ stored: read.stored, state });
        setPreview(classified);
      } catch (failure) {
        if (!live) return;
        setProblem(
          failure instanceof StudyAuthoringError
            ? "Part of your saved study guide is damaged, so it can't be merged with the new one. Nothing has been changed."
            : "Your saved study guide couldn't be read. Nothing has been changed; try again.",
        );
      }
    })();
    return () => {
      live = false;
    };
  }, [repositories, materialId, answer]);

  const choose = (id: string, choice: PreviewChoice | undefined) =>
    setChoices((before) => {
      const next = new Map(before);
      if (choice) next.set(id, choice);
      else next.delete(id);
      return next;
    });

  const unresolved = preview?.filter((entry) => entry.status === "unresolved" && !choices.has(entry.item.itemId)) ?? [];
  const mine = opened?.state.items.filter((item) => item.origin !== undefined && item.kind !== "summary") ?? [];
  const mySummary = opened?.state.items.find((item) => item.kind === "summary" && item.origin !== undefined);

  const save = async () => {
    if (!preview || !opened || busyRef.current || unresolved.length > 0) return;
    busyRef.current = true;
    setBusy(true);
    setProblem(null);
    try {
      const resolved = resolveRegeneration(preview, choices);
      const merged = mergeRegeneration(opened.state, resolved, mode, keepMySummary);
      const next = nextSetOf({ title: answer.title, sourceNotes: answer.sourceNotes, provider: "gemini", model: answer.model }, merged);
      const key = JSON.stringify(next);
      let reviewed: ReviewedRegeneration;
      if (job.reviewed && JSON.stringify(job.reviewed.next) === key) {
        // The same choices as a save that failed, perhaps after committing:
        // resend exactly that operation so it is recognised, not repeated.
        reviewed = job.reviewed;
      } else {
        if (operationRef.current?.key !== key) operationRef.current = { key, id: newId() };
        reviewed = { operationId: operationRef.current.id, expected: opened.stored, next };
      }
      if (!(await onSave(reviewed))) {
        setProblem("The reviewed study guide wasn't saved. Your choices are still here; try saving again.");
      }
    } catch (failure) {
      setProblem(
        failure instanceof StudyAuthoringError
          ? failure.message
          : "The reviewed study guide couldn't be saved. Nothing has been changed.",
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const group = (status: PreviewItem["status"]) => preview?.filter((entry) => entry.status === status) ?? [];

  return (
    <Dialog
      open
      onClose={() => {
        if (!busyRef.current) onClose();
      }}
      title="Review the new study guide"
      description="Your study guide has items you wrote, corrected or deleted. Choose what to keep; nothing is saved until you do."
      dismissible={!busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()} disabled={busy || !preview || unresolved.length > 0}>
            {busy ? "Saving…" : unresolved.length > 0 ? `Choose for ${unresolved.length} more` : "Save the reviewed study guide"}
          </Button>
        </>
      }
    >
      <div className="stack stack--3">
        {problem ? <p className="field__error" role="alert">{problem}</p> : null}
        {!preview && !problem ? <p className="tiny dim" role="status">Comparing with your study guide…</p> : null}
        {preview ? (
          <>
            <fieldset className="stack stack--2">
              <legend className="small"><strong>Your own items</strong></legend>
              <label className="row">
                <input type="radio" name="regeneration-mode" checked={mode === "keep"} onChange={() => setMode("keep")} />
                <span className="small">Keep my items ({mine.length}{mySummary ? " and my summary" : ""}) and add the new ones</span>
              </label>
              <label className="row">
                <input type="radio" name="regeneration-mode" checked={mode === "replace"} onChange={() => setMode("replace")} />
                <span className="small">Replace everything with the new study guide</span>
              </label>
              <p className="tiny muted">Either way, what you have now is kept in Previous versions.</p>
              {mode === "keep" && mySummary ? (
                <Checkbox checked={keepMySummary} onChange={setKeepMySummary} label="Keep my summary instead of the new one" />
              ) : null}
            </fieldset>

            <p className="tiny">
              Items worded differently from something you deleted or corrected can't always be recognised. Check the new items.
            </p>

            {group("unresolved").length > 0 ? (
              <section className="stack stack--2" aria-label="Needs your choice">
                <p className="small"><strong>Needs your choice</strong></p>
                {group("unresolved").map((entry) => (
                  <div className="stack stack--1" key={entry.item.itemId}>
                    <p className="small wrap-anywhere">{describe(entry)}</p>
                    <p className="tiny muted">This looks like {resembles(entry)}.</p>
                    <div className="row row--wrap">
                      <label className="row">
                        <input type="radio" name={`choice-${entry.item.itemId}`} checked={choices.get(entry.item.itemId) === "omit"} onChange={() => choose(entry.item.itemId, "omit")} />
                        <span className="small">Leave it out</span>
                      </label>
                      <label className="row">
                        <input type="radio" name={`choice-${entry.item.itemId}`} checked={choices.get(entry.item.itemId) === "keep"} onChange={() => choose(entry.item.itemId, "keep")} />
                        <span className="small">Keep it</span>
                      </label>
                    </div>
                  </div>
                ))}
              </section>
            ) : null}

            {group("held").length > 0 ? (
              <section className="stack stack--2" aria-label="Left out">
                <p className="small"><strong>Left out: matches something you deleted or corrected</strong></p>
                {group("held").map((entry) => (
                  <Checkbox
                    key={entry.item.itemId}
                    checked={choices.get(entry.item.itemId) === "keep"}
                    onChange={(checked) => choose(entry.item.itemId, checked ? "keep" : undefined)}
                    label={`Bring it back: ${describe(entry)}`}
                  />
                ))}
              </section>
            ) : null}

            <section className="stack stack--1" aria-label="New">
              <p className="small"><strong>New ({group("new").length})</strong></p>
              {group("new").map((entry) => (
                <p className="tiny wrap-anywhere" key={entry.item.itemId}>{describe(entry)}</p>
              ))}
            </section>
          </>
        ) : null}
      </div>
    </Dialog>
  );
}
