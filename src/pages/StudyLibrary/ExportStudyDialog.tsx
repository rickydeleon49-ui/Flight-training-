import { pdfLabelState, PDF_KIT_REMINDER } from "@/logic/pdfKitLabels";
/**
 * Share or print one material's study aid (P54-04).
 *
 * She picks which parts to include (guide, flashcards, practice questions)
 * and one of two outputs:
 * - a study packet (.json) that any copy of Her Flight Deck can import as a
 *   new material, checked by the import's own validator before it is saved;
 * - a printable handout (.html) to open in a browser and print, with an
 *   optional answer key on its own page.
 *
 * Nothing in her library changes. Only this material's chosen study content
 * is written; practice history, other materials and settings never are.
 */
import { useEffect, useId, useRef, useState } from "react";

import { Button, Dialog } from "@/components/ui";
import {
  exportFileName,
  exportSourceFor,
  exportStudyPacket,
  exportableParts,
  hasHandwrittenItems,
  hasInstructorCorrections,
  type ExportSelection,
  type ExportSource,
} from "@/logic/studyExport";
import { buildHandoutHtml } from "@/logic/studyHandout";
import { buildMarkdownBundle } from "@/logic/studyMarkdown";
import { hasCredentialLikeText } from "@/logic/studyPacket/semantic";
import { DesktopOnlyError } from "@/services/documents";
import { saveStudyExport, StudyExportError } from "@/services/studyExport";

type Output = "packet" | "handout" | "markdown";

interface Props {
  open: boolean;
  source: ExportSource;
  onClose: () => void;
}

export const EXPORT_DESKTOP_ONLY = "Saving a file needs the desktop application.";

