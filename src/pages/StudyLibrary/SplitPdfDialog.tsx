import { useEffect, useState } from "react";

import { Button, Dialog } from "@/components/ui";
import type { StudyMaterial } from "@/domain/types";
import { newId } from "@/lib/id";
import { MAX_PDF_BYTES, describeFileSize } from "@/logic/aiLimits";
import { pdfPartNotes, pdfPartTitle } from "@/logic/pdfParts";
import { cleanupDocuments, formatFileSize } from "@/services/documents";
import {
  inspectPdf,
  splitPdfAutomatically,
  watchSplitProgress,
  type PdfOutline,
} from "@/services/pdf";
import { useAppData } from "@/state/AppDataContext";

interface Props {
  open: boolean;
  material: StudyMaterial;
  onClose: () => void;
  onCreated: (materialIds: string[]) => void;
}

export function SplitPdfDialog({ open, material, onClose, onCreated }: Props) {
  const { mutate } = useAppData();
  const [outline, setOutline] = useState<PdfOutline | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !material.filePath) return;
    setError(null);
    setOutline(null);
    let cancelled = false;
    inspectPdf(material.filePath)
      .then((found) => {
        if (!cancelled) setOutline(found);
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

  const save = async () => {
    if (!material.filePath || !outline) return;
    setError(null);
    setProgress(null);
    setWorking(true);
    let stopWatching = () => {};
    try {
      stopWatching = await watchSplitProgress(setProgress);
      const documents = await splitPdfAutomatically({
        relativePath: material.filePath,
        batchId: newId(),
        fileName: material.originalFileName ?? material.title,
      });
      const created = await mutate(async (repos) => {
        const inputs = documents.map((document, index) => ({
          id: newId(),
          title: pdfPartTitle(material.title, index, documents.length),
          materialType: material.materialType,
          topic: material.topic,
          priority: material.priority,
          goalId: material.goalId,
          eventId: material.eventId,
          tags: material.tags,
          notes: pdfPartNotes(material.title, document),
          filePath: document.relativePath,
          originalFileName: document.originalFileName,
          fileSize: document.fileSize,
        }));
        return (await repos.documents.createMany(inputs)).map((part) => part.id);
      });
      if (created === null) {
        const cleanupFailures = await cleanupDocuments(
          documents.map((document) => document.relativePath),
        );
        setError(
          cleanupFailures.length === 0
            ? "The parts could not be saved to your library, so their files were removed again. " +
                "The original PDF is untouched — try once more."
            : "The parts could not be saved to your library. Some temporary files could not be " +
                "removed; restart the app before trying again. The original PDF is untouched.",
        );
        return;
      }
      onCreated(created);
    } catch (splitError) {
      setError(splitError instanceof Error ? splitError.message : String(splitError));
    } finally {
      stopWatching();
      setProgress(null);
      setWorking(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!working}
      title="Create study-size parts"
      description="Automatically divides this PDF into labeled parts that can each have their own study guide. The original is left exactly as it is."
      narrow
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={working}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={working || !outline}>
            {working ? "Creating the parts…" : "Create study-size parts"}
          </Button>
        </>
      }
    >
      <div className="stack stack--4">
        <p className="small muted">
          {outline
            ? String(material.originalFileName ?? material.title) + " — " + outline.pages + " pages, " + formatFileSize(material.fileSize) + "."
            : "Reading the document…"}
        </p>
        {outline ? (
          <p className="tiny dim">
            Each part is at most {describeFileSize(MAX_PDF_BYTES)} and{" "}
            {outline.maxPagesPerSplit.toLocaleString()} pages. Parts are labeled in order and
            appear as separate library items with their own study-guide action.
          </p>
        ) : null}
        {working ? (
          <div className="ai-working" role="status">
            <span className="ai-working__dot" aria-hidden="true" />
            <p className="tiny dim">
              {progress ?? "A large or illustrated PDF can take a little longer per part."}
            </p>
          </div>
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
