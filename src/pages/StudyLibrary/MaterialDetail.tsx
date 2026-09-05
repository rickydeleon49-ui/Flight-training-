import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { ActionFormDialog, type ActionDraft } from "@/components/actions/ActionFormDialog";
import { ActionRow } from "@/components/actions/ActionRow";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  AlertIcon,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  DocumentIcon,
  EmptyState,
  ExternalIcon,
  PlusIcon,
  Select,
  TextArea,
  TextInput,
} from "@/components/ui";
import {
  MATERIAL_TYPE_LABELS,
  PRIORITY_LABELS,
  REVIEW_STATUS_LABELS,
  REVIEW_STATUS_OPTIONS,
  TOPIC_LABELS,
} from "@/domain/types";
import { formatLongDate, nowIso, todayIso } from "@/lib/dates";
import { newId } from "@/lib/id";
import { actionsFor } from "@/logic/actions";
import {
  canHandleFiles,
  deleteDocument,
  documentExists,
  formatFileSize,
  openDocument,
} from "@/services/documents";
import { useAppData } from "@/state/AppDataContext";
import { useActionOperations } from "@/state/useActions";

import { MaterialFormDialog, type MaterialDraft } from "./MaterialFormDialog";
import "./studyLibrary.css";

export function MaterialDetail() {
  const { materialId } = useParams();
  const navigate = useNavigate();
  const { data, mutate } = useAppData();
  const operations = useActionOperations();
  const today = todayIso();

  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [addingAction, setAddingAction] = useState(false);
  const [newQuestion, setNewQuestion] = useState("");
  const [notes, setNotes] = useState("");
  const [notesSaved, setNotesSaved] = useState(false);
  const [fileMissing, setFileMissing] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  const material = data.materials.find((candidate) => candidate.id === materialId) ?? null;

  useEffect(() => {
    if (material) setNotes(material.notes);
  }, [material?.id, material?.notes]);

  // A document can disappear from disk; the library says so rather than failing.
  useEffect(() => {
    let cancelled = false;
    if (!material?.filePath || !canHandleFiles()) {
      setFileMissing(false);
      return;
    }
    documentExists(material.filePath).then((exists) => {
      if (!cancelled) setFileMissing(!exists);
    });
    return () => {
      cancelled = true;
    };
  }, [material?.filePath]);

  if (!material) {
    return (
      <>
        <PageHeader title="Material not found" />
        <Card>
          <EmptyState
            title="That material is no longer here."
            body="It may have been removed from your library."
            action={
              <Link className="button button--secondary" to="/study">
                Back to Study Library
              </Link>
            }
          />
        </Card>
      </>
    );
  }

  const relatedActions = actionsFor(data.actions, "material", material.id);
  const questions = data.questions.filter((question) => question.materialId === material.id);
  const goal = data.goals.find((candidate) => candidate.id === material.goalId);
  const event = data.events.find((candidate) => candidate.id === material.eventId);

  const saveMaterial = async (draft: MaterialDraft) => {
    await mutate((repos) => repos.documents.update(material.id, draft));
    setEditing(false);
  };

  const saveNotes = async () => {
    await mutate((repos) => repos.documents.update(material.id, { notes }));
    setNotesSaved(true);
    window.setTimeout(() => setNotesSaved(false), 2000);
  };

  const addQuestion = async () => {
    const text = newQuestion.trim();
    if (!text) return;
    await mutate((repos) =>
      repos.questions.create({ text, topic: material.topic, materialId: material.id }),
    );
    setNewQuestion("");
  };

  const open = async () => {
    if (!material.filePath) return;
    setOpenError(null);
    try {
      await openDocument(material.filePath);
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : "That file could not be opened.");
    }
  };

  return (
    <>
      <PageHeader
        title={material.title}
        subtitle={`${MATERIAL_TYPE_LABELS[material.materialType]} · ${TOPIC_LABELS[material.topic]}`}
        action={
          <div className="row">
            <Link className="button button--ghost" to="/study">
              Back
            </Link>
            <Button onClick={() => setEditing(true)}>Edit</Button>
            <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
              Delete
            </Button>
          </div>
        }
      />

      <div className="detail">
        <div className="detail__column">
          {material.filePath ? (
            <Card>
              <CardBody>
                <div className={`file-row${fileMissing ? " file-row--missing" : ""}`}>
                  {fileMissing ? <AlertIcon /> : <DocumentIcon />}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <p className="small truncate">{material.originalFileName}</p>
                    <p className="tiny">
                      {fileMissing
                        ? "This file is no longer in your library storage."
                        : formatFileSize(material.fileSize)}
                    </p>
                  </div>
                  {!fileMissing && canHandleFiles() ? (
                    <Button onClick={open}>
                      <ExternalIcon size={15} /> Open
                    </Button>
                  ) : null}
                </div>
                {fileMissing ? (
                  <p className="tiny muted" style={{ marginTop: "var(--space-3)" }}>
                    Everything you wrote about it is still here. Edit this material to add
                    the file again.
                  </p>
                ) : null}
                {openError ? (
                  <p className="field__error" style={{ marginTop: "var(--space-3)" }}>
                    {openError}
                  </p>
                ) : null}
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader
              title="Personal notes"
              action={
                notesSaved ? (
                  <span className="tiny" style={{ color: "var(--status-complete)" }}>
                    Saved
                  </span>
                ) : null
              }
            />
            <CardBody>
              <div className="stack stack--3">
                <TextArea
                  rows={6}
                  value={notes}
                  aria-label="Personal notes"
                  placeholder="What matters in this material, and what you want to remember."
                  onChange={(e) => setNotes(e.target.value)}
                />
                <div className="row">
                  <Button
                    variant="primary"
                    onClick={saveNotes}
                    disabled={notes === material.notes}
                  >
                    Save notes
                  </Button>
                </div>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Next actions"
              action={
                <Button size="small" onClick={() => setAddingAction(true)}>
                  <PlusIcon size={14} /> Add
                </Button>
              }
            />
            <CardBody flush>
              {relatedActions.length === 0 ? (
                <p className="small muted" style={{ padding: "0 var(--space-5) var(--space-5)" }}>
                  What should you do with this material? &ldquo;Review pages 4&ndash;8 before
                  Saturday&rdquo; is more useful than &ldquo;study&rdquo;.
                </p>
              ) : (
                <div style={{ paddingBottom: "var(--space-3)" }}>
                  {relatedActions.map((action) => (
                    <ActionRow
                      key={action.id}
                      action={action}
                      today={today}
                      onToggle={operations.toggle}
                      onDelete={(a) => operations.remove(a.id)}
                    />
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Questions from this material" />
            <CardBody>
              <div className="stack stack--3">
                {questions.map((question) => (
                  <div className="row row--between" key={question.id}>
                    <span className="small wrap-anywhere">{question.text}</span>
                    <Badge>{question.status === "answered" ? "Answered" : "To ask"}</Badge>
                  </div>
                ))}
                <div className="inline-add">
                  <TextInput
                    value={newQuestion}
                    aria-label="New question"
                    placeholder="Something to ask your instructor"
                    onChange={(e) => setNewQuestion(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void addQuestion();
                      }
                    }}
                  />
                  <Button onClick={addQuestion} disabled={!newQuestion.trim()}>
                    Add
                  </Button>
                </div>
              </div>
            </CardBody>
          </Card>
        </div>

        <div className="detail__column">
          <Card>
            <CardHeader title="Review status" />
            <CardBody>
              <div className="stack stack--4">
                <Select
                  aria-label="Review status"
                  options={REVIEW_STATUS_OPTIONS}
                  value={material.reviewStatus}
                  onChange={(value) =>
                    mutate((repos) => repos.documents.update(material.id, { reviewStatus: value }))
                  }
                />
                <Button
                  block
                  onClick={() =>
                    mutate((repos) =>
                      repos.documents.update(material.id, { lastReviewedAt: nowIso() }),
                    )
                  }
                >
                  Mark as reviewed today
                </Button>
                {material.lastReviewedAt ? (
                  <p className="tiny dim">
                    Last reviewed {formatLongDate(material.lastReviewedAt.slice(0, 10), today)}.
                  </p>
                ) : (
                  <p className="tiny dim">Not reviewed yet.</p>
                )}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <dl className="definition">
                <dt>Type</dt>
                <dd>{MATERIAL_TYPE_LABELS[material.materialType]}</dd>
                <dt>Topic</dt>
                <dd>{TOPIC_LABELS[material.topic]}</dd>
                <dt>Priority</dt>
                <dd>{PRIORITY_LABELS[material.priority]}</dd>
                <dt>Status</dt>
                <dd>{REVIEW_STATUS_LABELS[material.reviewStatus]}</dd>
                {goal ? (
                  <>
                    <dt>Goal</dt>
                    <dd>
                      <Link to="/flight-path">{goal.title}</Link>
                    </dd>
                  </>
                ) : null}
                {event ? (
                  <>
                    <dt>Lesson</dt>
                    <dd>
                      <Link to={`/schedule/${event.id}`}>{event.title}</Link>
                    </dd>
                  </>
                ) : null}
                <dt>Added</dt>
                <dd>{formatLongDate(material.createdAt.slice(0, 10), today)}</dd>
              </dl>

              {material.tags.length > 0 ? (
                <div className="tag-list" style={{ marginTop: "var(--space-4)" }}>
                  {material.tags.map((tag) => (
                    <span className="tag" key={tag}>
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}
            </CardBody>
          </Card>
        </div>
      </div>

      <MaterialFormDialog
        open={editing}
        material={material}
        goals={data.goals}
        events={data.events}
        newMaterialId={newId()}
        onClose={() => setEditing(false)}
        onSave={saveMaterial}
      />

      <ActionFormDialog
        open={addingAction}
        relatedType="material"
        relatedId={material.id}
        onClose={() => setAddingAction(false)}
        onSave={(draft: ActionDraft) => {
          operations.create(draft);
          setAddingAction(false);
        }}
      />

      <ConfirmDialog
        open={confirmingDelete}
        title="Delete this material?"
        message="Its notes, tags and links are removed. The file is deleted from this application's private storage."
        onConfirm={async () => {
          setConfirmingDelete(false);
          // Remove the stored file as well, so deleting really deletes.
          if (material.filePath) await deleteDocument(material.filePath);
          await mutate((repos) => repos.documents.remove(material.id));
          navigate("/study");
        }}
        onCancel={() => setConfirmingDelete(false)}
      />
    </>
  );
}
