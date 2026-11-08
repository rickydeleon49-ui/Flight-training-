import { useEffect, useRef, useState } from "react";

import { Button, Dialog } from "@/components/ui";
import {
  ackStudyPackResult,
  addStudyPack,
  chooseStudyPack,
  isDefiniteRefusal,
  inspectStudyPack,
  studyPackErrorMessage,
  studyPackResult,
  type StudyPackPreview,
  type StudyPackResult,
} from "@/data/studyPack";
import { newId } from "@/lib/id";
import { ALREADY_TITLE, namedItemLines, WAIT_LINE, packAlreadyHaveLine, packContentsLine, resultLines } from "@/logic/studyPackText";
import { useAppData } from "@/state/AppDataContext";
import { DISCLAIMER_LINE } from "@/logic/legal";

type Phase =
  | { kind: "idle" }
  | { kind: "picking" }
  | { kind: "previewing" }
  | { kind: "refused"; message: string }
  | { kind: "preview"; path: string; opId: string; preview: StudyPackPreview }
  | { kind: "adding"; path: string; opId: string; preview: StudyPackPreview }
  | { kind: "failed"; path: string; opId: string; preview: StudyPackPreview; message: string }
  | { kind: "added"; result: StudyPackResult };

const UNKNOWN = "We couldn't tell if your study pack was added. Try again to check. It won't be added twice.";
const CANT_ADD = "That study pack couldn't be added. Nothing was changed.";

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Add one study pack. Opening asks for a file; the dialog shows only counts.
 * One button, "Add". Nothing about your own work is ever changed. Any refusal
 * is one plain sentence. The operation id is minted once per preview, so
 * "Try again" (or an unknown answer) can never add the pack twice.
 */
