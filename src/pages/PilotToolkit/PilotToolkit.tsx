import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";

import { PageHeader } from "@/components/layout/PageHeader";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  ConfirmDialog,
  Field,
  Select,
  TextArea,
  TextInput,
} from "@/components/ui";
import {
  CREDENTIAL_TYPE_LABELS,
  CREDENTIAL_TYPE_OPTIONS,
  READINESS_STATUS_OPTIONS,
  TOPIC_LABELS,
  type CredentialRecord,
  type CredentialType,
  type ReadinessStatus,
  type SafetyCheck,
  type SafetyDecision,
  type ToolkitState,
} from "@/domain/types";
import { formatLongDate, formatShortDate, nowIso, todayIso } from "@/lib/dates";
import { newId } from "@/lib/id";
import { formatMoney } from "@/lib/money";
import {
  flightActivity,
  flightLogTotals,
  formatHours,
} from "@/logic/flightLog";
import {
  buildReminders,
  daysUntil,
  makeQuizAttempt,
  medicalDateConflict,
  type MedicalDateChoice,
  QUIZ_QUESTIONS,
  readinessSummary,
  reconcileMedicalDates,
  reminderLeadDays,
  trainingCostForecast,
} from "@/logic/toolkit";
import { useAppData } from "@/state/AppDataContext";
import { TOOLKIT_UNREADABLE_MESSAGE } from "@/data/repositories/toolkitRepository";

import "./pilotToolkit.css";

type Tool =
  | "readiness"
  | "report"
  | "records"
  | "costs"
  | "safety"
  | "quiz"
  | "reminders"
  | "career";

const TOOLS: Array<{ id: Tool; label: string }> = [
  { id: "readiness", label: "Checkride" },
  { id: "report", label: "Instructor Report" },
  { id: "records", label: "Certificates" },
  { id: "costs", label: "Cost Forecast" },
  { id: "safety", label: "Safety Check" },
  { id: "quiz", label: "Quizzes" },
  { id: "reminders", label: "Reminders" },
  { id: "career", label: "Career Portfolio" },
];

