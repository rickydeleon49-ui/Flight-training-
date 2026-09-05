import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import { PageHeader } from "@/components/layout/PageHeader";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Field,
  Select,
  TextArea,
  TextInput,
} from "@/components/ui";
import { todayIso } from "@/lib/dates";
import { useAppData } from "@/state/AppDataContext";

import "./journal.css";

interface DebriefDraft {
  eventId: string | null;
  date: string;
  title: string;
  mission: string;
  practiced: string;
  wentWell: string;
  wasDifficult: string;
  instructorFeedback: string;
  questionsForNextTime: string;
  confidence: number | null;
  goalId: string | null;
}

const emptyDraft = (): DebriefDraft => ({
  eventId: null,
  date: todayIso(),
  title: "",
  mission: "",
  practiced: "",
  wentWell: "",
  wasDifficult: "",
  instructorFeedback: "",
  questionsForNextTime: "",
  confidence: null,
  goalId: null,
});

/**
 * Writing or editing a lesson debrief.
 *
 * Saving can also create the next action and save the question, which is what
 * turns reflection into something to do.
 */
export function JournalForm() {
  const { entryId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { data, mutate } = useAppData();

  const existing = entryId ? data.journalEntries.find((entry) => entry.id === entryId) : null;

  const [draft, setDraft] = useState<DebriefDraft>(emptyDraft);
  const [nextActionTitle, setNextActionTitle] = useState("");
  const [addToPlan, setAddToPlan] = useState(true);
  const [saveQuestion, setSaveQuestion] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (existing) {
      setDraft({
        eventId: existing.eventId,
        date: existing.date,
        title: existing.title,
        mission: existing.mission,
        practiced: existing.practiced,
        wentWell: existing.wentWell,
        wasDifficult: existing.wasDifficult,
        instructorFeedback: existing.instructorFeedback,
        questionsForNextTime: existing.questionsForNextTime,
        confidence: existing.confidence,
        goalId: existing.goalId,
      });
      return;
    }

    // Arriving from a lesson pre-fills what we already know about it.
    const eventId = searchParams.get("event");
    const event = eventId ? data.events.find((candidate) => candidate.id === eventId) : null;
    if (event) {
      setDraft({
        ...emptyDraft(),
        eventId: event.id,
        date: event.date,
        title: event.title,
        goalId: event.goalId,
      });
    }
  }, [existing, searchParams, data.events]);

  const update = <K extends keyof DebriefDraft>(key: K, value: DebriefDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const save = async () => {
    if (!draft.date) {
      setError("Choose the date of this lesson.");
      return;
    }
    setError(null);

    if (existing) {
      await mutate((repos) => repos.journal.update(existing.id, draft));
      navigate(`/journal/${existing.id}`);
      return;
    }

    const entry = await mutate(async (repos) => {
      const created = await repos.journal.create(draft);

      // Reflection becomes action: the next step goes onto the Flight Plan.
      if (addToPlan && nextActionTitle.trim()) {
        await repos.actions.create({
          title: nextActionTitle.trim(),
          category: "prepare",
          priority: "next_up",
          relatedType: "journal",
          relatedId: created.id,
        });
      }

      // And an open question becomes something to ask.
      if (saveQuestion && draft.questionsForNextTime.trim()) {
        await repos.questions.create({
          text: draft.questionsForNextTime.trim(),
          journalId: created.id,
          status: "to_ask",
        });
      }

      return created;
    });

    if (entry) navigate(`/journal/${entry.id}`);
  };

  const lessons = data.events.filter((event) => event.eventType === "flight_lesson");

  return (
    <>
      <PageHeader
        title={existing ? "Edit debrief" : "Lesson debrief"}
        subtitle="Write it while it is fresh. Short answers are fine."
        action={
          <Button variant="ghost" onClick={() => navigate(-1)}>
            Cancel
          </Button>
        }
      />

      <Card>
        <CardBody>
          <div className="form-grid">
            <Field label="Date" error={error}>
              {({ id, describedBy, invalid }) => (
                <TextInput
                  id={id}
                  type="date"
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                  value={draft.date}
                  onChange={(e) => update("date", e.target.value)}
                />
              )}
            </Field>

            <Field label="Lesson">
              {({ id }) => (
                <Select
                  id={id}
                  placeholder="Not linked to a scheduled lesson"
                  options={lessons.map((event) => ({
                    value: event.id,
                    label: `${event.title} · ${event.date}`,
                  }))}
                  value={draft.eventId ?? ""}
                  onChange={(value) => update("eventId", value || null)}
                />
              )}
            </Field>

            <Field label="Title" full>
              {({ id }) => (
                <TextInput
                  id={id}
                  value={draft.title}
                  placeholder="Crosswind Landings"
                  onChange={(e) => update("title", e.target.value)}
                />
              )}
            </Field>

            <Field label="Today's mission" hint="What was this lesson for?" full>
              {({ id, describedBy }) => (
                <TextArea
                  id={id}
                  rows={2}
                  aria-describedby={describedBy}
                  value={draft.mission}
                  onChange={(e) => update("mission", e.target.value)}
                />
              )}
            </Field>

            <Field label="What did you practise?" full>
              {({ id }) => (
                <TextArea
                  id={id}
                  rows={3}
                  value={draft.practiced}
                  onChange={(e) => update("practiced", e.target.value)}
                />
              )}
            </Field>

            <Field label="What went well?">
              {({ id }) => (
                <TextArea
                  id={id}
                  rows={3}
                  value={draft.wentWell}
                  onChange={(e) => update("wentWell", e.target.value)}
                />
              )}
            </Field>

            <Field label="What was difficult?">
              {({ id }) => (
                <TextArea
                  id={id}
                  rows={3}
                  value={draft.wasDifficult}
                  onChange={(e) => update("wasDifficult", e.target.value)}
                />
              )}
            </Field>

            <Field label="Instructor feedback" full>
              {({ id }) => (
                <TextArea
                  id={id}
                  rows={3}
                  value={draft.instructorFeedback}
                  placeholder="Their words, as close as you remember them."
                  onChange={(e) => update("instructorFeedback", e.target.value)}
                />
              )}
            </Field>

            <Field label="Questions for next time" full>
              {({ id }) => (
                <TextArea
                  id={id}
                  rows={2}
                  value={draft.questionsForNextTime}
                  onChange={(e) => update("questionsForNextTime", e.target.value)}
                />
              )}
            </Field>

            <Field label="Related goal">
              {({ id }) => (
                <Select
                  id={id}
                  placeholder="Not linked to a goal"
                  options={data.goals.map((goal) => ({ value: goal.id, label: goal.title }))}
                  value={draft.goalId ?? ""}
                  onChange={(value) => update("goalId", value || null)}
                />
              )}
            </Field>

            <Field
              label="How confident do you feel?"
              hint="Your own sense of it — not an official proficiency rating."
            >
              {({ id, describedBy }) => (
                <div className="confidence-picker" id={id} aria-describedby={describedBy}>
                  {[1, 2, 3, 4, 5].map((value) => (
                    <button
                      type="button"
                      key={value}
                      className={`confidence-picker__option${
                        draft.confidence === value ? " is-selected" : ""
                      }`}
                      aria-pressed={draft.confidence === value}
                      onClick={() => update("confidence", draft.confidence === value ? null : value)}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              )}
            </Field>
          </div>
        </CardBody>
      </Card>

      {!existing ? (
        <div style={{ marginTop: "var(--space-5)" }}>
        <Card>
          <CardHeader title="What happens next?" />
          <CardBody>
            <div className="stack stack--4">
              <Field label="Because of this lesson, what should you do next?">
                {({ id }) => (
                  <TextInput
                    id={id}
                    value={nextActionTitle}
                    placeholder="Review flare timing"
                    onChange={(e) => setNextActionTitle(e.target.value)}
                  />
                )}
              </Field>

              {nextActionTitle.trim() ? (
                <Checkbox
                  checked={addToPlan}
                  onChange={setAddToPlan}
                  label={`Add “${nextActionTitle.trim()}” to your Flight Plan`}
                />
              ) : null}

              {draft.questionsForNextTime.trim() ? (
                <Checkbox
                  checked={saveQuestion}
                  onChange={setSaveQuestion}
                  label="Save your question to the Questions list"
                />
              ) : null}
            </div>
          </CardBody>
        </Card>
        </div>
      ) : null}

      <div className="row" style={{ marginTop: "var(--space-5)" }}>
        <Button variant="primary" onClick={save}>
          {existing ? "Save changes" : "Save debrief"}
        </Button>
        <Button variant="ghost" onClick={() => navigate(-1)}>
          Cancel
        </Button>
      </div>
    </>
  );
}
