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
import {
  geminiErrorMessage,
  generateStudyAid,
  getGeminiStatus,
  type GeminiStatus,
} from "@/services/gemini";
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
  const [gemini, setGemini] = useState<GeminiStatus | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [cardIndex, setCardIndex] = useState(0);
  const [cardRevealed, setCardRevealed] = useState(false);

  const material = data.materials.find((candidate) => candidate.id === materialId) ?? null;
  const studySet = data.aiStudySets.find((candidate) => candidate.sourceMaterialId === materialId);

  useEffect(() => {
    void getGeminiStatus().then(setGemini).catch(() => setGemini(null));
  }, []);

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
    const result = await mutate((repos) => repos.documents.update(material.id, draft));
    if (result === null) return;
    setEditing(false);
  };

  const saveNotes = async () => {
    const result = await mutate((repos) => repos.documents.update(material.id, { notes }));
    if (result === null) return;
    setNotesSaved(true);
    window.setTimeout(() => setNotesSaved(false), 2000);
  };

  const addQuestion = async () => {
    const text = newQuestion.trim();
    if (!text) return;
    const result = await mutate((repos) =>
      repos.questions.create({ text, topic: material.topic, materialId: material.id }),
    );
    if (result === null) return;
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

  const createStudyAid = async () => {
    if (!material.filePath) return;
    setGenerating(true);
    setGenerationError(null);
    try {
      const generated = await generateStudyAid(material.filePath, material.title);
      const saved = await mutate((repos) =>
        repos.documents.saveAiStudySet({
          sourceMaterialId: material.id,
          title: generated.title,
          summary: generated.summary,
          sections: generated.sections,
          flashcards: generated.flashcards,
          sourceNotes: generated.sourceNotes,
          model: generated.model,
        }),
      );
      if (saved === null) return;
      setCardIndex(0);
      setCardRevealed(false);
    } catch (error) {
      setGenerationError(geminiErrorMessage(error));
    } finally {
      setGenerating(false);
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

          {material.filePath ? (
            <Card>
              <CardHeader
                title="Gemini study assistant"
                eyebrow={studySet ? "Saved on this computer" : "Guide and flashcards"}
                action={
                  gemini?.configured ? (
                    <Button size="small" variant={studySet ? "secondary" : "primary"} disabled={generating || fileMissing} onClick={() => void createStudyAid()}>
                      {generating ? "Reading document…" : studySet ? "Regenerate" : "Create study aid"}
                    </Button>
                  ) : undefined
                }
              />
              <CardBody>
                {!gemini?.configured ? (
                  <div className="stack stack--3">
                    <p className="small muted">
                      Connect the free Gemini API in Settings to create a guide and flashcards
                      from this document.
                    </p>
                    <div>
                      <Link className="button button--secondary" to="/settings">Open Settings</Link>
                    </div>
                  </div>
                ) : generating ? (
                  <div className="ai-working" role="status">
                    <span className="ai-working__dot" aria-hidden="true" />
                    <div>
                      <p className="small strong">Gemini is reviewing this document</p>
                      <p className="tiny dim">Large illustrated PDFs can take a little longer.</p>
                    </div>
                  </div>
                ) : studySet ? (
                  <div className="stack stack--5">
                    <div className="ai-disclaimer">
                      <AlertIcon size={16} />
                      <p className="tiny">
                        AI-generated study aid. Verify everything against the source, current FAA
                        material, aircraft documents, and your instructor before using it.
                      </p>
                    </div>

                    <section className="stack stack--3" aria-labelledby="ai-guide-title">
                      <div>
                        <p className="eyebrow">Study guide</p>
                        <h3 id="ai-guide-title" className="ai-guide__title">{studySet.title}</h3>
                      </div>
                      <p className="small ai-copy">{studySet.summary}</p>
                      {studySet.sections.map((section, index) => (
                        <div className="ai-guide__section" key={`${section.heading}-${index}`}>
                          <h4>{section.heading}</h4>
                          <p className="small ai-copy">{section.body}</p>
                        </div>
                      ))}
                      {studySet.sourceNotes ? (
                        <p className="tiny dim ai-copy">{studySet.sourceNotes}</p>
                      ) : null}
                    </section>

                    {studySet.flashcards.length > 0 ? (
                      <section className="stack stack--3" aria-labelledby="flashcards-title">
                        <div className="row row--between">
                          <div>
                            <p className="eyebrow">Flashcards</p>
                            <h3 id="flashcards-title" className="ai-guide__title">
                              Card {cardIndex + 1} of {studySet.flashcards.length}
                            </h3>
                          </div>
                          <Badge tone="study">
                            {studySet.flashcards[cardIndex]?.sourcePage
                              ? `Source p. ${studySet.flashcards[cardIndex]?.sourcePage}`
                              : "Check source"}
                          </Badge>
                        </div>
                        <button
                          className={`flashcard${cardRevealed ? " is-revealed" : ""}`}
                          type="button"
                          onClick={() => setCardRevealed((current) => !current)}
                          aria-label={cardRevealed ? "Hide flashcard answer" : "Reveal flashcard answer"}
                        >
                          <span className="tiny dim">{cardRevealed ? "Answer" : "Question"}</span>
                          <span>{cardRevealed ? studySet.flashcards[cardIndex]?.back : studySet.flashcards[cardIndex]?.front}</span>
                          <span className="tiny dim">Click to {cardRevealed ? "see the question" : "reveal the answer"}</span>
                        </button>
                        <div className="row row--between">
                          <Button
                            size="small"
                            disabled={cardIndex === 0}
                            onClick={() => { setCardIndex((index) => index - 1); setCardRevealed(false); }}
                          >
                            Previous
                          </Button>
                          <Button
                            size="small"
                            disabled={cardIndex >= studySet.flashcards.length - 1}
                            onClick={() => { setCardIndex((index) => index + 1); setCardRevealed(false); }}
                          >
                            Next
                          </Button>
                        </div>
                      </section>
                    ) : null}
                  </div>
                ) : (
                  <p className="small muted">
                    Gemini will read only this file and create a source-based study guide plus
                    10–20 flashcards. The result will be saved locally with your other data.
                  </p>
                )}

                {generationError ? (
                  <p className="field__error" role="alert" style={{ marginTop: "var(--space-3)" }}>
                    {generationError}
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
        onSave={async (draft: ActionDraft) => {
          const result = await operations.create(draft);
          if (result === null) return;
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
          const result = await mutate((repos) => repos.documents.remove(material.id));
          if (result !== null) navigate("/study");
        }}
        onCancel={() => setConfirmingDelete(false)}
      />
    </>
  );
}
