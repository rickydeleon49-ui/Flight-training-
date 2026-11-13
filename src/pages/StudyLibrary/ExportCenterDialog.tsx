import { useEffect, useMemo, useRef, useState } from "react";

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
import { buildFlashcardCsv, EXPORT_CARDS_CSV_LABEL } from "@/logic/flashcardCsv";
import type { StudyMaterial } from "@/domain/types";
import { SAVING_LINE } from "@/logic/studyPackText";
import { chooseStudyPackDestination, exportStudyPack, studyPackErrorMessage, studyPacksAvailable } from "@/data/studyPack";
import { chapterCountLabel } from "@/logic/chapterGroups";
import { packFileTooLarge, packMaterialIds, packRowBlocked, packRows, packTooLargeNote } from "@/logic/studyPackSelection";
import { packSavedSentence } from "@/logic/studyPackText";
import { deviceCan } from "@/services/platform";
import { DesktopOnlyError } from "@/services/documents";
import { savedStudyExportSentence, saveStudyExport, StudyExportError } from "@/services/studyExport";

interface Props {
  open: boolean;
  sources: ExportSource[];
  onClose: () => void;
  initialOutput?: "handout" | "csv";
  /** The whole library, for "Share a study pack". Without it the choice is not offered. */
  materials?: StudyMaterial[];
  /** Materials that have something to share. Others are left out of the pack choices. */
  packEligibleIds?: ReadonlySet<string>;
}

type SelectionState = { include: boolean; selection: ExportSelection };

function initialState(sources: ExportSource[]): SelectionState[] {
  return sources.map((source) => ({
    include: true,
    selection: { ...exportableParts(exportSourceFor(source, {})), instructorCorrections: false },
  }));
}

