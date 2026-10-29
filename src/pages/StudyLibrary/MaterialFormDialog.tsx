import { useEffect, useRef, useState } from "react";

import { Button, Dialog, DocumentIcon, Field, Select, TextArea, TextInput } from "@/components/ui";
import {
  MATERIAL_TYPE_OPTIONS,
  PRIORITY_OPTIONS,
  REVIEW_STATUS_OPTIONS,
  TOPIC_OPTIONS,
  type Goal,
  type Id,
  type MaterialType,
  type Priority,
  type ReviewStatus,
  type ScheduleEvent,
  type StudyMaterial,
  type Topic,
} from "@/domain/types";
import { canHandleFiles, cleanupDocuments, formatFileSize, pickAndImportDocument } from "@/services/documents";

export interface MaterialDraft {
  id?: Id;
  title: string;
  materialType: MaterialType;
  topic: Topic;
  reviewStatus: ReviewStatus;
  priority: Priority;
  goalId: Id | null;
  eventId: Id | null;
  notes: string;
  tags: string[];
  filePath: string | null;
  originalFileName: string | null;
  fileSize: number | null;
}

const emptyDraft = (): MaterialDraft => ({
  title: "",
  materialType: "study_guide",
  topic: "general",
  reviewStatus: "needs_review",
  priority: "later",
  goalId: null,
  eventId: null,
  notes: "",
  tags: [],
  filePath: null,
  originalFileName: null,
  fileSize: null,
});

interface Props {
  open: boolean;
  material?: StudyMaterial | null;
  goals: Goal[];
  events: ScheduleEvent[];
  /** Id reserved for a new material, so a file can be imported under it. */
  newMaterialId: Id;
  onClose: () => void;
  onSave: (draft: MaterialDraft) => Promise<boolean>;
}

