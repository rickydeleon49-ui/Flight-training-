import { useEffect, useRef, useState } from "react";

import { Button, Dialog } from "@/components/ui";
import type { StudyMaterial } from "@/domain/types";
import { newId } from "@/lib/id";
import { pdfPartNotes } from "@/logic/pdfParts";
import { detectPdfChapters, splitPdfRanges, watchSplitProgress, type PdfChapter, type PdfChapters } from "@/services/pdf";
import { useAppData } from "@/state/AppDataContext";

import { saveSplitParts } from "./splitSave";

interface Row extends PdfChapter {
  checked: boolean;
  /** Text in the page boxes, so a half-typed number is not rewritten. */
  first: string;
  last: string;
}

export const SOURCE_LINES = {
  outline: "Chapters from the book's contents.",
  text: "Chapters found from page headings — check them.",
  chunks: "No chapters found, so the book is cut into parts of about 30 pages.",
} as const;

/**
 * The detected chapters of a stored PDF, read only while `enabled` (when the user
 * asks to split by chapter: finding chapters reads every page of a book with
 * no contents list, so it must not run on every visit). `onUnavailable` gets a
 * plain message when the PDF cannot be read or has no chapters to offer.
 */
export function useChapterChoice(
  filePath: string | null | undefined,
  enabled: boolean,
  onUnavailable?: (message: string) => void,
): PdfChapters | null {
  const [outline, setOutline] = useState<PdfChapters | null>(null);
  const unavailable = useRef(onUnavailable);
  unavailable.current = onUnavailable;
  useEffect(() => {
    setOutline(null);
    if (!enabled || !filePath) return;
    let cancelled = false;
    detectPdfChapters(filePath)
      .then((found) => {
        if (cancelled) return;
        if (found.chapters && found.chapters.length > 0) setOutline(found);
        else unavailable.current?.("No chapters could be found in this PDF. Try \u201cTake out a chapter\u201d instead.");
      })
      .catch((error: unknown) => {
        if (!cancelled) unavailable.current?.(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, filePath]);
  return outline;
}

/** Plain words for what is wrong with each checked row, keyed by row index. */
export function rowProblems(rows: readonly Row[], pages: number): Map<number, string> {
  const problems = new Map<number, string>();
  const used: { index: number; first: number; last: number }[] = [];
  rows.forEach((row, index) => {
    if (!row.checked) return;
    const first = Number(row.first);
    const last = Number(row.last);
    if (!Number.isInteger(first) || !Number.isInteger(last) || first < 1 || last < 1) {
      problems.set(index, "Type page numbers, starting at 1.");
    } else if (first > last) {
      problems.set(index, "The first page comes after the last page.");
    } else if (last > pages) {
      problems.set(index, `This book has only ${pages} pages.`);
    } else {
      used.push({ index, first, last });
    }
  });
  const sorted = [...used].sort((a, b) => a.first - b.first);
  for (let i = 1; i < sorted.length; i += 1) {
    const before = sorted[i - 1]!;
    const here = sorted[i]!;
    if (here.first <= before.last) {
      const message = `These pages are also used by "${rows[before.index]!.title}".`;
      if (!problems.has(here.index)) problems.set(here.index, message);
    }
  }
  return problems;
}

interface Props {
  open: boolean;
  material: StudyMaterial;
  outline: PdfChapters;
  onClose: () => void;
  onCreated: (materialIds: string[]) => void;
}

export function SplitByChapterDialog({ open, material, outline, onClose, onCreated }: Props) {
  const { mutate, repositories, refresh } = useAppData();
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setProgress(null);
    setRows(
      (outline.chapters ?? []).map((chapter) => ({
        ...chapter,
        checked: true,
        first: String(chapter.firstPage),
        last: String(chapter.lastPage),
      })),
    );
  }, [open, outline]);

  const problems = rowProblems(rows, outline.pages);
  const checked = rows.filter((row) => row.checked);
  const canSave = !working && checked.length > 0 && problems.size === 0;
  const update = (index: number, change: Partial<Row>) =>
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...change } : row)));

  const save = async () => {
    if (!canSave || !material.filePath) return;
    setError(null);
    setProgress(null);
    setWorking(true);
    let stopWatching = () => {};
    try {
      stopWatching = await watchSplitProgress(setProgress);
      const ranges = checked.map((row) => ({
        firstPage: Number(row.first),
        lastPage: Number(row.last),
        title: row.title,
      }));
      const receipt = await splitPdfRanges({
        relativePath: material.filePath,
        batchId: newId(),
        fileName: material.originalFileName ?? material.title,
        ranges,
        sourceMaterialId: material.id,
      });
      const parts = receipt.core.plan;
      const owner = (start: number) =>
        ranges.findIndex((range) => start >= range.firstPage && start <= range.lastPage);
      const outcome = await saveSplitParts(
        mutate,
        repositories,
        refresh,
        receipt,
        parts.map((part) => {
          const index = owner(part.selection.start);
          const range = ranges[index];
          const shared = parts.filter((other) => owner(other.selection.start) === index).length > 1;
          const label = range?.title ?? material.title;
          return {
            id: part.id,
            title: `${material.title} \u2013 ${label}${shared ? ` (pages ${part.selection.start}–${part.selection.end})` : ""}`,
            notes: pdfPartNotes(material.title, { firstPage: part.selection.start, lastPage: part.selection.end }),
          };
        }),
      );
      if (!outcome.saved) {
        setError(
          outcome.cleanupFailed
            ? "The chapters could not be saved to your library, and their temporary files could not be removed; restart the app before trying again. The original PDF is untouched."
            : "The chapters could not be saved, so nothing was changed. The original PDF is untouched — try once more.",
        );
        return;
      }
      onCreated(outcome.ids);
    } catch (splitError) {
      setError(splitError instanceof Error ? splitError.message : String(splitError));
    } finally {
      stopWatching();
      setWorking(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!working}
      title="Split by chapter"
      description="Each chapter you keep ticked becomes its own item in your library. The original is left exactly as it is."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={working}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={!canSave}>
            {working ? "Saving chapters…" : "Save chapters"}
          </Button>
        </>
      }
    >
      <div className="stack stack--4">
        <p className="small muted">{SOURCE_LINES[outline.chapterSource]}</p>
        <p className="small">{rows.length} {rows.length === 1 ? "part" : "parts"} found</p>
        {/* A long book has dozens of parts: the list scrolls, by wheel or keys. */}
        <div
          role="region"
          aria-label="Parts found"
          tabIndex={0}
          style={{ maxHeight: "50vh", overflowY: "auto" }}
        >
        <ul className="stack stack--2" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {rows.map((row, index) => (
            <li key={index} className="stack stack--1">
              <div className="row row--wrap">
                <label className="row">
                  <input
                    type="checkbox"
                    checked={row.checked}
                    disabled={working}
                    onChange={(event) => update(index, { checked: event.target.checked })}
                  />
                  <span>{row.title}</span>
                </label>
                <span className="small muted">
                  pages{" "}
                  <input
                    type="number"
                    min={1}
                    max={outline.pages}
                    aria-label={`First page of ${row.title}`}
                    value={row.first}
                    disabled={working || !row.checked}
                    onChange={(event) => update(index, { first: event.target.value })}
                    style={{ width: "5em" }}
                  />{" "}
                  to{" "}
                  <input
                    type="number"
                    min={1}
                    max={outline.pages}
                    aria-label={`Last page of ${row.title}`}
                    value={row.last}
                    disabled={working || !row.checked}
                    onChange={(event) => update(index, { last: event.target.value })}
                    style={{ width: "5em" }}
                  />
                </span>
              </div>
              {problems.has(index) ? (
                <p className="field__error" role="alert">
                  {problems.get(index)}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
        </div>
        {working ? <p className="small muted" role="status">{progress ?? "Saving chapters…"}</p> : null}
        {error ? (
          <p className="field__error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