export function ExportCenterDialog({ open, sources, onClose, initialOutput = "handout", materials: allMaterials, packEligibleIds }: Props) {
  const materials = useMemo(
    () => (packEligibleIds ? allMaterials?.filter((material) => packEligibleIds.has(material.id)) : allMaterials),
    [allMaterials, packEligibleIds],
  );
  const [rows, setRows] = useState<SelectionState[]>(() => initialState(sources));
  const [output, setOutput] = useState<"handout" | "csv" | "pack">(initialOutput);
  const [packChosen, setPackChosen] = useState<Set<string>>(new Set());
  const [answerKey, setAnswerKey] = useState(true);
  const [working, setWorking] = useState(false);
  const busy = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const mac = deviceCan().revealFiles;

  useEffect(() => {
    if (!open) return;
    setRows(initialState(sources));
    setOutput(initialOutput);
    setPackChosen(new Set());
    setAnswerKey(true);
    setError(null);
    setSaved(null);
  }, [open, sources, initialOutput]);

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

  const canPack = studyPacksAvailable() && (materials?.length ?? 0) > 0;
  const packIds = packMaterialIds(materials ?? [], packChosen);

  const savePack = async () => {
    if (busy.current || packIds.length === 0) return;
    busy.current = true;
    setWorking(true);
    setError(null);
    setSaved(null);
    try {
      const destination = await chooseStudyPackDestination();
      if (!destination) return;
      const summary = await exportStudyPack(destination, packIds);
      setSaved(packSavedSentence(summary));
    } catch (caught) {
      setError(studyPackErrorMessage(caught, "The study pack could not be saved. Nothing was changed."));
    } finally {
      busy.current = false;
      setWorking(false);
    }
  };

  const save = async () => {
    if (output === "pack") return savePack();
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
      if (result) setSaved(savedStudyExportSentence(result));
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
          {error ? <p className="field__error" role="alert" style={{ flexBasis: "100%", margin: 0 }}>{error}</p> : null}
          {working && output === "pack" ? <p className="small" role="status" style={{ flexBasis: "100%", margin: 0 }}>{SAVING_LINE}</p> : null}
          {saved ? <p className="small" role="status" style={{ flexBasis: "100%", margin: 0 }}>{saved}</p> : null}
          <Button variant="ghost" onClick={onClose} disabled={working}>{saved ? "Done" : "Cancel"}</Button>
          <Button variant="primary" onClick={() => void save()} disabled={working || (output === "pack" ? packIds.length === 0 : output === "handout" ? chosenItems.length === 0 : chosenCsvItems.length === 0)}>
            {working ? "Saving…" : output === "pack" ? "Save study pack…" : output === "csv" ? (mac ? "Save CSV…" : "Save CSV") : (mac ? "Save handout…" : "Save handout")}
          </Button>
        </>
      )}
    >
      <div className="stack stack--4">
        {output === "pack" ? null : <p className="small">Picture cards are omitted from study packets, CSV and handouts. Use a complete backup to keep pictures, covers and review history.</p>}
        <fieldset className="export-study__choices" disabled={working}>
          <legend className="field__label">Save as</legend>
          <label className="small"><input type="radio" name="export-center-output" checked={output === "handout"} onChange={() => setOutput("handout")} /> Printable handout</label>
          <label className="small"><input type="radio" name="export-center-output" checked={output === "csv"} onChange={() => setOutput("csv")} /> {EXPORT_CARDS_CSV_LABEL}</label>
          {canPack ? <label className="small"><input type="radio" name="export-center-output" checked={output === "pack"} onChange={() => setOutput("pack")} /> Share a study pack</label> : null}
          {output === "csv" ? <p className="tiny dim">Spreadsheet formula cells get a leading apostrophe for safety. Some flashcard importers may show it.</p> : null}
        </fieldset>
        {output === "pack" ? (
          <PackPicker
            materials={materials ?? []}
            chosen={packChosen}
            disabled={working}
            onChange={setPackChosen}
          />
        ) : null}
        {output === "pack" ? null : sources.length === 0 ? <p className="small">No study materials are ready to export yet.</p> : null}
        {output === "pack" ? null : sources.map((source, index) => {
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
        {output !== "pack" && hasQuestions ? <Choice checked={answerKey} onChange={setAnswerKey} disabled={working} label="Add one answer key at the end" detail="Quiz yourself before turning to the answers." /> : null}
      </div>
    </Dialog>
  );
}

function PackPicker({ materials, chosen, disabled, onChange }: { materials: StudyMaterial[]; chosen: Set<string>; disabled: boolean; onChange: (next: Set<string>) => void }) {
  const rows = packRows(materials);
  const selectable = rows.filter((row) => !packRowBlocked(row));
  const allChosen = selectable.length > 0 && selectable.every((row) => chosen.has(row.material.id));
  const toggle = (id: string, checked: boolean) => {
    const next = new Set(chosen);
    if (checked) next.add(id); else next.delete(id);
    onChange(next);
  };
  return (
    <fieldset className="export-study__choices" disabled={disabled}>
      <legend className="field__label">Choose what to share</legend>
      <label className="small">
        <input type="checkbox" checked={allChosen} onChange={(event) => onChange(event.target.checked ? new Set(selectable.map((row) => row.material.id)) : new Set())} /> Select all
      </label>
      {rows.map(({ material, chapters }) => {
        const tooLarge = packFileTooLarge(material);
        const blocked = tooLarge && chapters.length === 0;
        return (
        <div key={material.id} className="stack stack--1">
          <label className="small">
            <input type="checkbox" checked={!blocked && chosen.has(material.id)} disabled={blocked} onChange={(event) => toggle(material.id, event.target.checked)} /> <strong>{material.title.trim() || "Study material"}</strong>
            {tooLarge ? <span className="tiny dim"> — {packTooLargeNote(chapters.length > 0)}</span>
              : chapters.length > 0 ? <span className="tiny dim"> — with its {chapterCountLabel(chapters.length)}</span> : null}
          </label>
          {chapters.length > 0 ? (
            <ul className="tiny dim" aria-label={`Chapters of ${material.title.trim() || "this book"}`}>
              {chapters.map((chapter) => <li key={chapter.id}>{chapter.title.trim() || "Chapter"}</li>)}
            </ul>
          ) : null}
        </div>
        );
      })}
    </fieldset>
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