export function MaterialFormDialog({
  open,
  material = null,
  goals,
  events,
  newMaterialId,
  onClose,
  onSave,
}: Props) {
  const [draft, setDraft] = useState<MaterialDraft>(emptyDraft);
  const [tagText, setTagText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [cleanupFailedPath, setCleanupFailedPath] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const ownedPaths = useRef(new Set<string>());
  const submitting = useRef(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setFileError(null);
    setCleanupFailedPath(null);
    ownedPaths.current.clear();
    if (material) {
      setDraft({ ...material });
      setTagText(material.tags.join(", "));
    } else {
      setDraft(emptyDraft());
      setTagText("");
    }
  }, [open, material?.id]);

  // An FAA copy or picture cards record this file's exact bytes, so it stays put.
  const fileLock = material?.faaReference
    ? "This file is a saved FAA reference copy, so it stays as it is. Add a new file as its own material."
    : material?.usedByPictureCards
      ? "Picture cards use this picture, so it stays as it is. Add a new picture as its own material."
      : null;

  const update = <K extends keyof MaterialDraft>(key: K, value: MaterialDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const chooseFile = async () => {
    setFileError(null);
    setImporting(true);
    try {
      const imported = await pickAndImportDocument(material?.id ?? newMaterialId);
      if (imported) {
        ownedPaths.current.add(imported.relativePath);
        setDraft((current) => ({
          ...current,
          filePath: imported.relativePath,
          originalFileName: imported.originalFileName,
          fileSize: imported.fileSize,
          // Offer the file name as a title when there isn't one yet.
          title: current.title || imported.originalFileName.replace(/\.[^.]+$/, ""),
        }));
      }
    } catch (importError) {
      setFileError(
        importError instanceof Error ? importError.message : "That file could not be added.",
      );
    } finally {
      setImporting(false);
    }
  };

  const retryFormerCleanup = async () => {
    if (!cleanupFailedPath || saving) return;
    setSaving(true);
    setFileError(null);
    try {
      const failures = await cleanupDocuments([cleanupFailedPath]);
      if (failures.length === 0) {
        setCleanupFailedPath(null);
        setFileError(null);
        onClose();
      } else {
        setFileError(
          "The previous file could not be removed from app storage. You can retry removing it or close.",
        );
      }
    } finally {
      setSaving(false);
    }
  };

  const discardAndClose = async () => {
    if (importing || saving) return;
    if (cleanupFailedPath) {
      setCleanupFailedPath(null);
      setFileError(null);
      onClose();
      return;
    }
    const failures = await cleanupDocuments([...ownedPaths.current]);
    if (failures.length > 0) {
      setFileError("An unused file could not be removed from app storage. Try Cancel again.");
      return;
    }
    ownedPaths.current.clear();
    onClose();
  };

  const submit = async () => {
    if (submitting.current || importing) return;
    if (cleanupFailedPath) {
      await retryFormerCleanup();
      return;
    }
    if (!draft.title.trim()) {
      setError("Give this a title you will recognise later.");
      return;
    }
    submitting.current = true;
    setSaving(true);
    setError(null);
    setFileError(null);
    try {
      const unused = [...ownedPaths.current].filter((path) => path !== draft.filePath);
      const failures = await cleanupDocuments(unused);
      if (failures.length > 0) {
        setFileError("An unused file could not be removed from app storage. Try saving again.");
        return;
      }
      unused.forEach((path) => ownedPaths.current.delete(path));
      const saved = await onSave({
        ...draft,
        id: material?.id ?? newMaterialId,
        title: draft.title.trim(),
        tags: tagText
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      });
      if (!saved) {
        setError("That material could not be saved. Your choices are still here to retry.");
        return;
      }
      if (material?.filePath && material.filePath !== draft.filePath) {
        let formerFailures = await cleanupDocuments([material.filePath]);
        if (formerFailures.length > 0) {
          for (let attempt = 0; attempt < 2; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, 100));
            formerFailures = await cleanupDocuments([material.filePath]);
            if (formerFailures.length === 0) break;
          }
        }
        if (formerFailures.length > 0) {
          setCleanupFailedPath(material.filePath);
          setFileError(
            "Your changes were saved, but the previous file could not be removed from app storage. You can retry removing it or close.",
          );
          ownedPaths.current.clear();
          return;
        }
      }
      ownedPaths.current.clear();
      onClose();
    } catch {
      setError("That material could not be saved. Your choices are still here to retry.");
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => void discardAndClose()}
      dismissible={!importing && !saving}
      title={material ? "Edit material" : "Add to your library"}
      description="Give it a place in your training, not just a filename."
      footer={
        cleanupFailedPath ? (
          <>
            <Button onClick={() => void discardAndClose()} disabled={saving}>
              Close
            </Button>
            <Button variant="primary" onClick={() => void retryFormerCleanup()} disabled={saving}>
              {saving ? "Removing…" : "Retry removing old file"}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={() => void discardAndClose()} disabled={importing || saving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void submit()} disabled={importing || saving}>
              {saving ? "Saving…" : material ? "Save changes" : "Add material"}
            </Button>
          </>
        )
      }
    >
      <div className="stack stack--5">
        <div className="stack stack--2">
          {draft.filePath ? (
            <div className="file-row">
              <DocumentIcon />
              <div style={{ minWidth: 0 }}>
                <p className="small truncate">{draft.originalFileName}</p>
                <p className="tiny dim">{formatFileSize(draft.fileSize)}</p>
              </div>
              <Button
                size="small"
                disabled={fileLock !== null}
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    filePath: null,
                    originalFileName: null,
                    fileSize: null,
                  }))
                }
                style={{ marginLeft: "auto" }}
              >
                Remove
              </Button>
            </div>
          ) : (
            <Button onClick={chooseFile} disabled={importing || !canHandleFiles() || fileLock !== null}>
              <DocumentIcon size={16} />
              {importing ? "Adding…" : "Choose a file"}
            </Button>
          )}
          {fileLock ? (
            <p className="tiny dim">{fileLock}</p>
          ) : !canHandleFiles() ? (
            <p className="tiny dim">
              Adding a file needs the desktop application. You can still create this as a
              note with everything except the document.
            </p>
          ) : (
            <p className="tiny dim">
              The file is copied into the desktop app&rsquo;s private storage on this computer,
              so moving or deleting the original will not break this copy. Include it in a
              complete backup before moving to another computer.
            </p>
          )}
          {fileError ? <p className="field__error">{fileError}</p> : null}
        </div>

        <div className="form-grid">
          <Field label="Title" error={error} full>
            {({ id, describedBy, invalid }) => (
              <TextInput
                id={id}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                value={draft.title}
                placeholder="Crosswind Landing Notes"
                onChange={(e) => update("title", e.target.value)}
              />
            )}
          </Field>

          <Field label="Material type">
            {({ id }) => (
              <Select
                id={id}
                options={MATERIAL_TYPE_OPTIONS}
                value={draft.materialType}
                onChange={(value) => update("materialType", value)}
              />
            )}
          </Field>

          <Field label="Topic">
            {({ id }) => (
              <Select
                id={id}
                options={TOPIC_OPTIONS}
                value={draft.topic}
                onChange={(value) => update("topic", value)}
              />
            )}
          </Field>

          <Field label="Review status">
            {({ id }) => (
              <Select
                id={id}
                options={REVIEW_STATUS_OPTIONS}
                value={draft.reviewStatus}
                onChange={(value) => update("reviewStatus", value)}
              />
            )}
          </Field>

          <Field label="Priority">
            {({ id }) => (
              <Select
                id={id}
                options={PRIORITY_OPTIONS}
                value={draft.priority}
                onChange={(value) => update("priority", value)}
              />
            )}
          </Field>

          <Field label="Related goal">
            {({ id }) => (
              <Select
                id={id}
                placeholder="Not linked to a goal"
                options={goals.map((goal) => ({ value: goal.id, label: goal.title }))}
                value={draft.goalId ?? ""}
                onChange={(value) => update("goalId", value || null)}
              />
            )}
          </Field>

          <Field label="Related lesson">
            {({ id }) => (
              <Select
                id={id}
                placeholder="Not linked to a lesson"
                options={events.map((event) => ({
                  value: event.id,
                  label: `${event.title} · ${event.date}`,
                }))}
                value={draft.eventId ?? ""}
                onChange={(value) => update("eventId", value || null)}
              />
            )}
          </Field>

          <Field label="Tags" hint="Separated by commas." full>
            {({ id, describedBy }) => (
              <TextInput
                id={id}
                aria-describedby={describedBy}
                value={tagText}
                placeholder="landings, technique"
                onChange={(e) => setTagText(e.target.value)}
              />
            )}
          </Field>

          {!material ? <Field label="Personal notes" full>
            {({ id }) => (
              <TextArea
                id={id}
                rows={4}
                value={draft.notes}
                placeholder="Sections 3–5 cover the sideslip method."
                onChange={(e) => update("notes", e.target.value)}
              />
            )}
          </Field> : <p className="tiny dim">Edit personal notes on the material page; they save automatically.</p>}
        </div>
      </div>
    </Dialog>
  );
}
