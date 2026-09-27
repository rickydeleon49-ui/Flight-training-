import { useCallback, useRef, useState } from "react";
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
import { writeDraft } from "@/lib/drafts";
import { newId } from "@/lib/id";
import { useAppData } from "@/state/AppDataContext";
import { useDraftRecovery } from "@/state/useDraftRecovery";

import "./journal.css";

interface DebriefDraft {
  id?: string;
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
  materialIds?: string[];
  nextActionTitle?: string;
  questionToSave?: string;
  questionEdited?: boolean;
  createdActionId?: string | null;
  createdQuestionId?: string | null;
}

const emptyDraft = (): DebriefDraft => ({
  id: undefined,
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
  materialIds: [],
  nextActionTitle: "",
  questionToSave: "",
  questionEdited: false,
  createdActionId: null,
  createdQuestionId: null,
});

const optionalNumber = (value: string): number | null =>
  value.trim() === "" ? null : Number(value);

/**
 * Writing or editing a lesson debrief in quick mode or full log mode.
 *
 * Quick mode captures reflection immediately after a flight. Full mode
 * records comprehensive flight times, aircraft, and route details.
 *
 * Saving can also create the next action and save the question after
 * deliberate user review and editing.
 */
export function JournalForm() {
  const { entryId } = useParams();
  const [searchParams] = useSearchParams();
  const initialMode = searchParams.get("mode") === "quick" ? "quick" : "full";
  return (
    <JournalFormPage
      key={`${entryId ?? "new"}:${searchParams.get("event") ?? ""}:${initialMode}`}
      initialMode={initialMode}
    />
  );
}