export function PilotToolkit() {
  const { data, mutate } = useAppData();
  const [tool, setTool] = useState<Tool>("readiness");
  const [saved, setSaved] = useState(false);
  const tabRefs = useRef<Partial<Record<Tool, HTMLButtonElement | null>>>({});

  const tabId = (id: Tool) => `toolkit-tab-${id}`;
  const panelId = (id: Tool) => `toolkit-panel-${id}`;

  const selectTab = (id: Tool) => {
    setTool(id);
    tabRefs.current[id]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, currentTool: Tool) => {
    const currentIndex = TOOLS.findIndex((t) => t.id === currentTool);
    if (currentIndex === -1) return;

    let nextIndex = -1;
    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % TOOLS.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + TOOLS.length) % TOOLS.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = TOOLS.length - 1;
    }

    const nextItem = TOOLS[nextIndex];
    if (nextItem) {
      event.preventDefault();
      selectTab(nextItem.id);
    }
  };

  // Owned here, not by the medical card, so a choice still saving keeps both
  // buttons locked when she switches tabs and comes back.
  const medicalChoosingRef = useRef(false);
  const [medicalChoosing, setMedicalChoosing] = useState(false);
  const medicalChoice = useMemo<PendingChoice>(
    () => ({
      acquire: () => {
        if (medicalChoosingRef.current) return false;
        medicalChoosingRef.current = true;
        setMedicalChoosing(true);
        return true;
      },
      release: () => {
        medicalChoosingRef.current = false;
        setMedicalChoosing(false);
      },
    }),
    [],
  );

  const save = async (change: (current: ToolkitState) => ToolkitState) => {
    const result = await mutate(async (repositories) =>
      repositories.toolkit.save(change(await repositories.toolkit.get())),
    );
    if (result === null) return false;
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
    return true;
  };

  return (
    <>
      <PageHeader
        title="Pilot Toolkit"
        subtitle="Readiness, records, safety, training costs, and the airline path in one place."
        action={
          saved ? <span className="small toolkit-saved">Saved.</span> : null
        }
      />
      {data.toolkitUnreadable ? (
        <p className="small" role="status">
          {TOOLKIT_UNREADABLE_MESSAGE}
        </p>
      ) : null}
      <div
        className="filter-chips toolkit-tabs"
        role="tablist"
        aria-label="Pilot tools"
      >
        {TOOLS.map((item) => (
          <button
            type="button"
            role="tab"
            id={tabId(item.id)}
            aria-controls={panelId(item.id)}
            aria-selected={tool === item.id}
            tabIndex={tool === item.id ? 0 : -1}
            className={`filter-chip${tool === item.id ? " is-active" : ""}`}
            onClick={() => selectTab(item.id)}
            onKeyDown={(e) => handleKeyDown(e, item.id)}
            ref={(el) => {
              tabRefs.current[item.id] = el;
            }}
            key={item.id}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={panelId(tool)}
        aria-labelledby={tabId(tool)}
        tabIndex={0}
        className="toolkit-tabpanel"
      >
        {tool === "readiness" ? (
          <ReadinessTool state={data.toolkit} save={save} />
        ) : null}
        {tool === "report" ? <InstructorReport /> : null}
        {tool === "records" ? (
          <RecordsTool
            state={data.toolkit}
            save={save}
            medicalChoice={medicalChoice}
            medicalChoosing={medicalChoosing}
          />
        ) : null}
        {tool === "costs" ? <CostTool state={data.toolkit} save={save} /> : null}
        {tool === "safety" ? (
          <SafetyTool state={data.toolkit} save={save} />
        ) : null}
        {tool === "quiz" ? <QuizTool state={data.toolkit} save={save} /> : null}
        {tool === "reminders" ? (
          <ReminderTool state={data.toolkit} save={save} />
        ) : null}
        {tool === "career" ? (
          <CareerTool state={data.toolkit} save={save} />
        ) : null}
      </div>
    </>
  );
}

function ReadinessTool({ state, save }: ToolProps) {
  const summary = readinessSummary(state.readinessItems);
  const areas = [
    ["knowledge", "Knowledge and oral preparation"],
    ["flight", "Flight proficiency"],
    ["administration", "Eligibility and paperwork"],
  ] as const;

  const updateStatus = (id: string, status: ReadinessStatus) =>
    save((current) => ({
      ...current,
      readinessItems: current.readinessItems.map((item) =>
        item.id === id ? { ...item, status } : item,
      ),
    }));

  return (
    <div className="stack stack--5 toolkit-print-area">
      <Card variant="accent">
        <CardHeader
          title="Private pilot checkride readiness"
          eyebrow="Planning checklist"
        />
        <CardBody>
          <div className="toolkit-hero-metrics">
            <div>
              <p className="toolkit-number numeric">
                {summary.ready}/{summary.total}
              </p>
              <p className="tiny dim">feel ready or signed off</p>
            </div>
            <div>
              <p className="toolkit-number numeric">{summary.signedOff}</p>
              <p className="tiny dim">instructor signed off</p>
            </div>
          </div>
          <div
            className="toolkit-progress"
            role="progressbar"
            aria-label="Readiness checklist"
            aria-valuemin={0}
            aria-valuemax={summary.total}
            aria-valuenow={summary.ready}
          >
            <span style={{ width: `${summary.percent}%` }} />
          </div>
          <p className="small muted toolkit-note">
            This organizes conversations with her instructor. Only the
            instructor, current regulations, required endorsements, and examiner
            process determine eligibility.
          </p>
        </CardBody>
      </Card>

      {areas.map(([area, title]) => (
        <Card key={area}>
          <CardHeader title={title} />
          <CardBody flush>
            {state.readinessItems
              .filter((item) => item.area === area)
              .map((item) => (
                <div className="toolkit-row" key={item.id}>
                  <span className="small wrap-anywhere">{item.title}</span>
                  <Select
                    aria-label={`Readiness for ${item.title}`}
                    options={READINESS_STATUS_OPTIONS}
                    value={item.status}
                    onChange={(value) => void updateStatus(item.id, value)}
                  />
                </div>
              ))}
          </CardBody>
        </Card>
      ))}
      <p className="tiny dim">
        Use the current Private Pilot Airman Certification Standards and review
        every item with her instructor; this is intentionally not an exhaustive
        regulatory checklist.
      </p>
    </div>
  );
}

function InstructorReport() {
  const { data } = useAppData();
  const today = todayIso();
  const totals = flightLogTotals(data.journalEntries);
  const activity = flightActivity(data.journalEntries, today);
  const readiness = readinessSummary(data.toolkit.readinessItems);
  const activeGoals = data.goals.filter((goal) => goal.status === "working_on");
  const feedback = data.journalEntries
    .filter((entry) => entry.instructorFeedback.trim())
    .slice(0, 5);

  return (
    <div className="stack stack--5 toolkit-print-area">
      <div className="row row--between toolkit-no-print">
        <p className="small muted">
          Print this before an instructor progress discussion.
        </p>
        <Button variant="primary" onClick={() => window.print()}>
          Print report
        </Button>
      </div>
      <Card>
        <CardHeader
          title={`${data.profile.pilotName || "Student pilot"} — Training Progress`}
          eyebrow={formatLongDate(today, today)}
        />
        <CardBody>
          <div className="report-grid">
            <ReportMetric
              label="Total time"
              value={`${formatHours(totals.totalTime)} hr`}
            />
            <ReportMetric
              label="Training received"
              value={`${formatHours(totals.dualReceived)} hr`}
            />
            <ReportMetric
              label="Solo"
              value={`${formatHours(totals.soloTime)} hr`}
            />
            <ReportMetric
              label="Last 30 days"
              value={`${formatHours(activity.hoursLast30Days)} hr`}
            />
            <ReportMetric
              label="Logged flights"
              value={String(totals.flights)}
            />
            <ReportMetric
              label="Checklist ready"
              value={`${readiness.ready}/${readiness.total}`}
            />
          </div>
        </CardBody>
      </Card>
      <div className="toolkit-two-column">
        <Card>
          <CardHeader title="Current goals" />
          <CardBody>
            {activeGoals.length ? (
              <ul className="toolkit-list">
                {activeGoals.map((goal) => (
                  <li key={goal.id}>
                    {goal.title}
                    {goal.confidence
                      ? ` — confidence ${goal.confidence}/5`
                      : ""}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="small muted">No goals marked Working On.</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Recent instructor feedback" />
          <CardBody>
            {feedback.length ? (
              <ul className="toolkit-list">
                {feedback.map((entry) => (
                  <li key={entry.id}>
                    <span className="dim">{formatShortDate(entry.date)}:</span>{" "}
                    “{entry.instructorFeedback}”
                  </li>
                ))}
              </ul>
            ) : (
              <p className="small muted">
                No instructor feedback recorded yet.
              </p>
            )}
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader title="Discussion notes" />
        <CardBody>
          <div
            className="report-writing-lines"
            aria-label="Blank lines for printed notes"
          />
        </CardBody>
      </Card>
      <p className="tiny dim">
        Personal summary generated from Her Flight Deck. Confirm all flight time
        against the authoritative logbook.
      </p>
    </div>
  );
}

function ReportMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="toolkit-number numeric">{value}</p>
      <p className="tiny dim">{label}</p>
    </div>
  );
}

/**
 * Settings and her saved medical record disagree about when the medical
 * expires. She says which matches her certificate; only then is the other
 * one updated to match.
 *
 * The first choice owns the outcome. A synchronous guard, held by the Toolkit
 * page so it survives a tab switch, stops a second click (even within the same
 * render) from queueing the opposite choice, and the
 * write itself re-reads both dates inside the serialized mutation: a choice
 * made against dates that have since changed writes nothing, and the dates as
 * they now stand are shown again.
 */
function MedicalDateConflictCard({
  state,
  guard,
  choosing,
}: {
  state: ToolkitState;
  guard: PendingChoice;
  choosing: boolean;
}) {
  const { data, mutate } = useAppData();
  const [staleNotice, setStaleNotice] = useState(false);
  const conflict = medicalDateConflict(data.profile, state.credentials);
  if (!conflict) return null;
  const { settingsDate, record } = conflict;
  const today = todayIso();

  const choose = async (authority: MedicalDateChoice["authority"]) => {
    if (!guard.acquire()) return;
    setStaleNotice(false);
    const choice: MedicalDateChoice = { authority, settingsDate, recordId: record.id, recordDate: record.expiresOn };
    try {
      const outcome = await mutate(async (repos) => {
        const [profile, toolkit] = await Promise.all([repos.profile.get(), repos.toolkit.get()]);
        const plan = reconcileMedicalDates(profile, toolkit.credentials, choice);
        if (plan.write === "profile") await repos.profile.update({ medicalExpiry: plan.medicalExpiry });
        if (plan.write === "record") await repos.toolkit.save({ ...toolkit, credentials: plan.credentials });
        return plan.write;
      });
      // null: the write failed and the app's error message says so; both
      // dates stay as they were and she can choose again.
      if (outcome === "none") setStaleNotice(true);
    } finally {
      guard.release();
    }
  };

  return (
    <Card>
      <CardHeader title="Two different medical dates" />
      <CardBody>
        <div className="stack stack--3" role="note" aria-label="Medical dates differ" aria-busy={choosing}>
          <p className="small">
            Settings says your medical expires {formatLongDate(settingsDate, today)}. Your saved
            record “{record.title}” says {formatLongDate(record.expiresOn, today)}. Which one
            matches your certificate? Nothing changes until you choose.
          </p>
          {staleNotice ? (
            <p className="small" role="status">
              These dates changed before your choice was saved, so nothing was changed. Here they
              are as they stand now.
            </p>
          ) : null}
          <div className="row row--wrap">
            <Button size="small" disabled={choosing} onClick={() => void choose("record")}>
              {formatLongDate(record.expiresOn, today)} is right
            </Button>
            <Button size="small" disabled={choosing} onClick={() => void choose("settings")}>
              {formatLongDate(settingsDate, today)} is right
            </Button>
          </div>
          {choosing ? (
            <p className="tiny dim" role="status">
              Saving your choice…
            </p>
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}

function RecordsTool({
  state,
  save,
  medicalChoice,
  medicalChoosing,
}: ToolProps & { medicalChoice: PendingChoice; medicalChoosing: boolean }) {
  const { data, deleteWithUndo } = useAppData();
  const [draft, setDraft] = useState({
    type: "pilot_certificate" as CredentialType,
    title: "",
    identifier: "",
    issuedOn: "",
    expiresOn: "",
    notes: "",
    materialId: "",
  });
  const [removing, setRemoving] = useState<CredentialRecord | null>(null);
  const today = todayIso();

  const add = async () => {
    if (!draft.title.trim()) return;
    const record: CredentialRecord = {
      id: newId(),
      type: draft.type,
      title: draft.title.trim(),
      identifier: draft.identifier.trim(),
      issuedOn: draft.issuedOn || null,
      expiresOn: draft.expiresOn || null,
      notes: draft.notes.trim(),
      materialId: draft.materialId || null,
    };
    if (
      await save((current) => ({
        ...current,
        credentials: [...current.credentials, record],
      }))
    )
      setDraft({
        type: "pilot_certificate",
        title: "",
        identifier: "",
        issuedOn: "",
        expiresOn: "",
        notes: "",
        materialId: "",
      });
  };

  return (
    <div className="stack stack--5">
      <MedicalDateConflictCard state={state} guard={medicalChoice} choosing={medicalChoosing} />
      <Card>
        <CardHeader
          title="Add a certificate or record"
          eyebrow="Private organizer"
        />
        <CardBody>
          <div className="form-grid">
            <Field label="Record type">
              <Select
                options={CREDENTIAL_TYPE_OPTIONS}
                value={draft.type}
                onChange={(type) => setDraft({ ...draft, type })}
              />
            </Field>
            <Field label="Title">
              <TextInput
                value={draft.title}
                placeholder="Third-class medical"
                onChange={(event) =>
                  setDraft({ ...draft, title: event.target.value })
                }
              />
            </Field>
            <Field
              label="Certificate or reference number"
              hint="Optional. Stored only on this computer."
            >
              <TextInput
                value={draft.identifier}
                onChange={(event) =>
                  setDraft({ ...draft, identifier: event.target.value })
                }
              />
            </Field>
            <Field label="Issued">
              <TextInput
                type="date"
                value={draft.issuedOn}
                onChange={(event) =>
                  setDraft({ ...draft, issuedOn: event.target.value })
                }
              />
            </Field>
            <Field label="Expires">
              <TextInput
                type="date"
                value={draft.expiresOn}
                onChange={(event) =>
                  setDraft({ ...draft, expiresOn: event.target.value })
                }
              />
            </Field>
            <Field
              label="Attached library file"
              hint="Upload document copies in the Study Library first."
            >
              <Select
                placeholder="No attachment"
                options={data.materials
                  .filter((item) => item.filePath)
                  .map((item) => ({ value: item.id, label: item.title }))}
                value={draft.materialId}
                onChange={(materialId) => setDraft({ ...draft, materialId })}
              />
            </Field>
            <Field label="Notes" full>
              <TextArea
                rows={2}
                value={draft.notes}
                onChange={(event) =>
                  setDraft({ ...draft, notes: event.target.value })
                }
              />
            </Field>
          </div>
          <div
            className="row row--wrap"
            style={{ marginTop: "var(--space-4)" }}
          >
            <Button variant="primary" onClick={() => void add()}>
              Add record
            </Button>
            <Link className="button button--secondary" to="/study">
              Upload a document copy
            </Link>
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          title="Certificates, endorsements, and records"
          action={
            <span className="tiny dim">{state.credentials.length} saved</span>
          }
        />
        <CardBody flush>
          {state.credentials.length === 0 ? (
            <p className="toolkit-empty small muted">No records saved yet.</p>
          ) : (
            state.credentials.map((record) => {
              const remaining = record.expiresOn
                ? daysUntil(record.expiresOn, today)
                : null;
              const material = data.materials.find(
                (item) => item.id === record.materialId,
              );
              return (
                <div
                  className="toolkit-row toolkit-row--record"
                  key={record.id}
                >
                  <div>
                    <p className="strong">{record.title}</p>
                    <p className="tiny dim">
                      {CREDENTIAL_TYPE_LABELS[record.type]}
                      {record.identifier ? ` · ${record.identifier}` : ""}
                    </p>
                    {record.expiresOn ? (
                      <p
                        className="tiny"
                        style={{
                          color:
                            remaining != null && remaining <= 30
                              ? "var(--status-overdue)"
                              : "var(--text-tertiary)",
                        }}
                      >
                        Expires {formatShortDate(record.expiresOn)}
                        {remaining != null && remaining < 0
                          ? " · may be expired"
                          : ""}
                      </p>
                    ) : null}
                  </div>
                  <div className="row row--wrap">
                    {material ? (
                      <Link
                        className="button button--ghost button--small"
                        to={`/study/${material.id}`}
                      >
                        Open copy
                      </Link>
                    ) : null}
                    <Button
                      size="small"
                      variant="danger"
                      className="destructive-action"
                      onClick={() => setRemoving(record)}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </CardBody>
      </Card>
      <p className="tiny dim">
        This organizer does not replace original certificates, endorsements,
        test reports, identification, or records required by the FAA or flight
        school.
      </p>
      <ConfirmDialog
        open={removing !== null}
        title="Remove this record?"
        message="This removes the organizer entry. An attached Study Library file is not deleted."
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          if (!removing) return;
          const record = removing;
          setRemoving(null);
          deleteWithUndo({
            ids: [record.id],
            label: record.title,
            run: async (repos) => {
              const current = await repos.toolkit.get();
              await repos.toolkit.save({
                ...current,
                credentials: current.credentials.filter(
                  (item) => item.id !== record.id,
                ),
              });
            },
          });
        }}
      />
    </div>
  );
}

function CostTool({ state, save }: ToolProps) {
  const { data } = useAppData();
  const totals = flightLogTotals(data.journalEntries);
  const forecast = trainingCostForecast(totals, data.transactions, state, data.journalEntries);
  const [hourly, setHourly] = useState(String(state.estimatedHourlyCost / 100));
  const [additional, setAdditional] = useState(
    String(state.additionalTrainingCosts / 100),
  );
  const saveAssumptions = () =>
    save((current) => ({
      ...current,
      estimatedHourlyCost: Math.max(0, Math.round(Number(hourly || 0) * 100)),
      additionalTrainingCosts: Math.max(
        0,
        Math.round(Number(additional || 0) * 100),
      ),
    }));

  return (
    <div className="stack stack--5">
      <Card variant="accent">
        <CardHeader
          title="Private pilot cost forecast"
          eyebrow="Planning estimate"
        />
        <CardBody>
          <div className="report-grid">
            <ReportMetric
              label="Tracked training spending"
              value={formatMoney(forecast.spent)}
            />
            <ReportMetric
              label="Planning hours remaining to 40"
              value={`${formatHours(forecast.remainingHours)} hr`}
            />
            <ReportMetric
              label="Estimated remaining"
              value={formatMoney(forecast.estimatedRemaining)}
            />
            <ReportMetric
              label="Projected tracked + remaining"
              value={formatMoney(forecast.projectedTotal)}
            />
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Forecast assumptions" />
        <CardBody>
          <div className="form-grid">
            <Field
              label="Estimated cost per flight hour"
              hint={
                forecast.observedHourly !== null
                  ? `The forecast currently uses ${formatMoney(forecast.observedHourly)} per flight hour: lesson costs from ${forecast.observedLessons} ${forecast.observedLessons === 1 ? "lesson" : "lessons"} with logged flight time.`
                  : "Used until a lesson has both a recorded cost and a linked journal entry with its total time."
              }
            >
              <TextInput
                type="number"
                min="0"
                step="1"
                value={hourly}
                onChange={(event) => setHourly(event.target.value)}
              />
            </Field>
            <Field
              label="Additional remaining costs"
              hint="Ground school, tests, medical, supplies, fees, and a personal buffer."
            >
              <TextInput
                type="number"
                min="0"
                step="1"
                value={additional}
                onChange={(event) => setAdditional(event.target.value)}
              />
            </Field>
          </div>
          <Button
            variant="primary"
            style={{ marginTop: "var(--space-4)" }}
            onClick={() => void saveAssumptions()}
          >
            Save assumptions
          </Button>
        </CardBody>
      </Card>
      <p className="tiny dim">
        This is a budget scenario, not a quote. The 40-hour figure is a Part 61
        planning reference; proficiency, school program, location, aircraft,
        instructor, weather, and repeat training can materially change cost and
        time.
      </p>
    </div>
  );
}

const SAFETY_ITEMS: Array<
  [
    keyof Pick<
      SafetyCheck,
      | "illnessOkay"
      | "medicationOkay"
      | "stressOkay"
      | "alcoholOkay"
      | "fatigueOkay"
      | "emotionOkay"
      | "weatherReviewed"
      | "aircraftReviewed"
      | "personalMinimumsMet"
    >,
    string,
    string,
  ]
> = [
  [
    "illnessOkay",
    "Illness",
    "I checked for symptoms that could affect this flight.",
  ],
  [
    "medicationOkay",
    "Medication",
    "I reviewed medication effects and applicable guidance.",
  ],
  [
    "stressOkay",
    "Stress",
    "I honestly considered workload and emotional stress.",
  ],
  ["alcoholOkay", "Alcohol", "I considered alcohol limits and impairment."],
  ["fatigueOkay", "Fatigue", "I am satisfied with sleep and alertness."],
  [
    "emotionOkay",
    "Emotion",
    "I honestly considered anger, anxiety, depression, and other emotions.",
  ],
  [
    "weatherReviewed",
    "Weather",
    "Weather was reviewed with appropriate sources and guidance.",
  ],
  [
    "aircraftReviewed",
    "Aircraft",
    "Aircraft status and required preflight work will be checked.",
  ],
  [
    "personalMinimumsMet",
    "Personal minimums",
    "Conditions fit the minimums agreed with my instructor.",
  ],
];

function emptySafety(): Omit<SafetyCheck, "id" | "date"> {
  return {
    illnessOkay: false,
    medicationOkay: false,
    stressOkay: false,
    alcoholOkay: false,
    fatigueOkay: false,
    emotionOkay: false,
    weatherReviewed: false,
    aircraftReviewed: false,
    personalMinimumsMet: false,
    decision: "discuss",
    notes: "",
  };
}

function SafetyTool({ state, save }: ToolProps) {
  const [draft, setDraft] = useState(emptySafety);
  const completed = SAFETY_ITEMS.filter(([key]) => draft[key]).length;
  const record = async () => {
    const check: SafetyCheck = { id: newId(), date: nowIso(), ...draft };
    if (
      await save((current) => ({
        ...current,
        safetyChecks: [check, ...current.safetyChecks].slice(0, 100),
      }))
    )
      setDraft(emptySafety());
  };
  return (
    <div className="toolkit-two-column">
      <Card>
        <CardHeader
          title="Preflight personal check-in"
          eyebrow="IMSAFE + preparation"
          action={
            <Badge
              tone={completed === SAFETY_ITEMS.length ? "complete" : "due"}
            >
              {completed}/{SAFETY_ITEMS.length} reviewed
            </Badge>
          }
        />
        <CardBody>
          <div className="stack stack--3">
            {SAFETY_ITEMS.map(([key, label, meta]) => (
              <Checkbox
                key={key}
                checked={draft[key]}
                onChange={(checked) => setDraft({ ...draft, [key]: checked })}
                label={label}
                meta={meta}
              />
            ))}
            <Field label="My decision">
              <Select
                options={[
                  { value: "go", label: "Go — no concern identified" },
                  { value: "discuss", label: "Discuss with instructor" },
                  { value: "no_go", label: "No-go" },
                ]}
                value={draft.decision}
                onChange={(decision: SafetyDecision) =>
                  setDraft({ ...draft, decision })
                }
              />
            </Field>
            <Field label="Notes">
              <TextArea
                rows={3}
                value={draft.notes}
                onChange={(event) =>
                  setDraft({ ...draft, notes: event.target.value })
                }
              />
            </Field>
            <Button variant="primary" onClick={() => void record()}>
              Save this check-in
            </Button>
            <p className="tiny dim">
              This prompt never makes a go/no-go decision. Stop and involve the
              instructor whenever anything is uncertain.
            </p>
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Recent check-ins" />
        <CardBody>
          {state.safetyChecks.length ? (
            <div className="stack stack--3">
              {state.safetyChecks.slice(0, 8).map((check) => (
                <div className="row row--between" key={check.id}>
                  <div>
                    <p className="small">
                      {new Date(check.date).toLocaleString()}
                    </p>
                    <p className="tiny dim">
                      {SAFETY_ITEMS.filter(([key]) => check[key]).length}/
                      {SAFETY_ITEMS.length} reviewed
                    </p>
                  </div>
                  <Badge
                    tone={
                      check.decision === "go"
                        ? "complete"
                        : check.decision === "no_go"
                          ? "overdue"
                          : "due"
                    }
                  >
                    {check.decision === "no_go"
                      ? "No-go"
                      : check.decision === "go"
                        ? "Go"
                        : "Discuss"}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="small muted">
              No personal safety check-ins saved yet.
            </p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function QuizTool({ state, save }: ToolProps) {
  const [running, setRunning] = useState(false);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<number[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);
  const question = QUIZ_QUESTIONS[index]!;
  const best = state.quizAttempts.length
    ? Math.max(...state.quizAttempts.map((item) => item.score / item.total))
    : null;

  const start = () => {
    setRunning(true);
    setIndex(0);
    setAnswers([]);
    setSelected(null);
    setChecked(false);
  };
  const next = async () => {
    if (selected === null) return;
    const nextAnswers = [...answers, selected];
    if (index === QUIZ_QUESTIONS.length - 1) {
      const attempt = makeQuizAttempt(nextAnswers, nowIso(), newId());
      await save((current) => ({
        ...current,
        quizAttempts: [attempt, ...current.quizAttempts].slice(0, 50),
      }));
      setRunning(false);
      return;
    }
    setAnswers(nextAnswers);
    setIndex(index + 1);
    setSelected(null);
    setChecked(false);
  };

  if (!running)
    return (
      <div className="toolkit-two-column">
        <Card variant="accent">
          <CardHeader title="Knowledge quiz" eyebrow="Eight-question review" />
          <CardBody>
            <p className="small muted">
              Practice broad private-pilot knowledge topics and see which areas
              deserve another study session.
            </p>
            <div
              className="toolkit-hero-metrics"
              style={{ marginTop: "var(--space-5)" }}
            >
              <ReportMetric
                label="Attempts"
                value={String(state.quizAttempts.length)}
              />
              <ReportMetric
                label="Best score"
                value={best == null ? "—" : `${Math.round(best * 100)}%`}
              />
            </div>
            <Button
              variant="primary"
              style={{ marginTop: "var(--space-5)" }}
              onClick={start}
            >
              Start quiz
            </Button>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Recent results" />
          <CardBody>
            {state.quizAttempts.length ? (
              <div className="stack stack--3">
                {state.quizAttempts.slice(0, 6).map((attempt) => (
                  <div key={attempt.id}>
                    <div className="row row--between">
                      <span className="small">
                        {new Date(attempt.date).toLocaleDateString()}
                      </span>
                      <Badge
                        tone={
                          attempt.score / attempt.total >= 0.8
                            ? "complete"
                            : "study"
                        }
                      >
                        {attempt.score}/{attempt.total}
                      </Badge>
                    </div>
                    {attempt.weakTopics.length ? (
                      <p className="tiny dim">
                        Review:{" "}
                        {attempt.weakTopics
                          .map((topic) => TOPIC_LABELS[topic])
                          .join(", ")}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="small muted">No attempts yet.</p>
            )}
          </CardBody>
        </Card>
      </div>
    );

  return (
    <Card>
      <CardHeader
        title={`Question ${index + 1} of ${QUIZ_QUESTIONS.length}`}
        eyebrow={TOPIC_LABELS[question.topic]}
      />
      <CardBody>
        <div className="quiz">
          <p className="display quiz__prompt">{question.prompt}</p>
          {question.choices.map((choice, choiceIndex) => (
            <button
              type="button"
              disabled={checked}
              className={`quiz__choice${selected === choiceIndex ? " is-selected" : ""}${checked && choiceIndex === question.correct ? " is-correct" : ""}${checked && selected === choiceIndex && choiceIndex !== question.correct ? " is-wrong" : ""}`}
              onClick={() => setSelected(choiceIndex)}
              key={choice}
            >
              {choice}
            </button>
          ))}
          {checked ? (
            <p className="quiz__explanation small">
              {selected === question.correct ? "Correct. " : "Not quite. "}
              {question.explanation}
            </p>
          ) : null}
          <div className="row">
            {!checked ? (
              <Button
                variant="primary"
                disabled={selected === null}
                onClick={() => setChecked(true)}
              >
                Check answer
              </Button>
            ) : (
              <Button variant="primary" onClick={() => void next()}>
                {index === QUIZ_QUESTIONS.length - 1
                  ? "Finish quiz"
                  : "Next question"}
              </Button>
            )}
            <Button variant="ghost" onClick={() => setRunning(false)}>
              Exit
            </Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

function ReminderTool({ state, save }: ToolProps) {
  const { data } = useAppData();
  const [leadDays, setLeadDays] = useState(String(state.reminderLeadDays));
  const reminders = useMemo(
    () =>
      buildReminders({
        actions: data.actions,
        events: data.events,
        credentials: state.credentials,
        profile: data.profile,
        homework: data.homework,
        leadDays: reminderLeadDays(leadDays, 0),
      }),
    [data.actions, data.events, data.profile, data.homework, leadDays, state.credentials],
  );

  const setEnabled = async (enabled: boolean) => {
    if (
      enabled &&
      "Notification" in window &&
      Notification.permission === "default"
    ) {
      try {
        await Notification.requestPermission();
      } catch {
        /* The reminder list is still available here. */
      }
    }
    await save((current) => ({ ...current, remindersEnabled: enabled }));
  };
  return (
    <div className="toolkit-two-column">
      <Card>
        <CardHeader title="Training reminders" eyebrow="On this computer" />
        <CardBody>
          <div className="stack stack--4">
            <Checkbox
              checked={state.remindersEnabled}
              onChange={(enabled) => void setEnabled(enabled)}
              strikethrough={false}
              label="Show system reminders"
              meta="Includes due actions, scheduled training, medical dates, and saved record expirations."
            />
            <Field label="How many days ahead">
              <TextInput
                type="number"
                min="0"
                max="90"
                value={leadDays}
                onChange={(event) => setLeadDays(event.target.value)}
              />
            </Field>
            <Button
              variant="primary"
              onClick={() =>
                void save((current) => ({
                  ...current,
                  reminderLeadDays: reminderLeadDays(leadDays, 0),
                }))
              }
            >
              Save reminder window
            </Button>
            <p className="tiny dim">
              Your reminder list is here in Pilot Toolkit. System reminders can
              appear once a day while the app is running, if you allow notifications.
            </p>
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          title="Coming up"
          action={
            <span className="tiny dim">{reminders.length} reminders</span>
          }
        />
        <CardBody>
          {reminders.length ? (
            <div className="stack stack--3">
              {reminders.slice(0, 10).map((item) => (
                <div className="row row--between" key={item.id} style={{ alignItems: "center" }}>
                  <div>
                    <p className="small">{item.title}</p>
                    <p className="tiny dim">{item.detail}</p>
                  </div>
                  <div className="row" style={{ gap: "var(--space-2)", alignItems: "center" }}>
                    {item.homeworkId ? (
                      <Link
                        className="button button--secondary button--small"
                        to={`/study/homework/${item.homeworkId}`}
                      >
                        Open homework
                      </Link>
                    ) : null}
                    <Badge tone={item.urgent ? "overdue" : "due"}>
                      {formatShortDate(item.date)}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="small muted">
              Nothing falls inside this reminder window.
            </p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function CareerTool({ state, save }: ToolProps) {
  const { data } = useAppData();
  const totals = flightLogTotals(data.journalEntries);
  const [draft, setDraft] = useState({
    targetAirline: state.targetAirline,
    careerSummary: state.careerSummary,
    nextCareerStep: state.nextCareerStep,
  });
  const completedMilestones = data.milestones.filter(
    (item) => item.status === "completed",
  );
  const saveCareer = () => save((current) => ({ ...current, ...draft }));
  return (
    <div className="stack stack--5 toolkit-print-area">
      <div className="row row--between toolkit-no-print">
        <p className="small muted">
          Build a master career snapshot now and keep improving it.
        </p>
        <Button onClick={() => window.print()}>Print portfolio</Button>
      </div>
      <Card variant="accent">
        <CardHeader
          title={`${data.profile.pilotName || "Future airline pilot"} — Aviation Portfolio`}
          eyebrow="Career snapshot"
        />
        <CardBody>
          <div className="report-grid">
            <ReportMetric
              label="Total flight time"
              value={`${formatHours(totals.totalTime)} hr`}
            />
            <ReportMetric
              label="PIC"
              value={`${formatHours(totals.picTime)} hr`}
            />
            <ReportMetric
              label="Cross-country"
              value={`${formatHours(totals.crossCountryTime)} hr`}
            />
            <ReportMetric
              label="Completed milestones"
              value={String(completedMilestones.length)}
            />
          </div>
        </CardBody>
      </Card>
      <div className="toolkit-two-column">
        <Card>
          <CardHeader title="Career direction" />
          <CardBody>
            <div className="stack stack--4">
              <Field label="Airline or flying career target">
                <TextInput
                  value={draft.targetAirline}
                  placeholder="Regional airline, major airline, cargo…"
                  onChange={(event) =>
                    setDraft({ ...draft, targetAirline: event.target.value })
                  }
                />
              </Field>
              <Field label="Professional summary">
                <TextArea
                  rows={5}
                  value={draft.careerSummary}
                  placeholder="A short summary of training, strengths, experience, and goals."
                  onChange={(event) =>
                    setDraft({ ...draft, careerSummary: event.target.value })
                  }
                />
              </Field>
              <Field label="Next career step">
                <TextArea
                  rows={3}
                  value={draft.nextCareerStep}
                  onChange={(event) =>
                    setDraft({ ...draft, nextCareerStep: event.target.value })
                  }
                />
              </Field>
              <Button variant="primary" onClick={() => void saveCareer()}>
                Save portfolio
              </Button>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Training achievements" />
          <CardBody>
            <div className="stack stack--4">
              <div>
                <p className="tiny strong dim">Certificate goal</p>
                <p>{data.profile.certificateGoal}</p>
              </div>
              <div>
                <p className="tiny strong dim">Completed milestones</p>
                {completedMilestones.length ? (
                  <ul className="toolkit-list">
                    {completedMilestones.map((item) => (
                      <li key={item.id}>{item.title}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="small muted">
                    Milestones will appear here as they are completed.
                  </p>
                )}
              </div>
              <div>
                <p className="tiny strong dim">Saved credentials</p>
                {state.credentials.length ? (
                  <ul className="toolkit-list">
                    {state.credentials.map((item) => (
                      <li key={item.id}>{item.title}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="small muted">
                    Add certificates and records in this toolkit.
                  </p>
                )}
              </div>
            </div>
          </CardBody>
        </Card>
      </div>
      <p className="tiny dim">
        Hiring requirements change by employer and role. Verify every
        application against the employer’s current published qualifications.
      </p>
    </div>
  );
}

/** A one-at-a-time lock: `acquire` is false while an earlier choice is still saving. */
interface PendingChoice {
  acquire: () => boolean;
  release: () => void;
}

interface ToolProps {
  state: ToolkitState;
  save: (change: (current: ToolkitState) => ToolkitState) => Promise<boolean>;
}
