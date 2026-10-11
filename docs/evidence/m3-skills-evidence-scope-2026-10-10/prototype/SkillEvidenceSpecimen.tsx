/**
 * UI SPECIMEN for M3 (disposable): the evidence panel a skill page and the
 * debrief detail would share. It demonstrates the wording, states and
 * keyboard/label structure the production slice should keep. It uses plain
 * elements and the app's existing CSS class names; it is not wired into any
 * route and is exercised only by tests/ui.test.tsx (jsdom).
 */
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { createEvidenceController, type EvidenceClient, type ObservationDraft, type SaveOutcome } from "./evidenceController";
import type { Attribution, EvidenceItem, ObservationRevision, SkillListEntry, SkillSummary } from "./types";

const STATUS_WORDS = { learning: "Learning", practicing: "Practicing", needs_review: "Needs review" } as const;

const CHANGE_WORDS: Record<ObservationRevision["changeKind"], string> = {
  created: "Recorded",
  edited: "Edited",
  linked_action: "Follow-up linked",
  unlinked_action: "Follow-up unlinked",
  marked_addressed: "Marked addressed",
  cleared_addressed: "Addressed mark removed",
};

export function attributionText(item: Pick<EvidenceItem, "attribution" | "instructorName">): string {
  if (item.attribution === "self_report") return "Your note";
  return item.instructorName ? `Instructor feedback, as you wrote it down (${item.instructorName})` : "Instructor feedback, as you wrote it down";
}

export function sourceText(item: EvidenceItem): string {
  if (item.source.kind === "deleted") {
    return `From a debrief that was deleted: “${item.sourceSnapshot.title || "Lesson debrief"}”, ${item.sourceSnapshot.date}`;
  }
  const parts = [`From “${item.source.currentTitle || "Lesson debrief"}”, ${item.source.currentDate}`];
  if (item.source.renamed) parts.push(`(called “${item.sourceSnapshot.title || "Lesson debrief"}” when you recorded this)`);
  if (item.source.textChanged) parts.push("· The debrief has been edited since you recorded this.");
  return parts.join(" ");
}

export function actionText(item: EvidenceItem): string | null {
  if (item.action.kind === "none") return null;
  if (item.action.kind === "deleted") return `Follow-up “${item.action.formerTitle}” was deleted.`;
  if (item.action.actionStatus === "completed") {
    return `Follow-up “${item.action.title}” is done. Finishing it doesn't mean this was resolved in flight.`;
  }
  return `Follow-up: “${item.action.title}” (${item.action.actionStatus === "open" ? "still to do" : "dismissed"})`;
}

export function evidenceText(summary: SkillSummary): string {
  if (summary.evidence === "none") return "No observations yet.";
  if (summary.evidence === "limited") return "Only a few observations so far: not enough to show a pattern.";
  return `${summary.observationCount} observations from ${summary.distinctDebriefs} lessons.`;
}

export interface SpecimenProps {
  client: EvidenceClient;
  skills: SkillListEntry[];
  /** The debrief the form records against, or null on a skill page without a debrief. */
  debrief: { journalId: string; date: string; title: string } | null;
  newId: () => string;
  initialSkillId: string;
}

