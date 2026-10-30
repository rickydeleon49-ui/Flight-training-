/**
 * One evidence list (a skill page, or a debrief's card): the observations,
 * their item menus, the earlier-versions view and the edit, follow-up and
 * erase dialogs. Every write goes through the list's controller, so retries
 * replay exact requests and late answers never reach another list.
 */
import { useId, useRef, useState } from "react";

import { Badge, Button, ConfirmDialog, Dialog, Field, Select, TextArea, TextInput, TypedDateField, type TypedDateFieldHandle } from "@/components/ui";
import type { EvidenceItem, NextAction, SkillAttribution } from "@/domain/types";
import {
  ATTRIBUTION_CHOICES,
  CHANGE_WORDS,
  actionText,
  attributionText,
  sourceText,
} from "@/logic/skillEvidence";
import type { ActionOutcome, EvidenceController, EvidenceViewState } from "@/state/useSkillEvidence";

interface EvidenceListProps {
  state: EvidenceViewState;
  controller: EvidenceController;
  /** Her follow-up actions, for linking. */
  actions: NextAction[];
  /** Show each observation's skill (the debrief card lists several skills). */
  showSkill?: boolean;
  emptyText: string;
}

export function EvidenceList({ state, controller, actions, showSkill = false, emptyText }: EvidenceListProps) {
  const [editing, setEditing] = useState<EvidenceItem | null>(null);
  const [linking, setLinking] = useState<EvidenceItem | null>(null);
  const [erasing, setErasing] = useState<EvidenceItem | null>(null);

  return (
    <div className="skill-evidence">
      {state.notice === "saved" ? <p role="status" className="small">Saved.</p> : null}
      {state.notice === "already_saved" ? (
        <p role="status" className="small">Your earlier save had already gone through, so it was kept.</p>
      ) : null}
      {state.notice === "earlier_saved_now" ? <p role="status" className="small">Your earlier wording has now been saved.</p> : null}
      {state.notice === "saved_stale" ? (
        <p role="status" className="small">
          Saved. We couldn't refresh the list.{" "}
          <Button size="small" onClick={() => void controller.retryRead()}>
            Refresh list
          </Button>
        </p>
      ) : null}
      {state.listNotice === "restarted" ? (
        <p role="status" className="small">
          Your evidence changed while you were looking through it, so the list starts again from the newest.
        </p>
      ) : null}
      {state.writeError ? (
        <p role="alert" className="small skill-evidence__error">
          {state.writeError.message}
        </p>
      ) : null}

      {state.status === "loading" ? <p role="status" className="small muted">Loading your evidence…</p> : null}
      {state.status === "error" ? (
        <div role="alert" className="skill-evidence__error">
          <p className="small">We couldn't load this right now. Your saved observations are safe.</p>
          <Button size="small" onClick={() => void controller.retryRead()}>
            Try again
          </Button>
        </div>
      ) : null}
      {state.status === "ready" && state.items.length === 0 ? <p className="small muted">{emptyText}</p> : null}

      {state.items.length > 0 ? (
        <ol className="skill-evidence__list" aria-label="Evidence history">
          {state.items.map((item) => (
            <li key={item.id} className="skill-evidence__item">
              <p className="small">
                <strong>{attributionText(item)}</strong> · {item.observedOn}
                {item.revision > 1 ? " · edited" : ""}
                {showSkill ? (
                  <>
                    {" "}
                    · <Badge tone="flight">{item.skillLabel}</Badge>
                  </>
                ) : null}
              </p>
              <blockquote className="skill-evidence__wording wrap-anywhere">{item.wording}</blockquote>
              <p className="tiny muted">{sourceText(item)}</p>
              {item.skillLabelAtRecording !== item.skillLabel ? (
                <p className="tiny muted">Recorded under the skill name “{item.skillLabelAtRecording}”.</p>
              ) : null}
              {actionText(item) ? <p className="tiny">{actionText(item)}</p> : null}
              {item.addressedAt ? <p className="tiny">You marked this addressed.</p> : null}
              <details className="skill-evidence__menu">
                <summary>Options</summary>
                <div className="row skill-evidence__menu-items">
                  <Button size="small" onClick={() => setEditing(item)}>
                    Edit
                  </Button>
                  {item.action.kind === "none" ? (
                    <Button size="small" onClick={() => setLinking(item)}>
                      Link a follow-up
                    </Button>
                  ) : (
                    <Button
                      size="small"
                      disabled={state.saving}
                      onClick={() =>
                        void controller.runAction(`unlink:${item.id}`, { item: item.id, revision: item.revision }, (operationId) => ({
                          action: "unlink_action", operationId, observationId: item.id, expectedRevision: item.revision,
                        }))
                      }
                    >
                      Unlink the follow-up
                    </Button>
                  )}
                  <Button
                    size="small"
                    disabled={state.saving}
                    onClick={() =>
                      void controller.runAction(
                        `addressed:${item.id}`,
                        { item: item.id, revision: item.revision, addressed: item.addressedAt === null },
                        (operationId) => ({
                          action: "set_addressed", operationId, observationId: item.id, expectedRevision: item.revision,
                          addressed: item.addressedAt === null,
                        }),
                      )
                    }
                  >
                    {item.addressedAt === null ? "Mark addressed" : "Not addressed"}
                  </Button>
                  <Button size="small" onClick={() => void controller.openHistory(item.id)}>
                    View earlier versions
                  </Button>
                  <Button size="small" variant="danger" onClick={() => setErasing(item)}>
                    Erase permanently
                  </Button>
                </div>
              </details>
            </li>
          ))}
        </ol>
      ) : null}
      {state.nextCursor ? (
        <Button disabled={state.loadingMore} onClick={() => void controller.loadMore()}>
          {state.loadingMore ? "Loading…" : "Show older"}
        </Button>
      ) : null}

      {state.history ? (
        <section className="skill-evidence__history" aria-label="Earlier versions">
          <h3 className="small">Earlier versions</h3>
          {state.history.status === "loading" ? <p role="status" className="small muted">Loading earlier versions…</p> : null}
          {state.history.error ? <p role="alert" className="small">{state.history.error}</p> : null}
          {state.history.items.length > 0 ? (
            <ol aria-label="Versions" className="skill-evidence__versions">
              {state.history.items.map((version) => (
                <li key={version.revision}>
                  <p className="tiny muted">
                    Version {version.revision} · {CHANGE_WORDS[version.changeKind]} · {version.observedOn}
                  </p>
                  <blockquote className="skill-evidence__wording wrap-anywhere">{version.wording}</blockquote>
                </li>
              ))}
            </ol>
          ) : null}
          <div className="row">
            {state.history.nextCursor ? (
              <Button size="small" disabled={state.history.loadingMore} onClick={() => void controller.loadOlderHistory()}>
                {state.history.loadingMore ? "Loading…" : "Show older versions"}
              </Button>
            ) : null}
            <Button size="small" variant="ghost" onClick={() => controller.closeHistory()}>
              Close
            </Button>
          </div>
        </section>
      ) : null}

      {editing ? <EditObservationDialog item={editing} controller={controller} onClose={() => setEditing(null)} /> : null}
      {linking ? (
        <LinkFollowUpDialog item={linking} actions={actions} controller={controller} onClose={() => setLinking(null)} />
      ) : null}
      {erasing ? <EraseDialog item={erasing} controller={controller} onClose={() => setErasing(null)} /> : null}
    </div>
  );
}

