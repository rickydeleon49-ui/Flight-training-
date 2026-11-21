import { ActionRow } from "@/components/actions/ActionRow";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, PlusIcon, TextArea, TextInput } from "@/components/ui";
import { DocumentPagesPanel } from "./navigation/DocumentPagesPanel";
import type { MaterialDetailCtx } from "./materialDetailCtx";

export function MaterialNotesTab({ ctx }: { ctx: MaterialDetailCtx }) {
  const {
  setPageNotesAvailable, tab, operations, today, tipsHidden, setAddingAction,
  newQuestion, setNewQuestion, questionBusy, fileMissing, restoringFile, material,
  flashcardRoute, returnToFlashcards, notes, setNotes, notesStatus, recoverable,
  retry, notesConflict, keepDraft, useSaved, isPdf, relatedActions,
  questions, addQuestion, restoreFile,
  } = ctx;
  return (
    <>
          <h2 id="material-panel-heading-notes" tabIndex={-1} className="visually-hidden material-panel-heading">Notes</h2>
          <div className="detail material-notes-grid"><div className="detail__column">
          <Card>
            <CardHeader
              title="Personal notes"
              action={
                notesStatus === "idle" ? null : (
                  <span
                    role="status"
                    className={`tiny material-detail__notes-status${notesStatus === "saved" ? " is-saved" : ""}`}
                  >
                    {notesStatus === "saving" ? "Saving…" : notesStatus === "error" ? "Save failed" : "Saved"}
                  </span>
                )
              }
            />
            {!tipsHidden && !notesConflict ? <p className="tiny muted material-detail__intro">Write what you want to remember. Your notes save as you type; watch for Saved.</p> : null}
            <CardBody>
              {notesConflict ? (
                <div role="status">
                  <p>You have unsaved notes from earlier.</p>
                  <Button onClick={keepDraft}>Keep these</Button>{" "}
                  <Button onClick={useSaved}>Use the saved notes</Button>
                  <details><summary>Saved notes</summary><p className="material-detail__pre-wrap">{material.notes || "No saved notes."}</p></details>
                </div>
              ) : null}
              <TextArea
                readOnly={notesConflict}
                rows={6}
                value={notes}
                aria-label="Personal notes"
                placeholder="What matters in this material, and what you want to remember."
                onChange={(e) => setNotes(e.target.value)}
              />
              {!recoverable && notesStatus !== "saved" ? (
                <p role="alert">Draft recovery is unavailable. Keep this window open until your notes show Saved.</p>
              ) : null}
              {notesStatus === "error" ? (
                <p role="alert">Your notes could not be saved. {recoverable ? "A draft is kept on this computer." : "Keep this window open."} <Button onClick={() => void retry()}>Retry save</Button></p>
              ) : null}
            </CardBody>
          </Card>

          {isPdf && material.filePath ? (
            <DocumentPagesPanel active={tab === "notes"} material={material} fileMissing={fileMissing} restoring={restoringFile}
              onRestore={() => void restoreFile()} showTips={!tipsHidden} onPageNotesAvailable={setPageNotesAvailable}
              flashcardRoute={flashcardRoute} onFlashcardRouteDone={returnToFlashcards} />
          ) : null}

          </div><div className="detail__column">
          <Card>
            <CardHeader title="Questions for my instructor" />
            {!tipsHidden ? <p className="tiny muted material-detail__intro">Keep questions here to ask later; they also appear on your Ask my instructor page.</p> : null}
            <CardBody>
              <div className="stack stack--3">
                {questions.map((question) => (
                  <div className="row row--between" key={question.id}>
                    <span className="small wrap-anywhere material-detail__pre-line">{question.text}</span>
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
                  <Button onClick={addQuestion} disabled={questionBusy || !newQuestion.trim()}>
                    Add
                  </Button>
                </div>
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardHeader
              title="Next steps for this material"
              action={
                <Button size="small" onClick={() => setAddingAction(true)}>
                  <PlusIcon size={14} /> Add
                </Button>
              }
            />
            {!tipsHidden ? <p className="tiny muted material-detail__intro">Give this material a small next step, and add a date if you have one in mind.</p> : null}
            <CardBody flush>
              {relatedActions.length === 0 ? (
                <EmptyState
                  compact
                  title="What should you do with this material?"
                  body="&ldquo;Review pages 4&ndash;8 before Saturday&rdquo; is more useful than &ldquo;study&rdquo;."
                />
              ) : (
                <div className="material-detail__pb-3">
                  {relatedActions.map((action) => (
                    <ActionRow
                      key={action.id}
                      action={action}
                      today={today}
                      onToggle={operations.toggle}
                      onDelete={operations.remove}
                    />
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          </div></div>
    </>
  );
}