function JournalFormPage({ initialMode }: { initialMode: "quick" | "full" }) {
  const { entryId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { data, mutate } = useAppData();

  const [mode, setMode] = useState<"quick" | "full">(initialMode);

  const existing = entryId ? data.journalEntries.find((entry) => entry.id === entryId) : null;

  const [addToPlan, setAddToPlan] = useState(false);
  const [saveQuestion, setSaveQuestion] = useState(false);
  const [actionWithdrawn, setActionWithdrawn] = useState(false);
  const [questionWithdrawn, setQuestionWithdrawn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const isSavingRef = useRef(false);

  // Safeguards against duplicate submissions and ensures idempotent retries:
  const createdEntryIdRef = useRef<string | null>(existing ? existing.id : null);
  const createdActionIdRef = useRef<string | null>(null);
  const createdQuestionIdRef = useRef<string | null>(null);

  /** What the form starts from: the saved entry, a lesson, or her defaults. */
  const startingDraft = useCallback((): DebriefDraft => {
    if (existing) {
      return {
        id: existing.id,
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
        materialIds: existing.materialIds,
        nextActionTitle: "",
        questionToSave: existing.questionsForNextTime,
        questionEdited: false,
        createdActionId: null,
        createdQuestionId: null,
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

  const [draft, setDraft] = useState<DebriefDraft>(startingDraft);

  // A debrief takes a while to write; leaving the page must not lose it.
  const draftKey = existing ? `journal.${existing.id}` : "journal.new";
  const { recovered, forget } = useDraftRecovery(draftKey, draft, setDraft);

  // Sync refs if a recovered draft carried IDs across page reloads:
  if (draft.id && !createdEntryIdRef.current) createdEntryIdRef.current = draft.id;
  if (draft.createdActionId && !createdActionIdRef.current) createdActionIdRef.current = draft.createdActionId;
  if (draft.createdQuestionId && !createdQuestionIdRef.current) createdQuestionIdRef.current = draft.createdQuestionId;

  const latestDraftRef = useRef<DebriefDraft>(draft);
  latestDraftRef.current = draft;

  const hasUnsavedEdits = (current: DebriefDraft, submitted: DebriefDraft) => {
    return (
      current.wentWell !== submitted.wentWell ||
      current.wasDifficult !== submitted.wasDifficult ||
      current.instructorFeedback !== submitted.instructorFeedback ||
      current.questionsForNextTime !== submitted.questionsForNextTime ||
      current.nextActionTitle !== submitted.nextActionTitle ||
      current.questionToSave !== submitted.questionToSave ||
      current.title !== submitted.title ||
      current.mission !== submitted.mission ||
      current.practiced !== submitted.practiced ||
      current.confidence !== submitted.confidence ||
      current.date !== submitted.date ||
      current.totalTime !== submitted.totalTime ||
      current.dualReceived !== submitted.dualReceived ||
      current.soloTime !== submitted.soloTime ||
      current.picTime !== submitted.picTime ||
      current.crossCountryTime !== submitted.crossCountryTime ||
      current.nightTime !== submitted.nightTime ||
      current.actualInstrumentTime !== submitted.actualInstrumentTime ||
      current.simulatedInstrumentTime !== submitted.simulatedInstrumentTime ||
      current.dayLandings !== submitted.dayLandings ||
      current.nightLandings !== submitted.nightLandings ||
      current.aircraftType !== submitted.aircraftType ||
      current.aircraftId !== submitted.aircraftId ||
      current.departureAirport !== submitted.departureAirport ||
      current.arrivalAirport !== submitted.arrivalAirport ||
      current.instructorName !== submitted.instructorName ||
      current.goalId !== submitted.goalId
    );
  };

  const update = <K extends keyof DebriefDraft>(key: K, value: DebriefDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const currentQuestionToSave =
    draft.questionToSave !== undefined
      ? draft.questionToSave
      : draft.questionEdited
        ? ""
        : draft.questionsForNextTime;

  const handleNextActionTitleChange = (value: string) => {
    setDraft((current) => ({ ...current, nextActionTitle: value }));
    if (!value.trim() && (draft.createdActionId || createdActionIdRef.current)) {
      setActionWithdrawn(true);
    }
  };

  const handleAddToPlanChange = (checked: boolean) => {
    setAddToPlan(checked);
    if (checked) {
      setActionWithdrawn(false);
    } else if (draft.createdActionId || createdActionIdRef.current) {
      setActionWithdrawn(true);
    }
  };

  const handleQuestionsForNextTimeChange = (value: string) => {
    setDraft((current) => ({
      ...current,
      questionsForNextTime: value,
      questionToSave: current.questionEdited
        ? (current.questionToSave !== undefined ? current.questionToSave : "")
        : value,
    }));
  };

  const handleQuestionToSaveChange = (value: string) => {
    setDraft((current) => ({
      ...current,
      questionToSave: value,
      questionEdited: true,
    }));
    if (!value.trim() && (draft.createdQuestionId || createdQuestionIdRef.current)) {
      setQuestionWithdrawn(true);
    }
  };

  const handleSaveQuestionChange = (checked: boolean) => {
    setSaveQuestion(checked);
    if (checked) {
      setQuestionWithdrawn(false);
    } else if (draft.createdQuestionId || createdQuestionIdRef.current) {
      setQuestionWithdrawn(true);
    }
  };

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
    // Prevent duplicate submissions from rapid repeated clicks.
    if (isSavingRef.current) return;

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
    setIsSaving(true);
    isSavingRef.current = true;

    const targetId = draft.id ?? existing?.id ?? createdEntryIdRef.current ?? newId();
    createdEntryIdRef.current = targetId;

    const actionTitle = (draft.nextActionTitle ?? "").trim();
    const wantAction = addToPlan && Boolean(actionTitle);
    const ownedActionId = draft.createdActionId ?? createdActionIdRef.current;
    const targetActionId = wantAction ? (ownedActionId ?? newId()) : null;

    const finalQuestionText = currentQuestionToSave.trim();
    const wantQuestion = saveQuestion && Boolean(finalQuestionText);
    const ownedQuestionId = draft.createdQuestionId ?? createdQuestionIdRef.current;
    const targetQuestionId = wantQuestion ? (ownedQuestionId ?? newId()) : null;

    const durableDraft: DebriefDraft = {
      ...draft,
      id: targetId,
      createdActionId: targetActionId ?? draft.createdActionId ?? null,
      createdQuestionId: targetQuestionId ?? draft.createdQuestionId ?? null,
    };

    // Ordering and idempotency contract:
    // Persist stable operation/record identity BEFORE the corresponding database side effect.
    // If draft storage fails, refuse to proceed with unrecoverable partial commits.
    const storedOk = writeDraft(draftKey, durableDraft);
    if (!storedOk) {
      setError("Unable to save debrief because draft storage is unavailable or full. Please check your storage settings.");
      setIsSaving(false);
      isSavingRef.current = false;
      return;
    }
    setDraft(durableDraft);
    if (targetActionId) createdActionIdRef.current = targetActionId;
    if (targetQuestionId) createdQuestionIdRef.current = targetQuestionId;

    // Preserving untouched hidden fields while honoring intentional edits across mode switches:
    // startingDraft provides the existing baseline, while draft contains intentional user edits
    // (numeric, text, relationships, or intentional clearing) from quick and full mode.
    const {
      nextActionTitle: _draftActionTitle,
      questionToSave: _draftQuestionToSave,
      questionEdited: _draftQuestionEdited,
      createdActionId: _draftCreatedActionId,
      createdQuestionId: _draftCreatedQuestionId,
      ...journalFields
    } = durableDraft;

    const payload = {
      ...startingDraft(),
      ...journalFields,
    };
    delete (payload as Record<string, unknown>).nextActionTitle;
    delete (payload as Record<string, unknown>).questionToSave;
    delete (payload as Record<string, unknown>).questionEdited;
    delete (payload as Record<string, unknown>).createdActionId;
    delete (payload as Record<string, unknown>).createdQuestionId;

    try {
      const result = await mutate(async (repos) => {
        // Step 1: Write journal entry (update if existing, create if new)
        const existingEntry = await repos.journal.get(targetId);
        if (existingEntry) {
          await repos.journal.update(targetId, payload);
        } else {
          await repos.journal.create({ ...payload, id: targetId });
        }
        createdEntryIdRef.current = targetId;

        // Step 2: Explicit action ownership
        // Update/delete only records demonstrably created by this specific draft/save operation.
        // Never overwrite or delete an independent linked record.
        if (wantAction) {
          const existingOwnedAction = targetActionId
            ? await repos.actions.get(targetActionId)
            : null;

          if (existingOwnedAction) {
            await repos.actions.update(targetActionId!, {
              title: actionTitle,
            });
          } else {
            await repos.actions.create({
              id: targetActionId!,
              title: actionTitle,
              category: "prepare",
              priority: "next_up",
              relatedType: "journal",
              relatedId: targetId,
            });
          }
          createdActionIdRef.current = targetActionId;
        } else if (actionWithdrawn && ownedActionId) {
          const existingOwnedAction = await repos.actions.get(ownedActionId);
          if (existingOwnedAction) {
            await repos.actions.remove(ownedActionId);
          }
          createdActionIdRef.current = null;
        }

        // Step 3: Explicit question ownership
        // Update/delete only records demonstrably created by this specific draft/save operation.
        // Never overwrite or delete an independent linked record.
        if (wantQuestion) {
          const existingOwnedQuestion = targetQuestionId
            ? await repos.questions.get(targetQuestionId)
            : null;

          if (existingOwnedQuestion) {
            await repos.questions.update(targetQuestionId!, {
              text: finalQuestionText,
            });
          } else {
            await repos.questions.create({
              id: targetQuestionId!,
              text: finalQuestionText,
              journalId: targetId,
              status: "to_ask",
            });
          }
          createdQuestionIdRef.current = targetQuestionId;
        } else if (questionWithdrawn && ownedQuestionId) {
          const existingOwnedQuestion = await repos.questions.get(ownedQuestionId);
          if (existingOwnedQuestion) {
            await repos.questions.remove(ownedQuestionId);
          }
          createdQuestionIdRef.current = null;
        }

        return { targetId, actionId: wantAction ? targetActionId : null, questionId: wantQuestion ? targetQuestionId : null };
      });

      if (result) {
        if (hasUnsavedEdits(latestDraftRef.current, durableDraft)) {
          // Newer edits made while saving are preserved; do not discard them or navigate away
          setIsSaving(false);
          isSavingRef.current = false;
        } else {
          forget();
          navigate(`/journal/${result.targetId}`);
        }
      } else {
        setError(
          "Unable to save debrief right now. Your entries are preserved — please try again.",
        );
      }
    } catch {
      setError(
        "An unexpected error occurred while saving. Your entries are preserved — please try again.",
      );
    } finally {
      setIsSaving(false);
      isSavingRef.current = false;
    }
  };

  const lessons = data.events.filter((event) => event.eventType === "flight_lesson");

  return (
    <>
      <PageHeader
        title={
          mode === "quick"
            ? existing
              ? "Quick debrief · Edit"
              : "Quick debrief"
            : existing
              ? "Edit flight record"
              : "Log a training flight"
        }
        subtitle={
          mode === "quick"
            ? existing
              ? "Update your debrief notes. Flight log times and aircraft remain untouched."
              : "Capture what happened while it is fresh. Flight times can be added later."
            : "Record the flight and debrief while it is fresh."
        }
        action={
          <Button variant="ghost" onClick={() => navigate(-1)}>
            Cancel
          </Button>
        }
      />

      <div
        className="view-tabs filter-chips"
        style={{ marginBottom: "var(--space-4)" }}
        role="tablist"
        aria-label="Debrief editor mode"
      >
        <button
          type="button"
          role="tab"
          disabled={isSaving}
          className={`filter-chip${mode === "quick" ? " is-active" : ""}`}
          aria-selected={mode === "quick"}
          onClick={() => setMode("quick")}
        >
          Quick debrief
        </button>
        <button
          type="button"
          role="tab"
          disabled={isSaving}
          className={`filter-chip${mode === "full" ? " is-active" : ""}`}
          aria-selected={mode === "full"}
          onClick={() => setMode("full")}
        >
          Full flight log & debrief
        </button>
      </div>

      {recovered ? (
        <div className="draft-note" role="status">
          <p className="small">
            Picked up where you left off — this is what you had typed but not saved.
          </p>
          <Button
            size="small"
            disabled={isSaving}
            onClick={() => {
              forget();
              setDraft(startingDraft());
              createdEntryIdRef.current = null;
              createdActionIdRef.current = null;
              createdQuestionIdRef.current = null;
              setAddToPlan(false);
              setSaveQuestion(false);
              setActionWithdrawn(false);
              setQuestionWithdrawn(false);
            }}
          >
            Start fresh
          </Button>
        </div>
      ) : null}

      <fieldset
        disabled={isSaving}
        aria-busy={isSaving}
        style={{ border: 0, padding: 0, margin: 0, minInlineSize: 0 }}
      >

      {mode === "quick" ? (
        <Card>
          <CardHeader title="Quick debrief notes" eyebrow="Lesson reflection" />
          <CardBody>
            <p className="small muted" style={{ marginBottom: "var(--space-5)" }}>
              Capture your reflections while they are fresh. You can add flight times and aircraft
              details in the full log anytime.
            </p>
            {error ? (
              <p
                className="field__error"
                role="alert"
                style={{ marginBottom: "var(--space-4)" }}
              >
                {error}
              </p>
            ) : null}
            <div className="form-grid">
              <Field label="Date">
                {({ id }) => (
                  <TextInput
                    id={id}
                    type="date"
                    disabled={isSaving}
                    value={draft.date}
                    onChange={(e) => update("date", e.target.value)}
                  />
                )}
              </Field>

              <Field label="Lesson">
                {({ id }) => (
                  <Select
                    id={id}
                    disabled={isSaving}
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
                    disabled={isSaving}
                    value={draft.title}
                    placeholder="Crosswind Landings"
                    onChange={(e) => update("title", e.target.value)}
                  />
                )}
              </Field>

              <Field label="What went well?">
                {({ id }) => (
                  <TextArea
                    id={id}
                    disabled={isSaving}
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
                    disabled={isSaving}
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
                    disabled={isSaving}
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
                    disabled={isSaving}
                    rows={2}
                    value={draft.questionsForNextTime}
                    onChange={(e) => handleQuestionsForNextTimeChange(e.target.value)}
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
                        disabled={isSaving}
                        className={`confidence-picker__option${
                          draft.confidence === value ? " is-selected" : ""
                        }`}
                        aria-pressed={draft.confidence === value}
                        onClick={() =>
                          update("confidence", draft.confidence === value ? null : value)
                        }
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
      ) : (
        <Card>
          <CardHeader title="Training flight" eyebrow="Personal flight-time record" />
          <CardBody>
            <p className="small muted" style={{ marginBottom: "var(--space-5)" }}>
              Copy flight times from the entry agreed with her instructor. Categories can overlap,
              so the application does not calculate PIC, solo, instrument, or cross-country time.
              Keep the instructor-endorsed logbook as the authoritative record.
            </p>
            {error ? (
              <p
                className="field__error"
                role="alert"
                style={{ marginBottom: "var(--space-4)" }}
              >
                {error}
              </p>
            ) : null}
            <div className="form-grid">
              <Field label="Date">
                {({ id }) => (
                  <TextInput
                    id={id}
                    type="date"
                    disabled={isSaving}
                    value={draft.date}
                    onChange={(e) => update("date", e.target.value)}
                  />
                )}
              </Field>

              <Field label="Lesson">
                {({ id }) => (
                  <Select
                    id={id}
                    disabled={isSaving}
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
                    disabled={isSaving}
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
                    disabled={isSaving}
                    value={draft.aircraftType}
                    placeholder="Cessna 172S"
                    onChange={(e) => update("aircraftType", e.target.value)}
                  />
                )}
              </Field>

              <Field label="Tail number / identifier">
                {({ id }) => (
                  <TextInput
                    id={id}
                    disabled={isSaving}
                    value={draft.aircraftId}
                    placeholder="N172SP"
                    onChange={(e) => update("aircraftId", e.target.value)}
                  />
                )}
              </Field>

              <Field label="Departure airport">
                {({ id }) => (
                  <TextInput
                    id={id}
                    disabled={isSaving}
                    value={draft.departureAirport}
                    placeholder="KSQL"
                    onChange={(e) => update("departureAirport", e.target.value)}
                  />
                )}
              </Field>

              <Field label="Arrival airport">
                {({ id }) => (
                  <TextInput
                    id={id}
                    disabled={isSaving}
                    value={draft.arrivalAirport}
                    placeholder="KSQL"
                    onChange={(e) => update("arrivalAirport", e.target.value)}
                  />
                )}
              </Field>

              <Field label="Instructor name">
                {({ id }) => (
                  <TextInput
                    id={id}
                    disabled={isSaving}
                    value={draft.instructorName}
                    placeholder="CFI name"
                    onChange={(e) => update("instructorName", e.target.value)}
                  />
                )}
              </Field>

              <Field label="Total flight time" hint="Hours, e.g. 1.3">
                {({ id, describedBy }) => (
                  <TextInput
                    id={id}
                    type="number"
                    disabled={isSaving}
                    step="0.1"
                    min="0"
                    aria-describedby={describedBy}
                    value={draft.totalTime ?? ""}
                    placeholder="0.0"
                    onChange={(e) => update("totalTime", optionalNumber(e.target.value))}
                  />
                )}
              </Field>

              <Field label="Dual received" hint="Training time with an authorized instructor">
                {({ id, describedBy }) => (
                  <TextInput
                    id={id}
                    type="number"
                    disabled={isSaving}
                    step="0.1"
                    min="0"
                    aria-describedby={describedBy}
                    value={draft.dualReceived ?? ""}
                    placeholder="0.0"
                    onChange={(e) => update("dualReceived", optionalNumber(e.target.value))}
                  />
                )}
              </Field>

              <Field label="Solo flight time">
                {({ id }) => (
                  <TextInput
                    id={id}
                    type="number"
                    disabled={isSaving}
                    step="0.1"
                    min="0"
                    value={draft.soloTime ?? ""}
                    placeholder="0.0"
                    onChange={(e) => update("soloTime", optionalNumber(e.target.value))}
                  />
                )}
              </Field>

              <Field label="Pilot in command (PIC)">
                {({ id }) => (
                  <TextInput
                    id={id}
                    type="number"
                    disabled={isSaving}
                    step="0.1"
                    min="0"
                    value={draft.picTime ?? ""}
                    placeholder="0.0"
                    onChange={(e) => update("picTime", optionalNumber(e.target.value))}
                  />
                )}
              </Field>

              <Field label="Cross-country">
                {({ id }) => (
                  <TextInput
                    id={id}
                    type="number"
                    disabled={isSaving}
                    step="0.1"
                    min="0"
                    value={draft.crossCountryTime ?? ""}
                    placeholder="0.0"
                    onChange={(e) => update("crossCountryTime", optionalNumber(e.target.value))}
                  />
                )}
              </Field>

              <Field label="Night flight time">
                {({ id }) => (
                  <TextInput
                    id={id}
                    type="number"
                    disabled={isSaving}
                    step="0.1"
                    min="0"
                    value={draft.nightTime ?? ""}
                    placeholder="0.0"
                    onChange={(e) => update("nightTime", optionalNumber(e.target.value))}
                  />
                )}
              </Field>

              <Field label="Actual instrument">
                {({ id }) => (
                  <TextInput
                    id={id}
                    type="number"
                    disabled={isSaving}
                    step="0.1"
                    min="0"
                    value={draft.actualInstrumentTime ?? ""}
                    placeholder="0.0"
                    onChange={(e) =>
                      update("actualInstrumentTime", optionalNumber(e.target.value))
                    }
                  />
                )}
              </Field>

              <Field label="Simulated instrument" hint="Under the hood / view-limiting device">
                {({ id, describedBy }) => (
                  <TextInput
                    id={id}
                    type="number"
                    disabled={isSaving}
                    step="0.1"
                    min="0"
                    aria-describedby={describedBy}
                    value={draft.simulatedInstrumentTime ?? ""}
                    placeholder="0.0"
                    onChange={(e) =>
                      update("simulatedInstrumentTime", optionalNumber(e.target.value))
                    }
                  />
                )}
              </Field>

              <Field label="Day landings">
                {({ id }) => (
                  <TextInput
                    id={id}
                    type="number"
                    disabled={isSaving}
                    step="1"
                    min="0"
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
                    disabled={isSaving}
                    step="1"
                    min="0"
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
                    disabled={isSaving}
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
                    disabled={isSaving}
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
                    disabled={isSaving}
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
                    disabled={isSaving}
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
                    disabled={isSaving}
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
                    disabled={isSaving}
                    rows={2}
                    value={draft.questionsForNextTime}
                    onChange={(e) => handleQuestionsForNextTimeChange(e.target.value)}
                  />
                )}
              </Field>

              <Field label="Related goal">
                {({ id }) => (
                  <Select
                    id={id}
                    disabled={isSaving}
                    placeholder="Not linked to a goal"
                    options={data.goals.map((goal) => ({
                      value: goal.id,
                      label: goal.title,
                    }))}
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
                        disabled={isSaving}
                        className={`confidence-picker__option${
                          draft.confidence === value ? " is-selected" : ""
                        }`}
                        aria-pressed={draft.confidence === value}
                        onClick={() =>
                          update("confidence", draft.confidence === value ? null : value)
                        }
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
      )}

      {!existing ? (
        <div style={{ marginTop: "var(--space-5)" }}>
          <Card>
            <CardHeader title="What happens next?" eyebrow="Deliberate next steps" />
            <CardBody>
              <div className="stack stack--4">
                <Field label="Because of this lesson, what should you do next?">
                  {({ id }) => (
                    <TextInput
                      id={id}
                      disabled={isSaving}
                      value={draft.nextActionTitle ?? ""}
                      placeholder="Review flare timing"
                      onChange={(e) => handleNextActionTitleChange(e.target.value)}
                    />
                  )}
                </Field>

                {(draft.nextActionTitle ?? "").trim() ? (
                  <Checkbox
                    checked={addToPlan}
                    disabled={isSaving}
                    onChange={handleAddToPlanChange}
                    label={`Add “${(draft.nextActionTitle ?? "").trim()}” to your Flight Plan`}
                  />
                ) : null}

                {draft.questionsForNextTime.trim() || currentQuestionToSave.trim() ? (
                  <>
                    <Checkbox
                      checked={saveQuestion}
                      disabled={isSaving}
                      onChange={handleSaveQuestionChange}
                      label="Save an instructor question to the Questions list"
                    />
                    {saveQuestion ? (
                      <Field
                        label="Question to ask your instructor"
                        hint="Deliberately review and edit the question before saving to the Questions list."
                      >
                        {({ id, describedBy }) => (
                          <TextArea
                            id={id}
                            disabled={isSaving}
                            aria-describedby={describedBy}
                            rows={2}
                            value={currentQuestionToSave}
                            onChange={(e) => handleQuestionToSaveChange(e.target.value)}
                          />
                        )}
                      </Field>
                    ) : null}
                  </>
                ) : null}
              </div>
            </CardBody>
          </Card>
        </div>
      ) : null}
      </fieldset>

      <div className="row" style={{ marginTop: "var(--space-5)" }}>
        <Button variant="primary" disabled={isSaving} onClick={save}>
          {isSaving
            ? "Saving…"
            : existing
              ? "Save changes"
              : mode === "quick"
                ? "Save quick debrief"
                : "Save flight record"}
        </Button>
        {mode === "quick" ? (
          <Button
            variant="secondary"
            type="button"
            disabled={isSaving}
            onClick={() => setMode("full")}
          >
            Full flight log & debrief
          </Button>
        ) : (
          <Button
            variant="secondary"
            type="button"
            disabled={isSaving}
            onClick={() => setMode("quick")}
          >
            Quick debrief
          </Button>
        )}
        <Button variant="ghost" disabled={isSaving} onClick={() => navigate(-1)}>
          Cancel
        </Button>
      </div>
    </>
  );
}