const excerpt = (text: string) => (Array.from(text).length > 80 ? `${Array.from(text).slice(0, 80).join("")}…` : text);

/** Keeps a dialog open with its outcome when the answer is not "done". */
function useActionResult() {
  const [pending, setPending] = useState(false);
  const [revision, setRevision] = useState<number | null>(null);
  const [message, setMessage] = useState<{ text: string; stale: boolean } | null>(null);
  async function run(work: () => Promise<ActionOutcome>, onDone: () => void) {
    setPending(true);
    setMessage(null);
    const outcome = await work();
    setPending(false);
    if (outcome.kind === "done") onDone();
    else {
      if (outcome.kind === "earlier_done" && "revision" in outcome.outcome.result) setRevision(outcome.outcome.result.revision);
      setMessage({ text: outcome.message, stale: outcome.kind === "refused" && outcome.code === "STALE_REVISION" });
    }
  }
  return { pending, message, revision, run };
}

function EditObservationDialog({ item, controller, onClose }: { item: EvidenceItem; controller: EvidenceController; onClose: () => void }) {
  const ids = useId();
  const [wording, setWording] = useState(item.wording);
  const [observedOn, setObservedOn] = useState(item.observedOn);
  const dateField = useRef<TypedDateFieldHandle>(null);
  const [attribution, setAttribution] = useState<SkillAttribution>(item.attribution);
  const [instructorName, setInstructorName] = useState(item.instructorName);
  const result = useActionResult();
  const length = Array.from(wording).length;
  const name = attribution === "instructor_transcribed" ? instructorName : "";
  const save = () => {
    // A date that isn't one is refused in the field, never saved as another day.
    if (dateField.current?.check() === false || !observedOn) return;
    void result.run(
      () =>
        controller.runAction(
          `edit:${item.id}`,
          { item: item.id, revision: result.revision ?? item.revision, wording, observedOn, attribution, name },
          (operationId) => ({
            action: "edit_observation", operationId, observationId: item.id, expectedRevision: result.revision ?? item.revision,
            wording, observedOn, attribution, instructorName: name,
          }),
        ),
      onClose,
    );
  };
  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!result.pending}
      title="Edit this observation"
      description="Your earlier wording stays in its history."
      footer={
        <>
          <Button onClick={onClose} disabled={result.pending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={result.pending || wording.trim() === "" || length > 2000}>
            {result.pending ? "Saving…" : "Save changes"}
          </Button>
        </>
      }
    >
      <fieldset className="skill-form__choices">
        <legend className="field__label">Who said it?</legend>
        {(["instructor_transcribed", "self_report"] as const).map((choice) => (
          <label key={choice} className="small">
            <input disabled={result.pending} type="radio" name={`${ids}-attr`} checked={attribution === choice} onChange={() => setAttribution(choice)} />{" "}
            {ATTRIBUTION_CHOICES[choice]}
          </label>
        ))}
      </fieldset>
      {attribution === "instructor_transcribed" ? (
        <Field label="Instructor name (optional)">
          <TextInput disabled={result.pending} value={instructorName} maxLength={120} onChange={(e) => setInstructorName(e.target.value)} />
        </Field>
      ) : null}
      <Field label="What was said or noticed" hint={`${length} of 2000 characters`}>
        <TextArea disabled={result.pending} value={wording} onChange={(e) => setWording(e.target.value)} rows={4} />
      </Field>
      <TypedDateField ref={dateField} disabled={result.pending} label="Date observed" required value={observedOn} onChange={setObservedOn} />
      {result.message ? (
        <div role="alert" className="small skill-evidence__error">
          <p>{result.message.text}</p>
          {result.message.stale ? (
            <Button
              size="small"
              onClick={() => {
                void controller.retryRead();
                onClose();
              }}
            >
              Reload
            </Button>
          ) : null}
        </div>
      ) : null}
    </Dialog>
  );
}

