import { useEffect, useState } from "react";

import { Button, Dialog, Field, TextInput } from "@/components/ui";
import type { StudyMaterial } from "@/domain/types";
import { newId } from "@/lib/id";
import { MAX_PDF_BYTES, checkSplitRange, describeFileSize } from "@/logic/aiLimits";
import { deleteDocument, formatFileSize } from "@/services/documents";
import { inspectPdf, splitPdf, type PdfOutline } from "@/services/pdf";
import { useAppData } from "@/state/AppDataContext";

interface Props {
  open: boolean;
  material: StudyMaterial;
  onClose: () => void;
  /** Called with the new material once it exists, so the page can open it. */
  onCreated: (materialId: string) => void;
}

/**
 * Take one chapter out of a handbook.
 *
 * A study aid works better from a chapter than a whole book, and Google will
 * not read a book at all — so this is both the way past the size limit and
 * the better way to study. The original is never changed.
 */
export function SplitPdfDialog({ open, material, onClose, onCreated }: Props) {
  const { mutate } = useAppData();
  const [outline, setOutline] = useState<PdfOutline | null>(null);
  const [title, setTitle] = useState("");
  const [first, setFirst] = useState("1");
  const [last, setLast] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (!open || !material.filePath) return;
    setError(null);
    setOutline(null);
    setTitle("");
    setFirst("1");
    setLast("");
    let cancelled = false;
    inspectPdf(material.filePath)
      .then((found) => {
        if (cancelled) return;
        setOutline(found);
        setLast(String(Math.min(found.pages, found.maxPagesPerSplit)));
      })
      .catch((inspectError: unknown) => {
        if (cancelled) return;
        setError(
          inspectError instanceof Error ? inspectError.message : String(inspectError),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [open, material.filePath]);

  const firstPage = Number.parseInt(first, 10);
  const lastPage = Number.parseInt(last, 10);
  // Judged against both of Google's limits, not only the ends of the book:
  // a 1,200-page selection is refused here rather than after the split.
  const range = outline
    ? checkSplitRange(firstPage, lastPage, outline.pages, outline.maxPagesPerSplit)
    : null;
  const rangeIsSensible = range?.ok === true;
  const pageCount = range?.pages ?? 0;

  const save = async () => {
    if (!material.filePath || !rangeIsSensible) return;
    setError(null);
    setWorking(true);
    try {
      // The material's id names the stored file, so it is chosen before the
      // split runs and the record is created with the same one.
      const materialId = newId();
      const chosenTitle =
        title.trim() || `${material.title} — pages ${firstPage}–${lastPage}`;

      const document = await splitPdf({
        relativePath: material.filePath,
        materialId,
        firstPage,
        lastPage,
        fileName: chosenTitle,
      });

      const created = await mutate((repos) =>
        repos.documents.create({
          id: materialId,
          title: chosenTitle,
          // The chapter is the same kind of thing as the book it came from.
          materialType: material.materialType,
          topic: material.topic,
          priority: material.priority,
          goalId: material.goalId,
          eventId: material.eventId,
          tags: material.tags,
          notes: `Pages ${firstPage}–${lastPage} of ${material.title}.`,
          filePath: document.relativePath,
          originalFileName: document.originalFileName,
          fileSize: document.fileSize,
        }),
      );
      if (created === null) {
        // The pages were written but the record was not. Leaving the file
        // behind would put a document in her library storage that nothing
        // points at and nothing can remove.
        //
        // `mutate` only answers null when the write itself failed — a save
        // that worked and then failed to refresh the screen still returns the
        // record — so nothing is deleted out from under a chapter that exists.
        await deleteDocument(document.relativePath);
        setError(
          "Those pages could not be saved to your library, so the file was removed again. " +
            "The handbook itself is untouched — try once more.",
        );
        return;
      }
      onCreated(created.id);
    } catch (splitError) {
      setError(splitError instanceof Error ? splitError.message : String(splitError));
    } finally {
      setWorking(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Take out a chapter"
      description="Saves the pages you choose as a study document of its own. This handbook is left exactly as it is."
      narrow
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={working}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={save}
            disabled={working || !outline || !rangeIsSensible}
          >
            {working ? "Taking the pages…" : "Save these pages"}
          </Button>
        </>
      }
    >
      <div className="stack stack--4">
        <p className="small muted">
          {outline
            ? `${material.originalFileName ?? material.title} — ${outline.pages} pages, ${formatFileSize(material.fileSize)}.`
            : "Reading the document…"}
        </p>

        <div className="row row--wrap">
          <Field label="First page">
            {({ id }) => (
              <TextInput
                id={id}
                type="number"
                min={1}
                max={outline?.pages ?? undefined}
                value={first}
                onChange={(e) => setFirst(e.target.value)}
                style={{ width: "7rem" }}
              />
            )}
          </Field>
          <Field label="Last page">
            {({ id }) => (
              <TextInput
                id={id}
                type="number"
                min={1}
                max={outline?.pages ?? undefined}
                value={last}
                onChange={(e) => setLast(e.target.value)}
                style={{ width: "7rem" }}
              />
            )}
          </Field>
        </div>

        <Field
          label="Title"
          hint={`Left blank, it is called “${material.title} — pages ${first || "?"}–${last || "?"}”.`}
          full
        >
          {({ id, describedBy }) => (
            <TextInput
              id={id}
              aria-describedby={describedBy}
              value={title}
              placeholder="Chapter 3 — Aerodynamics"
              onChange={(e) => setTitle(e.target.value)}
            />
          )}
        </Field>

        {outline && range?.ok ? (
          <p className="tiny dim">
            {pageCount.toLocaleString()} {pageCount === 1 ? "page" : "pages"}, inside the{" "}
            {outline.maxPagesPerSplit.toLocaleString()}-page limit Google reads. Its size is
            known once the chapter is saved; the study button says so if it comes out over{" "}
            {describeFileSize(MAX_PDF_BYTES)}.
          </p>
        ) : null}

        {outline && range && !range.ok ? (
          <p className="tiny" style={{ color: "var(--status-overdue)" }}>
            {range.reason}
          </p>
        ) : null}

        {error ? (
          <p className="field__error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
