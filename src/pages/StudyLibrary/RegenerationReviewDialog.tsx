import { useEffect, useRef, useState } from "react";

import { Button, Checkbox, Dialog } from "@/components/ui";
import { holds, type StoredSetRow } from "@/data/studySetTransaction";
import { newId } from "@/lib/id";
import { resolveRegeneration, StudyAuthoringError, type AuthoringState, type PreviewChoice, type PreviewItem } from "@/logic/studyAuthoring";
import {
  authoringStateOf,
  mergeRegeneration,
  nextSetOf,
  regenerationPreview,
  retiredWording,
  retiredWordingIndex,
  type ItemText,
  type RegenerationMode,
} from "@/logic/studySetEditing";
import { storedStudySet } from "@/data/repositories/documentRepository";
import type { GeneratedStudyAid } from "@/services/gemini";
import { useAppData } from "@/state/AppDataContext";
import { reviewedSaveOf, type ReviewedRegeneration } from "@/state/reviewedSaveCheckpoint";
import type { GeminiJob } from "@/state/GeminiJobs";

const describe = (entry: PreviewItem) =>
  entry.item.kind === "summary" ? "Summary" : entry.item.kind === "section" ? `Section: ${entry.item.fields[0]}` : `Card: ${entry.item.fields[0]}`;

/** An item's full text, so she can judge it before keeping or leaving it out. */
function ItemContent({ kind, fields }: { kind: PreviewItem["item"]["kind"]; fields: readonly string[] }) {
  if (kind === "summary") return <p className="tiny wrap-anywhere ai-copy">{fields[0]}</p>;
  return (
    <div className="stack stack--1">
      <p className="tiny wrap-anywhere">
        <strong>{kind === "card" ? "Question: " : ""}{fields[0]}</strong>
      </p>
      <p className="tiny wrap-anywhere ai-copy">{kind === "card" ? `Answer: ${fields[1]}` : fields[1]}</p>
    </div>
  );
}

/** What a held or near-matching item resembles, from Previous versions when available. */
function Resembles({ entry, wording }: { entry: PreviewItem; wording: ReadonlyMap<string, ItemText> }) {
  const earlier = retiredWording(wording, entry.match);
  return (
    <div className="stack stack--1" style={{ paddingLeft: "var(--space-3)" }}>
      <p className="tiny muted">It looks like {resembles(entry)}:</p>
      {earlier ? (
        <ItemContent kind={entry.item.kind} fields={earlier} />
      ) : (
        <p className="tiny muted">That earlier wording is no longer in Previous versions.</p>
      )}
    </div>
  );
}

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
  // Earlier wording behind each retirement fingerprint, from Previous versions.
  const [wording, setWording] = useState<ReadonlyMap<string, ItemText>>(new Map());
  const [problem, setProblem] = useState<string | null>(null);
  const [mode, setMode] = useState<RegenerationMode>("keep");
  const [keepMySummary, setKeepMySummary] = useState(true);
  const [choices, setChoices] = useState<Map<string, PreviewChoice>>(new Map());
  const [busy, setBusy] = useState(false);
  // Confirming that an earlier reviewed save already committed.
  const [settling, setSettling] = useState(false);
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
        // Her last reviewed save has not been acknowledged by the journal, in
        // this session or before a restart. If its content is what is stored
        // now, it did commit: resend exactly that operation, which is
        // recognised as already saved, instead of reviewing (and saving) again.
        const pending = job.reviewed ?? reviewedSaveOf(job.jobId);
        if (pending && holds(read.stored, pending.next)) {
          if (live) setSettling(true);
          const saved = await onSave(pending);
          if (live && !saved) {
            setSettling(false);
            setProblem("Your reviewed study guide may already be saved, but this couldn't be confirmed. Close this and try again.");
          }
          return;
        }
        const state = authoringStateOf(read.set);
        const classified = await regenerationPreview(state, answer);
        let earlier: ReadonlyMap<string, ItemText> = new Map();
        try {
          const entries = await repositories!.documents.listStudySetHistory(materialId);
          earlier = await retiredWordingIndex(
            entries.flatMap((entry) => (entry.previous ? [storedStudySet(materialId, entry.previous)] : [])),
          );
        } catch {
          // Without history the review still works; it says the wording isn't available.
        }
        if (!live) return;
        setWording(earlier);
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
      // Within this review, the same choices reuse one operation, so saving
      // again after an unanswered save is recognised rather than repeated. A
      // save that committed before a reopen is caught when the review opens.
      const key = JSON.stringify(next);
      if (operationRef.current?.key !== key) operationRef.current = { key, id: newId() };
      const reviewed: ReviewedRegeneration = { operationId: operationRef.current.id, expected: opened.stored, next };
      const saved = await onSave(reviewed);
      // A save that returned true is not finished business: the journal still
      // holds the answer until it acknowledges it, and only that removes the
      // checkpoint. So nothing is cleared here, whatever the save reported.
      if (!saved) {
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
        {!preview && !problem ? (
          <p className="tiny dim" role="status">
            {settling ? "Checking whether your reviewed study guide was saved…" : "Comparing with your study guide…"}
          </p>
        ) : null}
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
                    <ItemContent kind={entry.item.kind} fields={entry.item.fields} />
                    <Resembles entry={entry} wording={wording} />
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
                  <div className="stack stack--1" key={entry.item.itemId}>
                    <Checkbox
                      checked={choices.get(entry.item.itemId) === "keep"}
                      onChange={(checked) => choose(entry.item.itemId, checked ? "keep" : undefined)}
                      label={`Bring it back: ${describe(entry)}`}
                    />
                    <ItemContent kind={entry.item.kind} fields={entry.item.fields} />
                  </div>
                ))}
              </section>
            ) : null}

            <section className="stack stack--1" aria-label="New">
              <p className="small"><strong>New ({group("new").length})</strong></p>
              {group("new").map((entry) => (
                <div className="stack stack--1" key={entry.item.itemId}>
                  {entry.item.kind === "summary" ? <p className="tiny"><strong>Summary</strong></p> : null}
                  <ItemContent kind={entry.item.kind} fields={entry.item.fields} />
                </div>
              ))}
            </section>
          </>
        ) : null}
      </div>
    </Dialog>
  );
}
