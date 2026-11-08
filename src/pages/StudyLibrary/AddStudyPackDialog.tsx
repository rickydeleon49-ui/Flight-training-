import { useEffect, useRef, useState } from "react";

import { Button, Dialog } from "@/components/ui";
import {
  ackStudyPackResult,
  addStudyPack,
  chooseStudyPack,
  inspectStudyPack,
  studyPackErrorMessage,
  studyPackResult,
  type StudyPackPreview,
  type StudyPackResult,
} from "@/data/studyPack";
import { newId } from "@/lib/id";
import { packAlreadyHaveLine, packContentsLine, resultLines } from "@/logic/studyPackText";
import { useAppData } from "@/state/AppDataContext";

type Phase =
  | { kind: "idle" }
  | { kind: "picking" }
  | { kind: "refused"; message: string }
  | { kind: "preview"; path: string; opId: string; preview: StudyPackPreview }
  | { kind: "adding"; path: string; opId: string; preview: StudyPackPreview }
  | { kind: "failed"; path: string; opId: string; preview: StudyPackPreview; message: string }
  | { kind: "added"; result: StudyPackResult };

const CANT_ADD = "That study pack couldn't be added. Nothing was changed.";

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Add one study pack. Opening asks for a file; the dialog shows only counts.
 * One button, "Add". Nothing about her own work is ever changed. Any refusal
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
      try {
        const preview = await inspectStudyPack(path);
        if (sessionRef.current === session) setPhase({ kind: "preview", path, opId: newId(), preview });
      } catch (error) {
        if (sessionRef.current === session) setPhase({ kind: "refused", message: studyPackErrorMessage(error, "That file isn't a study pack.") });
      }
    })();
    // Only opening starts a pick.
  }, [open]);

  const finish = async (result: StudyPackResult, session: number) => {
    // Told once: the startup notice must not repeat what she just read.
    await ackStudyPackResult(result.operationId).catch(() => {});
    try {
      await refresh();
    } catch {
      /* the summary still stands; the list updates next time it loads */
    }
    if (sessionRef.current === session) setPhase({ kind: "added", result });
  };

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
      if (result === null) {
        // Unknown outcome: the receipt says whether it was added.
        const recorded = await studyPackResult(current.opId).catch(() => null);
        if (recorded) result = recorded;
      }
      if (result) await finish(result, session);
      else if (sessionRef.current === session) {
        setPhase({ ...current, kind: "failed", message: studyPackErrorMessage(failure, CANT_ADD) });
      }
    } finally {
      addingRef.current = false;
    }
  };

  const adding = phase.kind === "adding";
  const visible = open && phase.kind !== "idle" && phase.kind !== "picking";
  const withPreview = phase.kind === "preview" || phase.kind === "adding" || phase.kind === "failed" ? phase : null;

  const footer = withPreview ? (
    <>
      <Button onClick={onClose} disabled={adding}>Cancel</Button>
      <Button variant="primary" disabled={adding} onClick={() => void add(withPreview)}>
        {adding ? "Adding…" : phase.kind === "failed" ? "Try again" : "Add"}
      </Button>
    </>
  ) : (
    <Button onClick={onClose}>{phase.kind === "added" ? "Done" : "Close"}</Button>
  );

  const title = withPreview ? "Add study pack" : phase.kind === "added" ? "Study pack added" : "This study pack can't be added";

  return (
    <Dialog open={visible} onClose={onClose} dismissible={!adding} title={title} footer={footer}>
      {phase.kind === "refused" ? <p className="small" role="alert">{phase.message}</p> : null}

      {withPreview ? (
        <div className="stack stack--3">
          <p className="small">{packContentsLine(withPreview.preview) || "This study pack has nothing new in it."}</p>
          {packAlreadyHaveLine(withPreview.preview) ? <p className="small">{packAlreadyHaveLine(withPreview.preview)}</p> : null}
          <p className="tiny dim">Your own work won't be changed.</p>
          {phase.kind === "failed" ? <p className="field__error" role="alert">{phase.message}</p> : null}
        </div>
      ) : null}

      {phase.kind === "added" ? (
        <div className="stack stack--2" role="status">
          {resultLines(phase.result).map((line) => <p className="small" key={line}>{line}</p>)}
        </div>
      ) : null}
    </Dialog>
  );
}
