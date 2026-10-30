/**
 * The add-observation form (scope §4, M3-R8). It records one deliberate
 * observation against the debrief she picked.
 *
 * Form ownership, on every submission path (save, replace, save as new):
 * - each submission captures the canonical fingerprint of the complete draft
 *   (wording, date, who said it, instructor name, skill and debrief);
 * - the live draft is updated synchronously in every change handler, never
 *   in an effect, so an answer that lands right after an edit still compares
 *   against what is on screen;
 * - the form clears (the wording only) and starts a new draft only when the
 *   complete live draft equals the submitted one; otherwise every field is
 *   kept and it says exactly what isn't saved;
 * - the draft key belongs to this form instance, and an epoch counter and a
 *   mounted flag drop answers for an earlier draft or a gone form.
 */
import { useEffect, useId, useRef, useState } from "react";

import { Button, Field, Select, TextArea, TextInput, TypedDateField, type TypedDateFieldHandle } from "@/components/ui";
import type { SkillAttribution, SkillListEntry, SkillSourceField } from "@/domain/types";
import { canonicalJson } from "@/logic/cardIdentity";
import { ATTRIBUTION_CHOICES, SOURCE_FIELD_WORDS } from "@/logic/skillEvidence";
import type { EvidenceController, ObservationDraft, SaveOutcome } from "@/state/useSkillEvidence";

export interface DebriefSource {
  journalId: string;
  date: string;
  title: string;
  /** Which debrief fields have text she could say an observation came from. */
  fields: Exclude<SkillSourceField, "none">[];
}

interface Fields {
  skillId: string;
  sourceField: SkillSourceField;
  wording: string;
  observedOn: string;
  attribution: SkillAttribution;
  instructorName: string;
}

const FIELD_WORDS: Record<keyof Fields, string> = {
  skillId: "the skill",
  sourceField: "where it came from",
  wording: "the wording",
  observedOn: "the date",
  attribution: "who said it",
  instructorName: "the instructor name",
};