export function SkillEvidenceSpecimen({ client, skills, debrief, newId, initialSkillId }: SpecimenProps) {
  const controller = useMemo(() => createEvidenceController(client, { newId, pageSize: 20 }), [client, newId]);
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  const [skillId, setSkillId] = useState(initialSkillId);
  const ids = useId();

  // Lifecycle first, so a StrictMode setup replay restores publication
  // before the load below runs; the matching cleanup makes every earlier
  // request obsolete (and, on a real unmount, keeps it that way).
  useEffect(() => {
    controller.activate();
    return () => controller.deactivate();
  }, [controller]);
  useEffect(() => {
    void controller.open(skillId);
  }, [controller, skillId]);

  return (
    <section aria-labelledby={`${ids}-title`} className="card">
      <h2 id={`${ids}-title`}>Skill evidence</h2>
      <label htmlFor={`${ids}-skill`}>Skill</label>
      <select id={`${ids}-skill`} value={skillId} onChange={(e) => setSkillId(e.target.value)}>
        {skills.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
            {s.origin === "custom" ? " (your skill)" : ""}
          </option>
        ))}
      </select>

      {state.summary && (
        <div aria-label="Summary">
          <p>Your status: {state.summary.status ? STATUS_WORDS[state.summary.status] : "Not set"}</p>
          <p>Your confidence: {state.summary.confidence ? `${state.summary.confidence} of 5` : "Not rated"}</p>
          <p>{evidenceText(state.summary)}</p>
          <p className="muted">This is your own record. It isn't an instructor sign-off or a proficiency rating.</p>
        </div>
      )}

      {debrief && <ObservationForm key={`${debrief.journalId}:${skillId}`} controller={controller} debrief={debrief} skillId={skillId} saving={state.saving} />}

      {state.notice === "saved" && <p role="status">Saved.</p>}
      {state.notice === "already_saved" && <p role="status">Your earlier save had already gone through, so it was kept.</p>}
      {state.notice === "earlier_saved_now" && <p role="status">Your earlier wording has now been saved.</p>}
      {state.listNotice === "restarted" && <p role="status">Your evidence changed while you were looking through it, so the list starts again from the newest.</p>}
      {state.notice === "saved_stale" && (
        <p role="status">
          Saved. We couldn't refresh the list.{" "}
          <button type="button" onClick={() => void controller.retryRead()}>Refresh list</button>
        </p>
      )}
      {state.writeError && <p role="alert">{state.writeError.message}</p>}

      {state.status === "loading" && <p role="status">Loading your evidence…</p>}
      {state.status === "error" && (
        <div role="alert">
          <p>We couldn't load this right now. Your saved observations are safe.</p>
          <button type="button" onClick={() => void controller.retryRead()}>Try again</button>
        </div>
      )}
      {state.status === "ready" && state.items.length === 0 && <p>No observations for this skill yet. Add one from a lesson debrief.</p>}
      {state.items.length > 0 && (
        <ol aria-label="Evidence history">
          {state.items.map((item) => (
            <li key={item.id}>
              <p>
                <strong>{attributionText(item)}</strong> · {item.observedOn}
                {item.revision > 1 ? " · edited" : ""}
              </p>
              <blockquote>{item.wording}</blockquote>
              <p>{sourceText(item)}</p>
              {item.skillLabelAtRecording !== item.skillLabel && <p>Recorded under the skill name “{item.skillLabelAtRecording}”.</p>}
              {actionText(item) && <p>{actionText(item)}</p>}
              {item.addressedAt && <p>You marked this addressed.</p>}
              {item.revision > 1 && (
                <button type="button" onClick={() => void controller.openHistory(item.id)}>
                  View earlier versions
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
      {state.nextCursor && (
        <button type="button" disabled={state.loadingMore} onClick={() => void controller.loadMore()}>
          {state.loadingMore ? "Loading…" : "Show older"}
        </button>
      )}
      {state.history && (
        <section aria-label="Earlier versions">
          <h3>Earlier versions</h3>
          {state.history.status === "loading" && <p role="status">Loading earlier versions…</p>}
          {state.history.error && <p role="alert">{state.history.error}</p>}
          {state.history.items.length > 0 && (
            <ol aria-label="Versions">
              {state.history.items.map((version) => (
                <li key={version.revision}>
                  <p>
                    Version {version.revision} · {CHANGE_WORDS[version.changeKind]} · {version.observedOn}
                  </p>
                  <blockquote>{version.wording}</blockquote>
                </li>
              ))}
            </ol>
          )}
          {state.history.nextCursor && (
            <button type="button" disabled={state.history.loadingMore} onClick={() => void controller.loadOlderHistory()}>
              {state.history.loadingMore ? "Loading…" : "Show older versions"}
            </button>
          )}
          <button type="button" onClick={() => controller.closeHistory()}>
            Close
          </button>
        </section>
      )}
    </section>
  );
}

/** What the form says after an earlier submission, rather than the current wording, was stored. */
type FollowUp = null | { kind: "earlier" } | { kind: "erased" };

function ObservationForm({
  controller,
  debrief,
  skillId,
  saving,
}: {
  controller: ReturnType<typeof createEvidenceController>;
  debrief: { journalId: string; date: string; title: string };
  skillId: string;
  saving: boolean;
}) {
  const ids = useId();
  const [attribution, setAttribution] = useState<Attribution>("instructor_transcribed");
  const [wording, setWording] = useState("");
  const [instructorName, setInstructorName] = useState("");
  const [observedOn, setObservedOn] = useState(debrief.date);
  const [followUp, setFollowUp] = useState<FollowUp>(null);
  const length = Array.from(wording).length;
  const draftKey = `${debrief.journalId}:${skillId}`;
  // The wording on screen now, so a late answer can tell whether she kept typing.
  const latest = useRef(wording);
  useEffect(() => {
    latest.current = wording;
  }, [wording]);

  const draft: ObservationDraft = {
    skillId,
    journalId: debrief.journalId,
    sourceField: "none",
    wording,
    observedOn,
    attribution,
    instructorName: attribution === "instructor_transcribed" ? instructorName : "",
  };

  return (
    <form
      aria-labelledby={`${ids}-legend-form`}
      onSubmit={(e) => {
        e.preventDefault();
        const submitted = draft.wording;
        void controller.saveObservation(draftKey, draft).then((outcome) => afterSave(outcome, submitted));
      }}
    >
      <h3 id={`${ids}-legend-form`}>Add an observation from “{debrief.title || "Lesson debrief"}”</h3>
      <fieldset>
        <legend>Who said it?</legend>
        <label>
          <input type="radio" name={`${ids}-attr`} checked={attribution === "instructor_transcribed"} onChange={() => setAttribution("instructor_transcribed")} />
          My instructor (I'm writing down what they said)
        </label>
        <label>
          <input type="radio" name={`${ids}-attr`} checked={attribution === "self_report"} onChange={() => setAttribution("self_report")} />
          Me (my own observation)
        </label>
      </fieldset>
      {attribution === "instructor_transcribed" && (
        <>
          <label htmlFor={`${ids}-name`}>Instructor name (optional)</label>
          <input id={`${ids}-name`} value={instructorName} maxLength={120} onChange={(e) => setInstructorName(e.target.value)} />
        </>
      )}
      <label htmlFor={`${ids}-wording`}>What was said or noticed</label>
      <textarea id={`${ids}-wording`} value={wording} onChange={(e) => setWording(e.target.value)} aria-describedby={`${ids}-count`} />
      <p id={`${ids}-count`}>{length} of 2000 characters</p>
      <label htmlFor={`${ids}-date`}>Date observed</label>
      <input id={`${ids}-date`} type="date" value={observedOn} onChange={(e) => setObservedOn(e.target.value)} />
      <button type="submit" disabled={saving || wording.trim() === "" || length > 2000}>
        {saving ? "Saving…" : "Save observation"}
      </button>
      {followUp && (
        <div aria-label="Your new wording">
          <p>
            {followUp.kind === "earlier"
              ? "The wording in the box above isn't saved yet."
              : "The wording in the box above isn't saved."}
          </p>
          {followUp.kind === "earlier" && (
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                const submitted = draft.wording;
                void controller.reviseSaved(draftKey, draft).then((outcome) => afterSave(outcome, submitted));
              }}
            >
              Replace the saved wording with this
            </button>
          )}
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              if (!controller.startNewDraft(draftKey)) return;
              const submitted = draft.wording;
              void controller.saveObservation(draftKey, draft).then((outcome) => afterSave(outcome, submitted));
            }}
          >
            Save it as a new observation
          </button>
        </div>
      )}
    </form>
  );

  /**
   * Clear only what was acknowledged, and only if she has not typed since.
   * Anything else keeps her words and explains what did (or did not) save.
   */
  function afterSave(outcome: SaveOutcome, submitted: string) {
    if (outcome.kind === "saved") {
      if (latest.current === submitted) {
        setWording("");
        setFollowUp(null);
        controller.startNewDraft(draftKey);
      } else {
        setFollowUp({ kind: "earlier" });
      }
    } else if (outcome.kind === "earlier_saved") {
      setFollowUp({ kind: "earlier" });
    } else if (outcome.kind === "erased") {
      setFollowUp({ kind: "erased" });
    }
  }
}
