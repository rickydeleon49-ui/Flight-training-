import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTab, useTabList, useTabPanel } from "@react-aria/tabs";
import { useTabListState, type TabListState } from "@react-stately/tabs";
// Collection items come from react-stately (declared alongside the tabs hooks).
import { Item } from "react-stately/Item";
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
  TypedDateField,
  type TypedDateFieldHandle,
} from "@/components/ui";
import { todayIso } from "@/lib/dates";
import { writeDraft } from "@/lib/drafts";
import { newId } from "@/lib/id";
import { flightTimeProblem, flightTimesChanged } from "@/logic/flightLog";
import { loadAirportIndex, nightHint, nightHintText, type AirportIndex } from "@/logic/nightHint";
import type { DebriefSaveOperation } from "@/data/db";
import { useAppData } from "@/state/AppDataContext";
import { useDraftRecovery } from "@/state/useDraftRecovery";

import "./journal.css";

interface DebriefDraft {
  id?: string;
  eventId: string | null;
  date: string;
  title: string;
  schoolName?: string;
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
  actionMaterialId?: string | null;
  questionToSave?: string;
  questionEdited?: boolean;
  questionMaterialId?: string | null;
  questionEventId?: string | null;
  createdActionId?: string | null;
  createdQuestionId?: string | null;
  /**
   * The save operation in flight for this draft: its id and a fingerprint of
   * its content. A retry of the same content reuses the id (a replay the
   * database ignores once committed); any change makes a new operation.
   */
  pendingOperation?: { id: string; fingerprint: string } | null;
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
  actionMaterialId: null,
  questionToSave: "",
  questionEdited: false,
  questionMaterialId: null,
  questionEventId: null,
  createdActionId: null,
  createdQuestionId: null,
  pendingOperation: null,
});

const optionalNumber = (value: string): number | null =>
  value.trim() === "" ? null : Number(value);

type DebriefModeChoice = { value: "quick" | "full"; label: string };
const DEBRIEF_MODES: DebriefModeChoice[] = [
  { value: "quick", label: "Quick debrief" },
  { value: "full", label: "Full flight log & debrief" },
];

