import { useEffect, useRef, useState } from "react";

import { Button, Dialog } from "@/components/ui";
import {
  exportFileName,
  exportSourceFor,
  exportableParts,
  hasInstructorCorrections,
  type ExportSelection,
  type ExportSource,
} from "@/logic/studyExport";
import { buildMultiMaterialHandoutHtml } from "@/logic/studyHandout";
import { buildFlashcardCsv } from "@/logic/flashcardCsv";
import { DesktopOnlyError } from "@/services/documents";
import { saveStudyExport, StudyExportError } from "@/services/studyExport";

interface Props {
  open: boolean;
  sources: ExportSource[];
  onClose: () => void;
}

type SelectionState = { include: boolean; selection: ExportSelection };

function initialState(sources: ExportSource[]): SelectionState[] {
  return sources.map((source) => ({
    include: true,
    selection: { ...exportableParts(exportSourceFor(source, {})), instructorCorrections: false },
  }));
}

export function ExportCenterDialog({ open, sources, onClose }: Props) {
  const [rows, setRows] = useState<SelectionState[]>(() => initialState(sources));
  const [output, setOutput] = useState<"handout" | "csv">("handout");
  const [answerKey, setAnswerKey] = useState(true);
  const [working, setWorking] = useState(false);
  const busy = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setRows(initialState(sources));
    setOutput("handout");
    setAnswerKey(true);
    setError(null);
    setSaved(null);
  }, [open, sources]);

  const selections = sources.map((source, index) => rows[index]?.selection ?? initialState([source])[0]!.selection);
  const chosenItems = sources.flatMap((source, index) => {
    const row = rows[index];
    const selection = selections[index]!;
    const available = exportableParts(exportSourceFor(source, selection));
    const hasChosenPart = (selection.guide && available.guide) || (selection.flashcards && available.flashcards) || (selection.questions && available.questions);
    return row?.include && hasChosenPart ? [{ source, selection }] : [];
  });
  const hasQuestions = chosenItems.some(({ source, selection }) => exportableParts(exportSourceFor(source, selection)).questions && selection.questions);
  const chosenCsvItems = sources.flatMap((source, index) => {
    const row = rows[index];
    const selection = selections[index]!;
    const effective = exportSourceFor(source, selection);
    return row?.include && selection.flashcards && exportableParts(effective).flashcards ? [{ source, selection }] : [];
  });

  const save = async () => {
    if (busy.current || (output === "handout" ? chosenItems.length === 0 : chosenCsvItems.length === 0)) return;
    busy.current = true;
    setWorking(true);
    setError(null);
    setSaved(null);
    try {
      const contents = output === "csv"
        ? buildFlashcardCsv(chosenCsvItems)
        : buildMultiMaterialHandoutHtml(chosenItems, { answerKey: hasQuestions && answerKey }, new Date());
      const result = output === "csv"
        ? await saveStudyExport("csv", exportFileName("Flashcards", "csv"), contents)
        : await saveStudyExport("handout", exportFileName("Study handout", "html"), contents);
      if (result) setSaved(`Saved “${result.fileName}”.`);
    } catch (caught) {
      if (caught instanceof DesktopOnlyError) setError("Saving a file needs the desktop application.");
      else if (caught instanceof StudyExportError) setError(caught.message);
      else setError("The file could not be saved. Nothing was changed.");
    } finally {
      busy.current = false;
      setWorking(false);
    }
  };

  const updateSelection = (index: number, part: keyof ExportSelection, checked: boolean) => {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index
      ? { ...row, selection: { ...row.selection, [part]: checked } }
      : row));
  };

  const toggleCorrections = (index: number, checked: boolean) => {
    const source = sources[index];
    if (!source) return;
    setRows((current) => current.map((row, rowIndex) => {
      if (rowIndex !== index) return row;
      const selection = { ...row.selection, instructorCorrections: checked };
      const available = exportableParts(exportSourceFor(source, selection));
      return {
        ...row,
        selection: {
          ...selection,
          guide: row.selection.guide || (checked && available.guide),
          flashcards: row.selection.flashcards || (checked && available.flashcards),
          questions: row.selection.questions || (checked && available.questions),
        },
      };
    }));
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!working}
      title="Export study materials"
      description="Choose study materials to bring together in a file. Your library stays the same."
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={working}>{saved ? "Done" : "Cancel"}</Button>
          <Button variant="primary" onClick={() => void save()} disabled={working || (output === "handout" ? chosenItems.length === 0 : chosenCsvItems.length === 0)}>
            {working ? "Saving…" : output === "csv" ? "Save CSV…" : "Save handout…"}
          </Button>
        </>
      )}
    >
      <div className="stack stack--4">
        <p className="small">Picture cards are omitted from study packets, CSV and handouts. Use a complete backup to keep pictures, covers and review history.</p>
        <fieldset className="export-study__choices" disabled={working}>
          <legend className="field__label">Save as</legend>
          <label className="small"><input type="radio" name="export-center-output" checked={output === "handout"} onChange={() => setOutput("handout")} /> Printable handout</label>
          <label className="small"><input type="radio" name="export-center-output" checked={output === "csv"} onChange={() => setOutput("csv")} /> Flashcard CSV (.csv)</label>
          {output === "csv" ? <p className="tiny dim">Spreadsheet formula cells get a leading apostrophe for safety. Some flashcard importers may show it.</p> : null}
        </fieldset>
        {sources.length === 0 ? <p className="small">No study materials are ready to export yet.</p> : null}
        {sources.map((source, index) => {
          const row = rows[index] ?? initialState([source])[0]!;
          const effective = exportSourceFor(source, row.selection);
          const available = exportableParts(effective);
          const set = effective.studySet;
          const questions = effective.practiceTest?.questions.length ?? 0;
          const hasCorrections = hasInstructorCorrections(source.studySet, source.practiceTest);
          return (
            <section key={`${index}-${source.material.title}`} className="stack stack--2" aria-label={source.material.title}>
              <label className="small">
                <input
                  type="checkbox"
                  checked={row.include}
                  disabled={working}
                  onChange={(event) => setRows((current) => current.map((item, rowIndex) => rowIndex === index ? { ...item, include: event.target.checked } : item))}
                /> <strong>{source.material.title.trim() || "Study material"}</strong>
              </label>
              <fieldset className="export-study__choices" disabled={working || !row.include}>
                <legend className="field__label">Include from this material</legend>
                {available.guide ? <Choice checked={row.selection.guide} onChange={(checked) => updateSelection(index, "guide", checked)} label="Study guide" detail="Guide and summary" /> : null}
                {available.flashcards ? <Choice checked={row.selection.flashcards} onChange={(checked) => updateSelection(index, "flashcards", checked)} label="Flashcards" detail={countDetail(set?.flashcards.length ?? 0, "card")} /> : null}
                {available.questions ? <Choice checked={row.selection.questions} onChange={(checked) => updateSelection(index, "questions", checked)} label="Practice questions" detail={countDetail(questions, "question")} /> : null}
                {hasCorrections ? <Choice checked={Boolean(row.selection.instructorCorrections)} onChange={(checked) => toggleCorrections(index, checked)} label="Include instructor corrections" detail="Left out unless you include them" /> : null}
              </fieldset>
            </section>
          );
        })}
        {hasQuestions ? <Choice checked={answerKey} onChange={setAnswerKey} disabled={working} label="Add one answer key at the end" detail="Quiz yourself before turning to the answers." /> : null}
        {error ? <p className="field__error" role="alert">{error}</p> : null}
        {saved ? <p className="small" role="status">{saved}</p> : null}
      </div>
    </Dialog>
  );
}

function Choice({ checked, onChange, label, detail, disabled = false }: { checked: boolean; onChange: (checked: boolean) => void; label: string; detail: string; disabled?: boolean }) {
  return (
    <label className="small">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /> {label}
      <span className="tiny dim"> — {detail}</span>
    </label>
  );
}

function countDetail(count: number, singular: string) {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}