export function AddStudyPackDialog({ open, onClose }: Props) {
  const { refresh } = useAppData();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const addingRef = useRef(false);
  const sessionRef = useRef(0);

  useEffect(() => {
    if (!open) {
      sessionRef.current += 1;
      addingRef.current = false;
      setPhase({ kind: "idle" });
      return;
    }
    const session = ++sessionRef.current;
    setPhase({ kind: "picking" });
    void (async () => {
      let path: string | null;
      try {
        path = await chooseStudyPack();
      } catch (error) {
        if (sessionRef.current === session) setPhase({ kind: "refused", message: studyPackErrorMessage(error, "The study pack could not be opened.") });
        return;
      }
      if (sessionRef.current !== session) return;
      if (path === null) {
        onClose();
        return;
      }
      setPhase({ kind: "previewing" });
      try {
        const preview = await inspectStudyPack(path);
        if (sessionRef.current === session) setPhase({ kind: "preview", path, opId: newId(), preview });
      } catch (error) {
        if (sessionRef.current === session) setPhase({ kind: "refused", message: studyPackErrorMessage(error, "That file isn't a study pack.") });
      }
    })();
    // Only opening starts a pick.
  }, [open]);

  // Leaving the page ends any pending "show the summary" step.
  useEffect(() => () => { sessionRef.current += 1; }, []);

  const finish = async (result: StudyPackResult, session: number) => {
    try {
      await refresh();
    } catch {
      /* the summary still stands; the list updates next time it loads */
    }
    // If the dialog went away first, the result stays pending and the startup
    // notice shows it. It is marked told only after the summary is on screen
    // (see the effect below).
    if (sessionRef.current !== session) return;
    setPhase({ kind: "added", result });
  };

  const toldRef = useRef(new Set<string>());
  const shownResult = phase.kind === "added" ? phase.result : null;
  useEffect(() => {
    if (!shownResult || toldRef.current.has(shownResult.operationId)) return;
    toldRef.current.add(shownResult.operationId);
    // If this fails the result stays pending and may show once more: safer than losing it.
    void ackStudyPackResult(shownResult.operationId).catch((error) => console.warn("study pack result not marked told", error));
  }, [shownResult]);

  const add = async (current: { path: string; opId: string; preview: StudyPackPreview }) => {
    current = { path: current.path, opId: current.opId, preview: current.preview };
    if (addingRef.current) return;
    addingRef.current = true;
    const session = sessionRef.current;
    setPhase({ ...current, kind: "adding" });
    try {
      let result: StudyPackResult | null = null;
      let failure: unknown = null;
      try {
        result = await addStudyPack(current.opId, current.path);
      } catch (error) {
        failure = error;
      }
      // Only a refusal the app marked is definite. Anything else
      // (a lost connection, an unknown error) leaves the outcome unknown.
      const definite = isDefiniteRefusal(failure);
      if (result === null) {
        // The receipt says whether it was added.
        try {
          const recorded = await studyPackResult(current.opId);
          if (recorded) result = recorded;
        } catch {
          /* unknown outcome; handled below */
        }
      }
      if (result) await finish(result, session);
      else if (sessionRef.current === session) {
        // Same opId on retry, so a pack that did go in comes back as its receipt.
        setPhase({ ...current, kind: "failed", message: definite ? studyPackErrorMessage(failure, CANT_ADD) : UNKNOWN });
      }
    } finally {
      addingRef.current = false;
    }
  };

  const adding = phase.kind === "adding";
  const previewing = phase.kind === "previewing";
  const visible = open && phase.kind !== "idle" && phase.kind !== "picking";
  const withPreview = phase.kind === "preview" || phase.kind === "adding" || phase.kind === "failed" ? phase : null;

  const nothingNew = withPreview?.preview.nothingNew === true && phase.kind === "preview";
  const footer = previewing ? (
    <Button disabled>Cancel</Button>
  ) : withPreview && nothingNew ? (
    <Button onClick={onClose}>Close</Button>
  ) : withPreview ? (
    <>
      <Button onClick={onClose} disabled={adding}>Cancel</Button>
      <Button variant="primary" disabled={adding} onClick={() => void add(withPreview)}>
        {adding ? "Adding…" : phase.kind === "failed" ? "Try again" : "Add"}
      </Button>
    </>
  ) : (
    <Button onClick={onClose}>{phase.kind === "added" ? "Done" : "Close"}</Button>
  );

  const title = withPreview
    ? (withPreview.preview.nothingNew ? ALREADY_TITLE : "Add study pack")
    : previewing
      ? "Add study pack"
      : phase.kind === "added"
      ? (phase.result.added === 0 ? ALREADY_TITLE : "Study pack added")
      : "This study pack can't be added";
  const previewNamed = withPreview ? namedItemLines(withPreview.preview.skippedItems) : [];
  const previewLabelled = withPreview ? namedItemLines(withPreview.preview.labelledItems) : [];

  return (
    <Dialog open={visible} onClose={onClose} dismissible={!adding} title={title} footer={footer}>
      {previewing ? <p className="small" role="status">{WAIT_LINE}</p> : null}
      {phase.kind === "refused" ? <p className="small" role="alert">{phase.message}</p> : null}

      {withPreview ? (
        <div className="stack stack--3">
          <p className="small">{packContentsLine(withPreview.preview) || "This study pack has nothing new in it."}</p>
          {packAlreadyHaveLine(withPreview.preview) ? <p className="small">{packAlreadyHaveLine(withPreview.preview)}</p> : null}
          {previewLabelled.length > 0 ? (
            <ul className="tiny" aria-label="Added with a label">
              {previewLabelled.map((line, i) => <li key={i}>{line}</li>)}
            </ul>
          ) : null}
          {previewNamed.length > 0 ? (
            <ul className="tiny" aria-label="Not added">
              {previewNamed.map((line, i) => <li key={i}>{line}</li>)}
            </ul>
          ) : null}
          {adding ? <p className="small" role="status">{WAIT_LINE}</p> : null}
          <p className="tiny dim">Your own work won't be changed.</p>
          <p className="tiny dim">{DISCLAIMER_LINE}</p>
          {phase.kind === "failed" ? <p className="field__error" role="alert">{phase.message}</p> : null}
        </div>
      ) : null}

      {phase.kind === "added" ? (
        <div className="stack stack--2" role="status">
          {resultLines(phase.result).map((line, i) => <p className="small" key={i}>{line}</p>)}
        </div>
      ) : null}
    </Dialog>
  );
}