function joinWords(words: string[]): string {
  return words.length <= 1 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)!}`;
}

/** What the form says after an earlier submission, rather than the current draft, was stored. */
type FollowUp = null | { kind: "earlier"; changed: string[] } | { kind: "erased" };

export function ObservationForm({
  controller,
  debrief,
  skills,
  saving,
  initialSkillId,
}: {
  controller: EvidenceController;
  debrief: DebriefSource;
  /** Active skills, built-in first. */
  skills: SkillListEntry[];
  saving: boolean;
  /** The skill chosen when the form opens; the first skill otherwise. */
  initialSkillId?: string;
}) {
  const ids = useId();
  const [fields, setFields] = useState<Fields>({
    skillId: initialSkillId ?? skills[0]?.id ?? "",
    sourceField: "none",
    wording: "",
    observedOn: debrief.date,
    attribution: "instructor_transcribed",
    instructorName: "",
  });
  // The complete live draft, updated synchronously in every change handler.
  const live = useRef(fields);
  const change = (patch: Partial<Fields>) => {
    live.current = { ...live.current, ...patch };
    setFields(live.current);
  };
  const dateField = useRef<TypedDateFieldHandle>(null);
  const epoch = useRef(0);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [followUp, setFollowUp] = useState<FollowUp>(null);
  const length = Array.from(fields.wording).length;
  // One key per form instance: a remounted form never inherits another instance's draft.
  const draftKey = `${debrief.journalId}:${ids}`;

  const draftOf = (f: Fields): ObservationDraft => ({
    skillId: f.skillId,
    journalId: debrief.journalId,
    sourceField: f.sourceField,
    wording: f.wording,
    observedOn: f.observedOn,
    attribution: f.attribution,
    instructorName: f.attribution === "instructor_transcribed" ? f.instructorName : "",
  });

  function submit(path: "create" | "replace" | "new") {
    // A date that isn't one is refused in the field, never saved as another day.
    if (dateField.current?.check() === false || !live.current.observedOn) return;
    if (path === "new") {
      if (!controller.startNewDraft(draftKey)) return;
      epoch.current += 1;
    }
    const draft = draftOf(live.current);
    const fingerprint = canonicalJson(draft);
    const mine = epoch.current;
    const pending = path === "replace" ? controller.reviseSaved(draftKey, draft) : controller.saveObservation(draftKey, draft);
    void pending.then((outcome) => afterSave(outcome, fingerprint, mine));
  }

  /** Fields of the live draft that differ from what this form last stored. */
  function unsavedFields(): string[] {
    const saved = controller.savedContent(draftKey);
    if (!saved) return [];
    const now = draftOf(live.current);
    return (["skillId", "sourceField", "wording", "observedOn", "attribution", "instructorName"] as const)
      .filter((k) => saved[k] !== now[k])
      .map((k) => FIELD_WORDS[k]);
  }

  function afterSave(outcome: SaveOutcome, submitted: string, mine: number) {
    if (!mounted.current || mine !== epoch.current) return;
    if (outcome.kind === "saved" && canonicalJson(draftOf(live.current)) === submitted) {
      epoch.current += 1;
      controller.startNewDraft(draftKey);
      change({ wording: "" }); // the skill, date and attribution stay for the next note
      setFollowUp(null);
    } else if (outcome.kind === "saved" || outcome.kind === "earlier_saved") {
      setFollowUp({ kind: "earlier", changed: unsavedFields() });
    } else if (outcome.kind === "erased") {
      setFollowUp({ kind: "erased" });
    }
  }

  const unsaved = followUp?.kind === "earlier" ? followUp.changed : [];
  const saved = controller.savedContent(draftKey);
  const fixedSourceChanged = saved !== null && (saved.skillId !== fields.skillId || saved.journalId !== debrief.journalId || saved.sourceField !== fields.sourceField);
  const sourceOptions: { value: SkillSourceField; label: string }[] = [
    { value: "none", label: SOURCE_FIELD_WORDS.none },
    ...debrief.fields.map((f) => ({ value: f, label: SOURCE_FIELD_WORDS[f] })),
  ];
  return (
    <form
      aria-labelledby={`${ids}-title`}
      className="skill-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit("create");
      }}
    >
      <h3 id={`${ids}-title`} className="small">
        Add an observation from “{debrief.title || "Lesson debrief"}”
      </h3>
      <Field label="Skill">
        <Select
          value={fields.skillId}
          options={skills.map((s) => ({ value: s.id, label: s.origin === "custom" ? `${s.label} (your skill)` : s.label }))}
          onChange={(value) => change({ skillId: value })}
        />
      </Field>
      <fieldset className="skill-form__choices">
        <legend className="field__label">Who said it?</legend>
        {(["instructor_transcribed", "self_report"] as const).map((choice) => (
          <label key={choice} className="small">
            <input
              type="radio"
              name={`${ids}-attr`}
              checked={fields.attribution === choice}
              onChange={() => change({ attribution: choice })}
            />{" "}
            {ATTRIBUTION_CHOICES[choice]}
          </label>
        ))}
      </fieldset>
      {fields.attribution === "instructor_transcribed" ? (
        <Field label="Instructor name (optional)">
          <TextInput value={fields.instructorName} maxLength={120} onChange={(e) => change({ instructorName: e.target.value })} />
        </Field>
      ) : null}
      <Field label="What was said or noticed" hint={`${length} of 2000 characters`}>
        <TextArea value={fields.wording} rows={4} onChange={(e) => change({ wording: e.target.value })} />
      </Field>
      <Field label="Came from">
        <Select value={fields.sourceField} options={sourceOptions} onChange={(value) => change({ sourceField: value })} />
      </Field>
      <TypedDateField ref={dateField} label="Date observed" required value={fields.observedOn} onChange={(observedOn) => change({ observedOn })} />
      <Button type="submit" variant="primary" disabled={saving || !fields.skillId || fields.wording.trim() === "" || length > 2000}>
        {saving ? "Saving…" : "Save observation"}
      </Button>
      {followUp ? (
        <div aria-label="Your unsaved changes" className="skill-form__follow-up">
          <p className="small">
            {followUp.kind === "erased"
              ? "What's in the form above isn't saved."
              : unsaved.length > 0
                ? `Not saved yet: your changes to ${joinWords(unsaved)}.`
                : "What's in the form above isn't saved yet."}
          </p>
          {followUp.kind === "earlier" ? (
            <>
              {fixedSourceChanged ? <p className="small">The saved observation keeps its skill and debrief source. Save this draft as a new observation.</p> : null}
              <p className="tiny muted" id={`${ids}-replace-hint`}>
                Replacing updates the saved observation to match everything in the form: wording, date, who said it and instructor name.
              </p>
              <Button size="small" disabled={saving || fixedSourceChanged} aria-describedby={`${ids}-replace-hint`} onClick={() => submit("replace")}>
                Replace the saved wording with this
              </Button>
            </>
          ) : null}
          <Button size="small" disabled={saving} onClick={() => submit("new")}>
            Save it as a new observation
          </Button>
        </div>
      ) : null}
    </form>
  );
}
