import { useCallback, useEffect, useState } from "react";
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
import { useDraftRecovery } from "@/state/useDraftRecovery";

import "./journal.css";

interface DebriefDraft {
  eventId: string | null;
  date: string;
  title: string;
  aircraftType: string;
  aircraftId: string;
  departureAirport: string;
  arrivalAirport: string;
  instructorName: string;
  totalTime: number | null;
  dualReceived: number | null;
  soloTime: number | null;
  picTime: number | null;
  crossCountryTime: number | null;
  nightTime: number | null;
  actualInstrumentTime: number | null;
  simulatedInstrumentTime: number | null;
  dayLandings: number | null;
  nightLandings: number | null;
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
  aircraftType: "",
  aircraftId: "",
  departureAirport: "",
  arrivalAirport: "",
  instructorName: "",
  totalTime: null,
  dualReceived: null,
  soloTime: null,
  picTime: null,
  crossCountryTime: null,
  nightTime: null,
  actualInstrumentTime: null,
  simulatedInstrumentTime: null,
  dayLandings: null,
  nightLandings: null,
  mission: "",
  practiced: "",
  wentWell: "",
  wasDifficult: "",
  instructorFeedback: "",
  questionsForNextTime: "",
  confidence: null,
  goalId: null,
});

const optionalNumber = (value: string): number | null =>
  value.trim() === "" ? null : Number(value);

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

  /** What the form starts from: the saved entry, a lesson, or her defaults. */
  const startingDraft = useCallback((): DebriefDraft => {
    if (existing) {
      return {
        eventId: existing.eventId,
        date: existing.date,
        title: existing.title,
        aircraftType: existing.aircraftType,
        aircraftId: existing.aircraftId,
        departureAirport: existing.departureAirport,
        arrivalAirport: existing.arrivalAirport,
        instructorName: existing.instructorName,
        totalTime: existing.totalTime,
        dualReceived: existing.dualReceived,
        soloTime: existing.soloTime,
        picTime: existing.picTime,
        crossCountryTime: existing.crossCountryTime,
        nightTime: existing.nightTime,
        actualInstrumentTime: existing.actualInstrumentTime,
        simulatedInstrumentTime: existing.simulatedInstrumentTime,
        dayLandings: existing.dayLandings,
        nightLandings: existing.nightLandings,
        mission: existing.mission,
        practiced: existing.practiced,
        wentWell: existing.wentWell,
        wasDifficult: existing.wasDifficult,
        instructorFeedback: existing.instructorFeedback,
        questionsForNextTime: existing.questionsForNextTime,
        confidence: existing.confidence,
        goalId: existing.goalId,
      };
    }

    // Arriving from a lesson pre-fills what we already know about it.
    const eventId = searchParams.get("event");
    const event = eventId ? data.events.find((candidate) => candidate.id === eventId) : null;
    if (event) {
      return {
        ...emptyDraft(),
        eventId: event.id,
        date: event.date,
        title: event.title,
        aircraftType: data.profile.aircraftType,
        instructorName: event.instructor || data.profile.instructorName,
        departureAirport: data.profile.homeAirport,
        arrivalAirport: data.profile.homeAirport,
        goalId: event.goalId,
      };
    }

    return {
      ...emptyDraft(),
      aircraftType: data.profile.aircraftType,
      instructorName: data.profile.instructorName,
      departureAirport: data.profile.homeAirport,
      arrivalAirport: data.profile.homeAirport,
    };
  }, [existing, searchParams, data.events, data.profile]);

  useEffect(() => {
    setDraft(startingDraft());
  }, [startingDraft]);

  // A debrief takes a while to write; leaving the page must not lose it.
  const draftKey = existing ? `journal.${existing.id}` : "journal.new";
  const { recovered, forget } = useDraftRecovery(draftKey, draft, setDraft);

  const update = <K extends keyof DebriefDraft>(key: K, value: DebriefDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const chooseLesson = (eventId: string) => {
    const event = data.events.find((candidate) => candidate.id === eventId);
    if (!event) {
      update("eventId", null);
      return;
    }
    setDraft((current) => ({
      ...current,
      eventId: event.id,
      date: event.date,
      title: current.title || event.title,
      instructorName: current.instructorName || event.instructor || data.profile.instructorName,
      aircraftType: current.aircraftType || data.profile.aircraftType,
      departureAirport: current.departureAirport || data.profile.homeAirport,
      arrivalAirport: current.arrivalAirport || data.profile.homeAirport,
      goalId: current.goalId || event.goalId,
    }));
  };

  const save = async () => {
    if (!draft.date) {
      setError("Choose the date of this lesson.");
      return;
    }
    const numberFields = [
      draft.totalTime,
      draft.dualReceived,
      draft.soloTime,
      draft.picTime,
      draft.crossCountryTime,
      draft.nightTime,
      draft.actualInstrumentTime,
      draft.simulatedInstrumentTime,
      draft.dayLandings,
      draft.nightLandings,
    ];
    if (numberFields.some((value) => value != null && (!Number.isFinite(value) || value < 0))) {
      setError("Flight times and landing counts must be zero or greater.");
      return;
    }
    if (
      [draft.dayLandings, draft.nightLandings].some(
        (value) => value != null && !Number.isInteger(value),
      )
    ) {
      setError("Landing counts must be whole numbers.");
      return;
    }
    setError(null);

    if (existing) {
      const result = await mutate((repos) => repos.journal.update(existing.id, draft));
      if (result !== null) {
        forget();
        navigate(`/journal/${existing.id}`);
      }
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

    if (entry) {
      forget();
      navigate(`/journal/${entry.id}`);
    }
  };

  const lessons = data.events.filter((event) => event.eventType === "flight_lesson");

  return (
    <>
      <PageHeader
        title={existing ? "Edit flight record" : "Log a training flight"}
        subtitle="Record the flight and debrief while it is fresh."
        action={
          <Button variant="ghost" onClick={() => navigate(-1)}>
            Cancel
          </Button>
        }
      />

      {recovered ? (
        <div className="draft-note" role="status">
          <p className="small">
            Picked up where you left off — this is what you had typed but not saved.
          </p>
          <Button
            size="small"
            onClick={() => {
              forget();
              setDraft(startingDraft());
            }}
          >
            Start fresh
          </Button>
        </div>
      ) : null}

      <Card>
        <CardHeader title="Training flight" eyebrow="Personal flight-time record" />
        <CardBody>
          <p className="small muted" style={{ marginBottom: "var(--space-5)" }}>
            Copy flight times from the entry agreed with her instructor. Categories can overlap,
            so the application does not calculate PIC, solo, instrument, or cross-country time.
            Keep the instructor-endorsed logbook as the authoritative record.
          </p>
          {error ? <p className="field__error" style={{ marginBottom: "var(--space-4)" }}>{error}</p> : null}
          <div className="form-grid">
            <Field label="Date">
              {({ id }) => (
                <TextInput
                  id={id}
                  type="date"
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
                  onChange={chooseLesson}
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

            <Field label="Aircraft type / model">
              {({ id }) => (
                <TextInput
                  id={id}
                  value={draft.aircraftType}
                  placeholder="Cessna 172S"
                  onChange={(e) => update("aircraftType", e.target.value)}
                />
              )}
            </Field>

            <Field label="Aircraft registration / ID">
              {({ id }) => (
                <TextInput
                  id={id}
                  value={draft.aircraftId}
                  placeholder="N12345"
                  onChange={(e) => update("aircraftId", e.target.value.toUpperCase())}
                />
              )}
            </Field>

            <Field label="Departed from">
              {({ id }) => (
                <TextInput
                  id={id}
                  value={draft.departureAirport}
                  placeholder="KPAE"
                  onChange={(e) => update("departureAirport", e.target.value.toUpperCase())}
                />
              )}
            </Field>

            <Field label="Arrived at">
              {({ id }) => (
                <TextInput
                  id={id}
                  value={draft.arrivalAirport}
                  placeholder="KPAE"
                  onChange={(e) => update("arrivalAirport", e.target.value.toUpperCase())}
                />
              )}
            </Field>

            <Field label="Instructor">
              {({ id }) => (
                <TextInput
                  id={id}
                  value={draft.instructorName}
                  placeholder="Instructor name"
                  onChange={(e) => update("instructorName", e.target.value)}
                />
              )}
            </Field>

            <Field label="Total flight time" hint="Hours, normally entered in tenths.">
              {({ id, describedBy }) => (
                <TextInput
                  id={id}
                  type="number"
                  min="0"
                  step="0.1"
                  inputMode="decimal"
                  aria-describedby={describedBy}
                  value={draft.totalTime ?? ""}
                  placeholder="1.2"
                  onChange={(e) => update("totalTime", optionalNumber(e.target.value))}
                />
              )}
            </Field>

            {(
              [
                ["dualReceived", "Training received (dual)"],
                ["soloTime", "Solo"],
                ["picTime", "Pilot in command (PIC)"],
                ["crossCountryTime", "Cross-country"],
                ["nightTime", "Night"],
                ["actualInstrumentTime", "Actual instrument"],
                ["simulatedInstrumentTime", "Simulated instrument"],
              ] as const
            ).map(([key, label]) => (
              <Field label={label} key={key}>
                {({ id }) => (
                  <TextInput
                    id={id}
                    type="number"
                    min="0"
                    step="0.1"
                    inputMode="decimal"
                    value={draft[key] ?? ""}
                    placeholder="0.0"
                    onChange={(e) => update(key, optionalNumber(e.target.value))}
                  />
                )}
              </Field>
            ))}

            <Field label="Day landings">
              {({ id }) => (
                <TextInput
                  id={id}
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  value={draft.dayLandings ?? ""}
                  placeholder="0"
                  onChange={(e) => update("dayLandings", optionalNumber(e.target.value))}
                />
              )}
            </Field>

            <Field label="Night landings">
              {({ id }) => (
                <TextInput
                  id={id}
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  value={draft.nightLandings ?? ""}
                  placeholder="0"
                  onChange={(e) => update("nightLandings", optionalNumber(e.target.value))}
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
          {existing ? "Save changes" : "Save flight record"}
        </Button>
        <Button variant="ghost" onClick={() => navigate(-1)}>
          Cancel
        </Button>
      </div>
    </>
  );
}