function LinkFollowUpDialog({
  item,
  actions,
  controller,
  onClose,
}: {
  item: EvidenceItem;
  actions: NextAction[];
  controller: EvidenceController;
  onClose: () => void;
}) {
  const [actionId, setActionId] = useState(actions[0]?.id ?? "");
  const result = useActionResult();
  const link = () =>
    void result.run(
      () =>
        controller.runAction(`link:${item.id}`, { item: item.id, revision: result.revision ?? item.revision, actionId }, (operationId) => ({
          action: "link_action", operationId, observationId: item.id, expectedRevision: result.revision ?? item.revision, actionId,
        })),
      onClose,
    );
  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!result.pending}
      title="Link a follow-up"
      description="Pick one of your existing actions. Finishing it later won't mark this observation addressed: that stays your choice."
      footer={
        <>
          <Button onClick={onClose} disabled={result.pending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={link} disabled={result.pending || !actionId}>
            {result.pending ? "Linking…" : "Link"}
          </Button>
        </>
      }
    >
      {actions.length === 0 ? (
        <p className="small muted">You don't have any follow-up actions yet. Add one from a debrief or your Flight Path first.</p>
      ) : (
        <Field label="Follow-up">
          <Select
            disabled={result.pending}
            value={actionId}
            options={actions.map((a) => ({ value: a.id, label: a.status === "completed" ? `${a.title} (done)` : a.title }))}
            onChange={(value) => setActionId(value)}
          />
        </Field>
      )}
      {result.message ? (
        <p role="alert" className="small skill-evidence__error">
          {result.message.text}
        </p>
      ) : null}
    </Dialog>
  );
}

function EraseDialog({ item, controller, onClose }: { item: EvidenceItem; controller: EvidenceController; onClose: () => void }) {
  const result = useActionResult();
  return (
    <>
      <ConfirmDialog
        open
        title="Erase this observation permanently?"
        message={`This erases “${excerpt(item.wording)}” and every earlier version of it. It can't be undone. The debrief itself isn't changed. Backups you made before now still contain it.`}
        confirmLabel="Erase permanently"
        pending={result.pending}
        pendingLabel="Erasing…"
        onConfirm={() =>
          void result.run(
            () =>
              controller.runAction(`erase:${item.id}`, { item: item.id }, (operationId) => ({
                action: "erase_observation", operationId, observationId: item.id, confirm: "erase",
              })),
            onClose,
          )
        }
        onCancel={onClose}
      />
      {result.message && !result.pending ? (
        <p role="alert" className="small skill-evidence__error">
          {result.message.text}
        </p>
      ) : null}
    </>
  );
}
