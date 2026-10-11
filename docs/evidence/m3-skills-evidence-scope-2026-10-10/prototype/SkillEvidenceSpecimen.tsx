/**
 * UI SPECIMEN for M3 (disposable): the evidence panel a skill page and the
 * debrief detail would share. It demonstrates the wording, states and
 * keyboard/label structure the production slice should keep. It uses plain
 * elements and the app's existing CSS class names; it is not wired into any
 * route and is exercised only by tests/ui.test.tsx (jsdom).
 */
import { useEffect, useId, useMemo, useState, useSyncExternalStore } from "react";

import { createEvidenceController, type EvidenceClient, type ObservationDraft } from "./evidenceController";
import type { Attribution, EvidenceItem, SkillListEntry, SkillSummary } from "./types";

const STATUS_WORDS = { learning: "Learning", practicing: "Practicing", needs_review: "Needs review" } as const;

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

  useEffect(() => {
    void controller.open(skillId);
  }, [controller, skillId]);
  useEffect(() => () => controller.dispose(), [controller]);

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
            </li>
          ))}
        </ol>
      )}
      {state.nextCursor && (
        <button type="button" disabled={state.loadingMore} onClick={() => void controller.loadMore()}>
          {state.loadingMore ? "Loading…" : "Show older"}
        </button>
      )}
    </section>
  );
}

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
  const length = Array.from(wording).length;

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
        void controller.submitObservation(`${debrief.journalId}:${skillId}`, draft).then((ok) => {
          if (ok) setWording("");
        });
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
    </form>
  );
}