function DebriefModeTab({ choice, state }: { choice: DebriefModeChoice; state: TabListState<DebriefModeChoice> }) {
  const ref = useRef<HTMLButtonElement>(null);
  const { tabProps, isSelected, isDisabled } = useTab({ key: choice.value }, state, ref);
  return (
    <button
      {...tabProps}
      ref={ref}
      type="button"
      disabled={isDisabled}
      id={`debrief-mode-tab-${choice.value}`}
      aria-controls="debrief-mode-panel"
      className={`filter-chip${isSelected ? " is-active" : ""}`}
    >
      {choice.label}
    </button>
  );
}

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
  const modeParam = searchParams.get("mode");
  const initialMode = modeParam === "quick" ? "quick" : "full";
  return (
    <JournalFormPage
      key={`${entryId ?? "new"}:${searchParams.get("event") ?? ""}:${modeParam ?? initialMode}`}
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

  // The airport table is loaded only once the full flight log is on screen,
  // for the quiet sunset / night line under Night flight time.
  const [airports, setAirports] = useState<AirportIndex | null>(null);
  useEffect(() => {
    if (mode !== "full" || airports) return;
    let active = true;
    loadAirportIndex()
      .then((index) => {
        if (active) setAirports(index);
      })
      .catch(() => {
        // No table, no line: the form works exactly as before.
      });
    return () => {
      active = false;
    };
  }, [mode, airports]);

  const existing = entryId ? data.journalEntries.find((entry) => entry.id === entryId) : null;

  const [addToPlan, setAddToPlan] = useState(false);
  const [saveQuestion, setSaveQuestion] = useState(false);
  const [actionWithdrawn, setActionWithdrawn] = useState(false);
  const [questionWithdrawn, setQuestionWithdrawn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const tabState = useTabListState<DebriefModeChoice>({
    selectedKey: mode,
    onSelectionChange: (key) => setMode(key as "quick" | "full"),
    // The keyboard delegate reads disabledKeys even when the whole list is disabled.
    disabledKeys: isSaving ? DEBRIEF_MODES.map((choice) => choice.value) : [],
    isDisabled: isSaving,
    items: DEBRIEF_MODES,
    children: (choice) => <Item key={choice.value} textValue={choice.label}>{choice.label}</Item>,
  });
  const tabListRef = useRef<HTMLDivElement>(null);
  const { tabListProps } = useTabList({ "aria-label": "Debrief editor mode", keyboardActivation: "automatic", isDisabled: isSaving }, tabState, tabListRef);
  const tabPanelRef = useRef<HTMLDivElement>(null);
  const { tabPanelProps } = useTabPanel({}, tabState, tabPanelRef);
  const isSavingRef = useRef(false);
  const dateField = useRef<TypedDateFieldHandle>(null);

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
        ...(existing.schoolName != null ? { schoolName: existing.schoolName } : {}),
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
        actionMaterialId: null,
        questionToSave: existing.questionsForNextTime,
        questionEdited: false,
        questionMaterialId: null,
        questionEventId: null,
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

    if (searchParams.get("mode") === "discovery") {
      return {
        ...emptyDraft(),
        title: "Discovery flight",
        aircraftType: "",
        aircraftId: "",
        departureAirport: "",
        arrivalAirport: "",
        instructorName: "",
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

  const restoreDraft = useCallback(
    (saved: Partial<DebriefDraft>) => {
      setDraft((_current) => {
        const defaults = emptyDraft();
        const base = existing
          ? {
              ...startingDraft(),
            }
          : {
              ...defaults,
            };

        const merged: DebriefDraft = {
          ...base,
          ...saved,
        };

        // Preserve special school field missing-versus-explicit distinction:
        // When saved.schoolName is undefined, delete merged.schoolName so that saving
        // omits the schoolName key (preserving any DB value atomically without resending
        // a stale snapshot). The input still falls back to existing?.schoolName for display.
        // Explicit saved/edited blank ("") remains defined and clears when saved.
        if (saved.schoolName !== undefined) {
          merged.schoolName = saved.schoolName;
        } else {
          delete merged.schoolName;
        }

        // Do not overwrite title/aircraft/notes with the discovery preset:
        if (!existing) {
          if (saved.title !== undefined) {
            merged.title = saved.title;
          }
          if (saved.aircraftType !== undefined) {
            merged.aircraftType = saved.aircraftType;
          }
        }

        // Normalize missing legacy fields safely at recovery boundary:
        merged.questionsForNextTime =
          saved.questionsForNextTime ?? base.questionsForNextTime ?? "";
        merged.questionToSave =
          saved.questionToSave !== undefined
            ? saved.questionToSave
            : saved.questionEdited
              ? ""
              : merged.questionsForNextTime;
        merged.questionEdited = Boolean(saved.questionEdited ?? base.questionEdited);
        merged.wentWell = saved.wentWell ?? base.wentWell ?? "";
        merged.wasDifficult = saved.wasDifficult ?? base.wasDifficult ?? "";
        merged.instructorFeedback = saved.instructorFeedback ?? base.instructorFeedback ?? "";
        merged.mission = saved.mission ?? base.mission ?? "";
        merged.practiced = saved.practiced ?? base.practiced ?? "";
        merged.materialIds = saved.materialIds ?? base.materialIds ?? [];

        return merged;
      });
    },
    [existing, startingDraft],
  );

  const { recovered, forget } = useDraftRecovery(draftKey, draft, restoreDraft);

  // Sync refs if a recovered draft carried IDs across page reloads:
  if (draft.id && !createdEntryIdRef.current) createdEntryIdRef.current = draft.id;
  if (draft.createdActionId && !createdActionIdRef.current) createdActionIdRef.current = draft.createdActionId;
  if (draft.createdQuestionId && !createdQuestionIdRef.current) createdQuestionIdRef.current = draft.createdQuestionId;

  const latestDraftRef = useRef<DebriefDraft>(draft);
  latestDraftRef.current = draft;

  const schoolSuggestions = useMemo(() => {
    const names = new Set<string>();
    if (data.profile.flightSchool?.trim()) {
      names.add(data.profile.flightSchool.trim());
    }
    for (const s of data.flightSchools ?? []) {
      if (s.name?.trim()) names.add(s.name.trim());
    }
    return Array.from(names);
  }, [data.profile.flightSchool, data.flightSchools]);

  const hasUnsavedEdits = (current: DebriefDraft, submitted: DebriefDraft) => {
    return (
      current.wentWell !== submitted.wentWell ||
      current.wasDifficult !== submitted.wasDifficult ||
      current.instructorFeedback !== submitted.instructorFeedback ||
      current.questionsForNextTime !== submitted.questionsForNextTime ||
      current.nextActionTitle !== submitted.nextActionTitle ||
      current.actionMaterialId !== submitted.actionMaterialId ||
      current.questionToSave !== submitted.questionToSave ||
      current.questionMaterialId !== submitted.questionMaterialId ||
      current.questionEventId !== submitted.questionEventId ||
      current.title !== submitted.title ||
      current.schoolName !== submitted.schoolName ||
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
    (draft.questionToSave !== undefined
      ? draft.questionToSave
      : draft.questionEdited
        ? ""
        : draft.questionsForNextTime) ?? "";

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

    // A typed date that isn't one is refused in the field, never saved as another day.
    if (dateField.current?.check() === false) return;
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
    // Times saved before this check existed are left alone unless she changes
    // one, so a quick debrief never stops on fields that mode doesn't show.
    const timeProblem = flightTimeProblem(draft);
    if (timeProblem && (!existing || flightTimesChanged(existing, draft))) {
      setError(timeProblem);
      return;
    }
    const enteredSchool = draft.schoolName !== undefined ? draft.schoolName : (existing?.schoolName ?? "");
    if (enteredSchool && enteredSchool.trim().length > 200) {
      setError("School name cannot exceed 200 characters.");
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

    const identifiedDraft: DebriefDraft = {
      ...draft,
      id: targetId,
      createdActionId: targetActionId ?? draft.createdActionId ?? null,
      createdQuestionId: targetQuestionId ?? draft.createdQuestionId ?? null,
    };

    // Preserving untouched hidden fields while honoring intentional edits across mode switches:
    // startingDraft provides the existing baseline, while draft contains intentional user edits
    // (numeric, text, relationships, or intentional clearing) from quick and full mode.
    const {
      nextActionTitle: _draftActionTitle,
      actionMaterialId: _draftActionMaterialId,
      questionToSave: _draftQuestionToSave,
      questionEdited: _draftQuestionEdited,
      questionMaterialId: _draftQuestionMaterialId,
      questionEventId: _draftQuestionEventId,
      createdActionId: _draftCreatedActionId,
      createdQuestionId: _draftCreatedQuestionId,
      pendingOperation: _draftPendingOperation,
      ...journalFields
    } = identifiedDraft;

    const payload = {
      ...startingDraft(),
      ...journalFields,
    };
    delete (payload as Record<string, unknown>).nextActionTitle;
    delete (payload as Record<string, unknown>).actionMaterialId;
    delete (payload as Record<string, unknown>).questionToSave;
    delete (payload as Record<string, unknown>).questionEdited;
    delete (payload as Record<string, unknown>).questionMaterialId;
    delete (payload as Record<string, unknown>).questionEventId;
    delete (payload as Record<string, unknown>).createdActionId;
    delete (payload as Record<string, unknown>).createdQuestionId;
    delete (payload as Record<string, unknown>).pendingOperation;

    const body: Omit<DebriefSaveOperation, "operationId"> = {
      targetId,
      journal: {
        eventId: payload.eventId ?? null,
        date: payload.date,
        title: payload.title ?? "",
        aircraftType: payload.aircraftType ?? "",
        aircraftId: payload.aircraftId ?? "",
        departureAirport: payload.departureAirport ?? "",
        arrivalAirport: payload.arrivalAirport ?? "",
        instructorName: payload.instructorName ?? "",
        totalTime: payload.totalTime ?? null,
        dualReceived: payload.dualReceived ?? null,
        soloTime: payload.soloTime ?? null,
        picTime: payload.picTime ?? null,
        crossCountryTime: payload.crossCountryTime ?? null,
        nightTime: payload.nightTime ?? null,
        actualInstrumentTime: payload.actualInstrumentTime ?? null,
        simulatedInstrumentTime: payload.simulatedInstrumentTime ?? null,
        dayLandings: payload.dayLandings ?? null,
        nightLandings: payload.nightLandings ?? null,
        mission: payload.mission ?? "",
        practiced: payload.practiced ?? "",
        wentWell: payload.wentWell ?? "",
        wasDifficult: payload.wasDifficult ?? "",
        instructorFeedback: payload.instructorFeedback ?? "",
        questionsForNextTime: payload.questionsForNextTime ?? "",
        confidence: payload.confidence ?? null,
        goalId: payload.goalId ?? null,
        materialIds: payload.materialIds ?? [],
        ...(draft.schoolName !== undefined
          ? { schoolName: draft.schoolName.trim() === "" ? null : draft.schoolName.trim() }
          : {}),
      },
      action: wantAction
        ? {
            id: targetActionId!,
            title: actionTitle,
            materialId: identifiedDraft.actionMaterialId ?? null,
          }
        : null,
      withdrawActionId: actionWithdrawn && ownedActionId ? ownedActionId : null,
      question: wantQuestion
        ? {
            id: targetQuestionId!,
            text: finalQuestionText,
            eventId: identifiedDraft.questionEventId ?? null,
            materialId: identifiedDraft.questionMaterialId ?? null,
          }
        : null,
      withdrawQuestionId: questionWithdrawn && ownedQuestionId ? ownedQuestionId : null,
    };

    // Retry versus deliberate edit: the same content keeps the same operation
    // id (the database ignores an id that already committed); anything else is
    // a new operation.
    const fingerprint = JSON.stringify(body);
    const operationId =
      draft.pendingOperation?.fingerprint === fingerprint ? draft.pendingOperation.id : newId();
    const operation: DebriefSaveOperation = { operationId, ...body };
    const durableDraft: DebriefDraft = {
      ...identifiedDraft,
      pendingOperation: { id: operationId, fingerprint },
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

    try {
      const result = await mutate(async (repos) => {
        await repos.journal.saveAtomically(operation);
        createdEntryIdRef.current = targetId;

        if (wantAction) {
          createdActionIdRef.current = targetActionId;
        } else if (actionWithdrawn && ownedActionId) {
          createdActionIdRef.current = null;
        }

        if (wantQuestion) {
          createdQuestionIdRef.current = targetQuestionId;
        } else if (questionWithdrawn && ownedQuestionId) {
          createdQuestionIdRef.current = null;
        }

        return {
          targetId,
          actionId: wantAction ? targetActionId : null,
          questionId: wantQuestion ? targetQuestionId : null,
        };
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

  const nightHintAirport = draft.departureAirport.trim() || draft.arrivalAirport.trim();
  const nightLine = useMemo(() => {
    if (!airports) return null;
    const hint = nightHint(draft.date, nightHintAirport, airports);
    return hint ? nightHintText(hint, draft.date) : null;
  }, [airports, draft.date, nightHintAirport]);

  const lessons = data.events.filter((event) => event.eventType === "flight_lesson");
  const isDiscoveryPreset = !entryId && !existing && !recovered && searchParams.get("mode") === "discovery";

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
              : isDiscoveryPreset
                ? "Log discovery flight"
                : "Log a training flight"
        }
        subtitle={
          mode === "quick"
            ? existing
              ? "Update your debrief notes. Flight log times and aircraft remain untouched."
              : "Capture what happened while it is fresh. Flight times can be added later."
            : isDiscoveryPreset
              ? "Record your discovery flight experience and impressions. Flight times, aircraft, and school are optional."
              : "Record the flight and debrief while it is fresh."
        }
        action={
          <Button variant="ghost" onClick={() => navigate(-1)}>
            Cancel
          </Button>
        }
      />

      <div
        {...tabListProps}
        ref={tabListRef}
        className="view-tabs filter-chips"
        style={{ marginBottom: "var(--space-4)" }}
      >
        {DEBRIEF_MODES.map((choice) => <DebriefModeTab key={choice.value} choice={choice} state={tabState} />)}
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

      <div
        {...tabPanelProps}
        ref={tabPanelRef}
        id="debrief-mode-panel"
        aria-labelledby={`debrief-mode-tab-${mode}`}
      >
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
              <TypedDateField
                ref={dateField}
                label="Date"
                disabled={isSaving}
                value={draft.date}
                onChange={(date) => update("date", date)}
              />

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
                    placeholder="e.g. Crosswind Landings"
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
          <CardHeader
            title={isDiscoveryPreset ? "Discovery flight" : "Training flight"}
            eyebrow={isDiscoveryPreset ? "Discovery reflection" : "Personal flight-time record"}
          />
          <CardBody>
            <p className="small muted" style={{ marginBottom: "var(--space-5)" }}>
              {isDiscoveryPreset
                ? "Flight times, aircraft, and school are optional. Copy only times agreed with your instructor, and keep the instructor-endorsed logbook authoritative."
                : "Copy flight times from the entry agreed with your instructor. Categories can overlap, so the application does not calculate PIC, solo, instrument, or cross-country time. Keep the instructor-endorsed logbook as the authoritative record."}
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
              <TypedDateField
                ref={dateField}
                label="Date"
                disabled={isSaving}
                value={draft.date}
                onChange={(date) => update("date", date)}
              />

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
                    placeholder="e.g. Crosswind Landings"
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
                    placeholder="e.g. Cessna 172S"
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
                    placeholder="e.g. N172SP"
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
                    placeholder="e.g. KSQL"
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
                    placeholder="e.g. KSQL"
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
                    placeholder="e.g. your CFI's name"
                    onChange={(e) => update("instructorName", e.target.value)}
                  />
                )}
              </Field>

              <Field label="School" hint="Flight school or club (optional)">
                {({ id, describedBy }) => (
                  <>
                    <TextInput
                      id={id}
                      aria-describedby={describedBy}
                      list="school-suggestions"
                      disabled={isSaving}
                      value={draft.schoolName !== undefined ? draft.schoolName : (existing?.schoolName ?? "")}
                      placeholder="e.g. San Carlos Flight Center"
                      onChange={(e) => update("schoolName", e.target.value)}
                    />
                    {schoolSuggestions.length > 0 ? (
                      <datalist id="school-suggestions">
                        {schoolSuggestions.map((name) => (
                          <option key={name} value={name} />
                        ))}
                      </datalist>
                    ) : null}
                  </>
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

              <Field label="Night flight time" hint={nightLine ?? undefined}>
                {({ id, describedBy }) => (
                  <TextInput
                    id={id}
                    type="number"
                    disabled={isSaving}
                    step="0.1"
                    min="0"
                    aria-describedby={describedBy}
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
                <Field
                  label="Because of this lesson, what should you do next?"
                  hint="Deliberately review and edit proposed actions before adding them to your Flight Plan."
                >
                  {({ id, describedBy }) => (
                    <div className="stack stack--2">
                      <TextInput
                        id={id}
                        disabled={isSaving}
                        aria-describedby={describedBy}
                        value={draft.nextActionTitle ?? ""}
                        placeholder="e.g. Review flare timing"
                        onChange={(e) => handleNextActionTitleChange(e.target.value)}
                      />
                      {((draft.wasDifficult ?? "").trim() || (draft.instructorFeedback ?? "").trim()) &&
                      !(draft.nextActionTitle ?? "").trim() ? (
                        <div className="row row--wrap" style={{ gap: "var(--space-2)" }}>
                          {(draft.wasDifficult ?? "").trim() ? (
                            <Button
                              type="button"
                              size="small"
                              variant="secondary"
                              disabled={isSaving}
                              onClick={() => {
                                handleNextActionTitleChange((draft.wasDifficult ?? "").trim());
                              }}
                            >
                              Turn “What was difficult” into action
                            </Button>
                          ) : null}
                          {(draft.instructorFeedback ?? "").trim() ? (
                            <Button
                              type="button"
                              size="small"
                              variant="secondary"
                              disabled={isSaving}
                              onClick={() => {
                                handleNextActionTitleChange((draft.instructorFeedback ?? "").trim());
                              }}
                            >
                              Turn “Instructor feedback” into action
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  )}
                </Field>

                {(draft.nextActionTitle ?? "").trim() ? (
                  <div className="stack stack--3">
                    <Checkbox
                      checked={addToPlan}
                      disabled={isSaving}
                      onChange={handleAddToPlanChange}
                      label={`Add “${(draft.nextActionTitle ?? "").trim()}” to your Flight Plan`}
                    />
                    {addToPlan ? (
                      <Field
                        label="Related study material"
                        hint="Optionally connect this action to a Study Library document."
                      >
                        {({ id }) => (
                          <Select
                            id={id}
                            disabled={isSaving}
                            placeholder="Not linked to study material"
                            options={data.materials.map((m) => ({
                              value: m.id,
                              label: m.title,
                            }))}
                            value={draft.actionMaterialId ?? ""}
                            onChange={(val) => update("actionMaterialId", val || null)}
                          />
                        )}
                      </Field>
                    ) : null}
                  </div>
                ) : null}

                {(draft.questionsForNextTime ?? "").trim() || currentQuestionToSave.trim() ? (
                  <div className="stack stack--3">
                    <Checkbox
                      checked={saveQuestion}
                      disabled={isSaving}
                      onChange={handleSaveQuestionChange}
                      label="Save an instructor question to the Questions list"
                    />
                    {saveQuestion ? (
                      <div className="stack stack--3">
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

                        <Field
                          label="Carry to upcoming lesson"
                          hint="Ask this question during your next scheduled lesson (optional)."
                        >
                          {({ id }) => (
                            <Select
                              id={id}
                              disabled={isSaving}
                              placeholder="Any upcoming lesson"
                              options={lessons
                                .filter((ev) => ev.date >= draft.date)
                                .map((ev) => ({
                                  value: ev.id,
                                  label: `${ev.title} · ${ev.date}`,
                                }))}
                              value={draft.questionEventId ?? ""}
                              onChange={(val) => update("questionEventId", val || null)}
                            />
                          )}
                        </Field>

                        <Field
                          label="Related study material"
                          hint="Link relevant Study Library material to this question (optional)."
                        >
                          {({ id }) => (
                            <Select
                              id={id}
                              disabled={isSaving}
                              placeholder="Not linked to study material"
                              options={data.materials.map((m) => ({
                                value: m.id,
                                label: m.title,
                              }))}
                              value={draft.questionMaterialId ?? ""}
                              onChange={(val) => update("questionMaterialId", val || null)}
                            />
                          )}
                        </Field>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </CardBody>
          </Card>
        </div>
      ) : null}
      </fieldset>
      </div>

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