export function ExportStudyDialog({ open, source, onClose }: Props) {
  const ids = useId();
  // Off by default: her instructor's corrections are included only deliberately.
  const [selection, setSelection] = useState<ExportSelection>(() => ({ ...exportableParts(exportSourceFor(source, {})), instructorCorrections: false }));
  const effective = exportSourceFor(source, selection);
  const available = exportableParts(effective);
  const [output, setOutput] = useState<Output>("handout");
  const [answerKey, setAnswerKey] = useState(true);
  const [working, setWorking] = useState(false);
  const busy = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelection({ ...exportableParts(exportSourceFor(source, {})), instructorCorrections: false });
    setError(null);
    setSaved(null);
    // Reset only when the dialog opens; the source is read again at save time.
  }, [open]);

  const chosen = (selection.guide && available.guide) || (selection.flashcards && available.flashcards) || (selection.questions && available.questions);
  const set = effective.studySet;
  const corrections = hasInstructorCorrections(source.studySet, source.practiceTest);
  const handwritten = hasHandwrittenItems(source.studySet, source.practiceTest);
  const questionCount = effective.practiceTest?.questions.length ?? 0;

  const save = async () => {
    // State disables the controls on render; this lock also covers two events
    // delivered before that render commits. One intent opens one native dialog.
    if (busy.current) return;
    busy.current = true;
    setWorking(true);
    setError(null);
    setSaved(null);
    try {
      const now = new Date();
      let contents: string;
      let suggested: string;
      if (output === "packet") {
        const packet = exportStudyPacket(source, selection, now);
        if (!packet.ok) {
          setError(packet.message);
          return;
        }
        contents = packet.text;
        suggested = packet.fileName;
      } else if (output === "markdown") {
        const entries = buildMarkdownBundle(source, selection);
        if (entries.some((entry) => hasCredentialLikeText(entry.text))) {
          setError("This study aid contains text that looks like a password or access key, so it wasn't exported. Remove it from the study aid first.");
          return;
        }
        contents = JSON.stringify(entries);
        suggested = exportFileName(source.material.title, "zip");
      } else {
        contents = buildHandoutHtml(source, selection, { answerKey }, now);
        suggested = exportFileName(source.material.title, "html");
      }
      const result = await saveStudyExport(output, suggested, contents);
      if (result) setSaved(`Saved “${result.fileName}”.`);
    } catch (caught) {
      if (caught instanceof DesktopOnlyError) setError(EXPORT_DESKTOP_ONLY);
      else if (caught instanceof StudyExportError) setError(caught.message);
      else setError("The file could not be saved. Nothing was changed.");
    } finally {
      busy.current = false;
      setWorking(false);
    }
  };

  const toggle = (part: keyof ExportSelection) => (checked: boolean) => setSelection((current) => ({ ...current, [part]: checked }));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!working}
      title="Share or print"
      description="Save this study aid as a file. Nothing in your library changes."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={working}>
            {saved ? "Done" : "Cancel"}
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={working || !chosen}>
            {working ? "Saving…" : "Save…"}
          </Button>
        </>
      }
    >
      <div className="stack stack--4">
        <p className="small">Picture cards are omitted from study packets, CSV and handouts. Use a complete backup to keep pictures, covers and review history.</p>
        <fieldset className="export-study__choices" disabled={working}>
          <legend className="field__label">Include</legend>
          {available.guide ? (
            <Choice checked={selection.guide} onChange={toggle("guide")} label="Study guide" detail={plural(set?.sections.length ?? 0, "section")} />
          ) : null}
          {available.flashcards ? (
            <Choice checked={selection.flashcards} onChange={toggle("flashcards")} label="Flashcards" detail={plural(set?.flashcards.length ?? 0, "card")} />
          ) : null}
          {available.questions ? (
            <Choice checked={selection.questions} onChange={toggle("questions")} label="Practice questions" detail={plural(questionCount, "question")} />
          ) : null}
          {corrections ? (
            <Choice
              checked={Boolean(selection.instructorCorrections)}
              onChange={(checked) =>
                setSelection((current) => {
                  const next = { ...current, instructorCorrections: checked };
                  const parts = exportableParts(exportSourceFor(source, next));
                  // A part that only had corrections in it is chosen once it has content.
                  return { ...next, guide: current.guide || (checked && parts.guide), flashcards: current.flashcards || (checked && parts.flashcards), questions: current.questions || (checked && parts.questions) };
                })
              }
              label="Include my instructor's corrections"
              detail="Left out unless you include them"
            />
          ) : null}
        </fieldset>

        <fieldset className="export-study__choices" disabled={working}>
          <legend className="field__label">Save as</legend>
          <label className="small">
            <input type="radio" name={`${ids}-output`} checked={output === "handout"} onChange={() => setOutput("handout")} /> Printable handout
            (.html): open it in a browser to print or save as PDF
          </label>
          <label className="small">
            <input type="radio" name={`${ids}-output`} checked={output === "packet"} onChange={() => setOutput("packet")} /> Study packet (.json):
            to import into Her Flight Deck on another computer
          </label>
          <label className="small">
            <input type="radio" name={`${ids}-output`} checked={output === "markdown"} onChange={() => setOutput("markdown")} /> Markdown bundle (.zip):
            notes for Obsidian or another notes app
          </label>
        </fieldset>

        {output === "handout" && selection.questions && available.questions ? (
          <Choice
            checked={answerKey}
            onChange={setAnswerKey}
            disabled={working}
            label="Add an answer key at the end"
            detail="On its own page, so you can quiz yourself first."
          />
        ) : null}
        {output === "packet" ? (
          <p className="tiny dim">Page links and per-item ‘edited by’ details don't travel in a study packet.</p>
        ) : null}
        {output === "packet" && handwritten ? (
          <p className="tiny dim">
            Study packets don't record who wrote each item. When imported, everything shows as imported.
          </p>
        ) : null}
        {output === "packet" && selection.questions && available.questions ? (
          <p className="tiny dim">A study packet always includes the answers, so it can be practiced after importing.</p>
        ) : null}
        {output === "markdown" && selection.questions && available.questions ? (
          <p className="tiny dim">The practice note includes each answer and explanation.</p>
        ) : null}
        {output === "markdown" ? (
          <p className="tiny dim">The bundle is limited to 8 MiB of notes and a 4 MiB ZIP. Original files and personal notes are not included.</p>
        ) : null}

        <p className="tiny dim">
          {pdfLabelState(source.studySet) || pdfLabelState(source.practiceTest) ? PDF_KIT_REMINDER : "The file says where this content came from. AI-generated and imported content is still a study aid: check it against current FAA material and your instructor."}
        </p>

        {error ? (
          <p className="field__error" role="alert">
            {error}
          </p>
        ) : null}
        {saved ? (
          <p className="small" role="status">
            {saved}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** A plain choice; the shared Checkbox strikes through its label, which reads as "done". */
function Choice({ checked, onChange, label, detail, disabled = false }: { checked: boolean; onChange: (checked: boolean) => void; label: string; detail: string; disabled?: boolean }) {
  return (
    <label className="small export-study__option">
      <input type="checkbox" disabled={disabled} checked={checked} onChange={(event) => onChange(event.target.checked)} /> {label}{" "}
      <span className="tiny dim">· {detail}</span>
    </label>
  );
}
