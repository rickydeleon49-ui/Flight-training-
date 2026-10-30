import { useEffect, useState } from "react";

import { Button, Dialog, Field, TextInput } from "@/components/ui";
import type { StudyMaterial } from "@/domain/types";
import { newId } from "@/lib/id";
import { MAX_PDF_BYTES, checkSplitRange, describeFileSize } from "@/logic/aiLimits";
import { pdfPartNotes } from "@/logic/pdfParts";
import { formatFileSize } from "@/services/documents";
import { backupErrorMessage, createBackup } from "@/services/backups";
import { inspectPdf, splitPdf, type PdfOutline } from "@/services/pdf";
import { useAppData } from "@/state/AppDataContext";

import { saveSplitParts } from "./splitSave";

interface Props {
  open: boolean;
  material: StudyMaterial;
  onClose: () => void;
  onCreated: (materialId: string) => void;
}

/**
 * Take one exact page range out of a study PDF by hand.
 *
 * Alongside automatic splitting, for the times a specific chapter or section
 * is wanted rather than whatever fits. A safety copy of the database is
 * taken before anything about her library changes, so a failure partway
 * through never costs more than this one attempt.
 */
export function ManualSplitDialog({ open, material, onClose, onCreated }: Props) {
  const { mutate, repositories, refresh } = useAppData();
  const [outline, setOutline] = useState<PdfOutline | null>(null);
  const [firstPage, setFirstPage] = useState("1");
  const [lastPage, setLastPage] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (!open || !material.filePath) return;
    setError(null);
    setOutline(null);
    setFirstPage("1");
    setLastPage("");
    setTitle("");
    let cancelled = false;
    inspectPdf(material.filePath)
      .then((found) => {
        if (!cancelled) {
          setOutline(found);
          setLastPage(String(found.pages));
        }
      })
      .catch((inspectError: unknown) => {
        if (!cancelled) {
          setError(inspectError instanceof Error ? inspectError.message : String(inspectError));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, material.filePath]);

  const first = Number(firstPage);
  const last = Number(lastPage);
  const verdict = outline ? checkSplitRange(first, last, outline.pages, outline.maxPagesPerSplit) : null;

  const save = async () => {
    if (!material.filePath || !verdict?.ok) return;
    setError(null);
    setWorking(true);

    // A safety copy first: nothing about her library changes — not a file
    // written, not a record saved — until one exists to fall back on.
    try {
      await createBackup();
    } catch (backupError) {
      setError(backupErrorMessage(backupError, "Could not save a safety copy, so nothing was changed."));
      setWorking(false);
      return;
    }

    const materialId = newId();
    const chosenTitle = title.trim() || `${material.title} — Pages ${first}–${last}`;

    try {
      const receipt = await splitPdf({
        relativePath: material.filePath,
        materialId,
        firstPage: first,
        lastPage: last,
        fileName: chosenTitle,
        sourceMaterialId: material.id,
      });

      const outcome = await saveSplitParts(mutate, repositories, refresh, receipt, [{
        id: materialId,
        title: chosenTitle,
        notes: pdfPartNotes(material.title, { firstPage: first, lastPage: last }),
      }]);
      if (!outcome.saved) {
        setError(
          !outcome.cleanupFailed
            ? "This chapter could not be saved to your library, so its file was removed again. " +
                "The original PDF is untouched — try once more."
            : "This chapter could not be saved to your library, and its temporary file could " +
                "not be removed; restart the app before trying again. The original PDF is " +
                "untouched.",
        );
        return;
      }
      onCreated(outcome.ids[0] ?? materialId);
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
      dismissible={!working}
      title="Take out a chapter"
      description="Saves the pages you choose as a study document of its own. The original handbook is left exactly as it is."
      narrow
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={working}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={working || !verdict?.ok}>
            {working ? "Saving this chapter…" : "Save this chapter"}
          </Button>
        </>
      }
    >
      <div className="stack stack--4">
        <p className="small muted">
          {outline
            ? `${material.originalFileName ?? material.title} — ${outline.pages.toLocaleString()} pages, ${formatFileSize(material.fileSize)}.`
            : "Reading the document…"}
        </p>

        {outline ? (
          <>
            <div className="row row--wrap" style={{ gap: "var(--space-3)" }}>
              <Field label="First page">
                {({ id }) => (
                  <TextInput
                    id={id}
                    type="number"
                    min={1}
                    max={outline.pages}
                    value={firstPage}
                    onChange={(event) => setFirstPage(event.target.value)}
                    style={{ width: "6rem" }}
                  />
                )}
              </Field>
              <Field label="Last page">
                {({ id }) => (
                  <TextInput
                    id={id}
                    type="number"
                    min={1}
                    max={outline.pages}
                    value={lastPage}
                    onChange={(event) => setLastPage(event.target.value)}
                    style={{ width: "6rem" }}
                  />
                )}
              </Field>
            </div>

            <Field label="Title (optional)" hint="Left blank, this is named after the page range.">
              {({ id }) => (
                <TextInput
                  id={id}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={`${material.title} — Pages ${firstPage || "?"}–${lastPage || "?"}`}
                />
              )}
            </Field>

            {verdict?.ok ? (
              <p className="tiny dim">
                {verdict.pages.toLocaleString()} {verdict.pages === 1 ? "page" : "pages"}. A
                safety copy of your library is saved first, and this chapter becomes its own
                Study Library item — your selected AI provider can create a study guide or practice test from it,
                just like any other document. Anything over{" "}
                {describeFileSize(MAX_PDF_BYTES)} once saved is refused; illustrated pages take
                more space than plain text, so a heavily illustrated range may need to be
                smaller than the page count alone suggests.
              </p>
            ) : verdict && !verdict.ok ? (
              <p className="tiny" style={{ color: "var(--status-overdue)" }}>
                {verdict.reason}
              </p>
            ) : null}
          </>
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
