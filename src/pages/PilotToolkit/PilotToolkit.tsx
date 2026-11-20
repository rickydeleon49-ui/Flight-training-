import { BRING_ITEMS, daysToCheckride } from "@/logic/checkride";
import { Fragment, type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  BookIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  DocumentIcon,
  JournalIcon,
  NoteIcon,
  PlaneIcon,
  QuestionIcon,
  TargetIcon,
} from "@/components/ui/Icons";

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
  TypedDateField,
  type TypedDateFieldHandle,
  Section,
} from "@/components/ui";
import {
  CREDENTIAL_TYPE_LABELS,
  CREDENTIAL_TYPE_OPTIONS,
  READINESS_STATUS_OPTIONS,
  TOPIC_LABELS,
  type CredentialRecord,
  type CredentialType,
  type QuizAttempt,
  type ReadinessStatus,
  type PersonalMinimums,
  type SafetyCheck,
  type SafetyDecision,
  type ToolkitState,
} from "@/domain/types";
import {
  AVGAS_LB_PER_GAL,
  WB_PRACTICE,
  describeWbPractice,
  WB_ROW_KEYS,
  WB_ROW_LABELS,
  calculateWeightBalance,
  emptyWbInput,
  type WbInput,
  type WbPractice,
  type WbRowKey,
} from "@/logic/weightBalance";
import { formatLongDate, formatShortDate, nowIso, todayIso } from "@/lib/dates";
import { newId } from "@/lib/id";
import {
  compareToMinimums,
  minimumsLine,
  minimumsSummary,
  normalizePersonalMinimums,
  type MinimumVerdict,
} from "@/logic/personalMinimums";
import { densityAltitude, windComponents, type DensityResult } from "@/logic/performanceAid";
import {
  flightActivity,
  flightLogTotals,
  formatHours,
} from "@/logic/flightLog";
import {
  ENDORSEMENT_ITEMS,
  daysUntil,
  makeQuizAttempt,
  medicalDateConflict,
  type MedicalDateChoice,
  selectQuizQuestions,
  readinessSummary,
  reconcileMedicalDates,
} from "@/logic/toolkit";
import { explainMetar } from "@/logic/metarExplain";
import { explainTaf, looksLikeTaf } from "@/logic/tafExplain";
import { explainWindsAloft, feetText, levelsAround, looksLikeWindsAloft, type WindsAloftStation } from "@/logic/windsAloft";
import { explainPirep, looksLikePirep } from "@/logic/pirepExplain";
import { explainNotam, looksLikeNotam } from "@/logic/notamExplain";
import { useAppData } from "@/state/AppDataContext";
import { useLeaveGuard } from "@/state/leaveGuard";
import { TOOLKIT_UNREADABLE_MESSAGE } from "@/data/repositories/toolkitRepository";

import { ChartSymbolDrill } from "./ChartSymbolDrill";
import { AccidentCaseDrill } from "./AccidentCaseDrill";
import { InoperativeEquipmentCard } from "./InoperativeEquipmentCard";
import { FigureDrill } from "./FigureDrill";
import { SectionalDrill } from "./SectionalDrill";
import { RegCardDrill } from "./RegCardDrill";
import { E6bTrainer } from "./E6bTrainer";
import { RadioWords } from "./RadioWords";
import { WeatherPractice } from "./WeatherPractice";
import { HoursToGoCard } from "./HoursToGoCard";
import { AcsReadinessList } from "./AcsReadinessList";
import "./pilotToolkit.css";

type Tool =
  | "readiness"
  | "report"
  | "records"
  | "safety"
  | "quiz"
  | "career"
  | "metar"
  | "e6b"
  | "radio";

type ToolChoice = { id: Tool; label: string; line: string };
type ToolGroup = { id: string; label: string; tools: ToolChoice[] };
const TOOL_GROUPS: ToolGroup[] = [
  {
    id: "checkride",
    label: "Checkride and records",
    tools: [
      { id: "readiness", label: "Checkride", line: "Your plan and prep for the big day" },
      { id: "report", label: "Instructor Report", line: "A summary to share with your instructor" },
      { id: "records", label: "Certificates and endorsements", line: "Your certificates, endorsements and medical date" },
      { id: "career", label: "Career Portfolio", line: "Your hours and story in one place" },
    ],
  },
  {
    id: "plan",
    label: "Plan a flight",
    tools: [
      { id: "metar", label: "Weather and NOTAM Explainer", line: "METAR, TAF, winds aloft, PIREPs and NOTAMs in plain words" },
      { id: "e6b", label: "Flight computer", line: "Practice wind and fuel math" },
      { id: "safety", label: "Safety Check", line: "Your personal minimums before a flight" },
    ],
  },
  {
    id: "practice",
    label: "Practice",
    tools: [
      { id: "quiz", label: "Quizzes", line: "Short questions on any topic" },
      { id: "radio", label: "Radio words", line: "Phrases for the radio" },
    ],
  },
];
const TOOL_ICONS: Record<Tool, (p: { size?: number; className?: string }) => ReactElement> = {
  readiness: TargetIcon,
  report: DocumentIcon,
  metar: NoteIcon,
  e6b: ClockIcon,
  safety: CheckIcon,
  quiz: QuestionIcon,
  radio: JournalIcon,
  records: BookIcon,
  career: PlaneIcon,
};
const TOOLS: ToolChoice[] = TOOL_GROUPS.flatMap((group) => group.tools);
/** Career Portfolio stays out of the home tiles unless Settings turns it on; the tool itself is kept. */
function visibleGroups(showCareer: boolean): ToolGroup[] {
  return TOOL_GROUPS.map((group) => ({
    ...group,
    tools: group.tools.filter((item) => item.id !== "career" || showCareer),
  }));
}

/** `?tool=quiz` opens that tool (the Study Library's Practice test link); anything else shows the home of tool tiles. */
export function toolFrom(value: string | null): Tool | null {
  return TOOLS.find((choice) => choice.id === value)?.id ?? null;
}

const METAR_EXAMPLE = "METAR KSFO 141756Z 28012G20KT 10SM FEW008 BKN015 16/11 A3002 RMK AO2 SLP168";
const TAF_EXAMPLE =
  "TAF KSFO 141120Z 1412/1518 28012KT P6SM FEW008 BKN015 FM141800 29015G25KT P6SM SCT035 TEMPO 1420/1424 3SM -RA BKN012 BECMG 1500/1502 VRB03KT 2SM BR OVC006";

const FB_EXAMPLE = [
  "FT  3000    6000    9000   12000   18000   24000  30000  34000  39000",
  // Made-up values that follow the rules: no wind within 1,500 ft of the station, no temperature within 2,500 ft.
  "SFO 9900 2725+11 2734+05 2740-01 2752-13 2763-25 277340 278148 279054",
  "DEN              2214+05 2320-01 2427-13 2538-25 265240 265848 266154",
].join("\n");
// Made-up, well-formed domestic NOTAM (fictional numbers) following the order's App. A pattern.
const NOTAM_EXAMPLE = "!CLE 11/045 CLE TWY L CLSD 2611201300-2611202100";
const PIREP_EXAMPLE =
  "UA /OV OKC063064/TM 1522/FL080/TP C172/SK BKN065-TOP090/WX FV03SM HZ/TA M05/WV 270030KT/TB LGT-MOD CHOP/IC LGT RIME/RM SYNTHETIC EXAMPLE";

function TokenList({ tokens }: { tokens: { raw: string; meaning: string }[] }) {
  return (
    <ul className="stack stack--2">
      {tokens.map((token, index) => (
        <li key={index}>
          <strong>{token.raw}</strong>: {token.meaning}
        </li>
      ))}
    </ul>
  );
}

function WindsAloftView({ stations, cruise }: { stations: WindsAloftStation[]; cruise: string }) {
  const altitude = Number(cruise);
  const pick = cruise.trim() !== "" && Number.isFinite(altitude) && altitude > 0 ? altitude : null;
  return (
    <div className="stack stack--3" aria-label="Decoded winds aloft">
      {stations.map((station, index) => {
        const around = pick === null ? null : levelsAround(station, pick);
        return (
          <details key={station.station} open={index === 0} aria-label={`Station ${station.station}`}>
            <summary><strong>{station.station}</strong></summary>
            <div className="stack stack--2">
              <TokenList
                tokens={station.entries.map((entry) => ({
                  raw: entry.raw || "(blank)",
                  meaning: `${feetText(entry.altitude)}: ${entry.meaning}`,
                }))}
              />
              {station.unplaced.length ? <TokenList tokens={station.unplaced} /> : null}
              {around ? (
                <div aria-label={`Your altitude at ${station.station}`}>
                  <p>
                    {around.exact
                      ? `At ${feetText(pick!)}: ${around.exact.meaning}.`
                      : around.lower && around.upper
                        ? `Your ${feetText(pick!)} sits between the ${feetText(around.lower.altitude)} level (${around.lower.meaning}) and the ${feetText(around.upper.altitude)} level (${around.upper.meaning}). Read both; no estimate is made here.`
                        : "That altitude is outside the levels in this table."}
                  </p>
                </div>
              ) : null}
            </div>
          </details>
        );
      })}
    </div>
  );
}

function MetarTool({ minimums }: { minimums?: PersonalMinimums }) {
  const [text, setText] = useState("");
  const [cruise, setCruise] = useState("");
  // Detection order: NOTAM (the "!" is unambiguous), then PIREP, winds aloft, TAF, then METAR.
  const kind = looksLikeNotam(text)
    ? "notam"
    : looksLikePirep(text)
    ? "pirep"
    : looksLikeWindsAloft(text)
      ? "fb"
      : looksLikeTaf(text)
        ? "taf"
        : "metar";
  const result = useMemo(() => (kind === "metar" ? explainMetar(text) : null), [kind, text]);
  const taf = useMemo(() => (kind === "taf" ? explainTaf(text) : null), [kind, text]);
  const pirep = useMemo(() => (kind === "pirep" ? explainPirep(text) : null), [kind, text]);
  const notam = useMemo(() => (kind === "notam" ? explainNotam(text) : null), [kind, text]);
  const fb = useMemo(() => (kind === "fb" ? explainWindsAloft(text) : null), [kind, text]);
  return (
    <Card variant="grouped">
      <CardHeader
        title="Weather and NOTAM Explainer"
      />
      <CardBody>
        <p className="small muted">Study aid. Check official weather briefings and your instructor.</p>
        <Field label="Paste or type a METAR, TAF, winds aloft (FB), PIREP or NOTAM">
          <TextArea
            rows={3}
            value={text}
            placeholder="METAR KJFK 141651Z 28015G25KT 10SM FEW040 08/M02 A2992"
            onChange={(event) => setText(event.target.value)}
          />
        </Field>
        <div className="row">
          <Button variant="secondary" onClick={() => setText(METAR_EXAMPLE)}>Try an example METAR</Button>
          <Button variant="secondary" onClick={() => setText(TAF_EXAMPLE)}>Try an example TAF</Button>
          <Button variant="secondary" onClick={() => setText(FB_EXAMPLE)}>Try an example winds aloft</Button>
          <Button variant="secondary" onClick={() => setText(PIREP_EXAMPLE)}>Try an example PIREP</Button>
          <Button variant="secondary" onClick={() => setText(NOTAM_EXAMPLE)}>Try an example NOTAM</Button>
        </div>
        <p className="small muted">
          AIRMETs for the lower 48 states are now graphical only (G-AIRMET), so look at them on aviationweather.gov.
        </p>
        {fb ? (
          <>
            <Field label="Your cruise altitude (ft MSL)" hint="Optional. Shows the two forecast levels around it. Winds aloft altitudes are MSL.">
              <TextInput
                inputMode="numeric"
                value={cruise}
                placeholder="e.g. 8000"
                onChange={(event) => setCruise(event.target.value)}
              />
            </Field>
            <WindsAloftView stations={fb.stations} cruise={cruise} />
          </>
        ) : notam ? (
          <div className="stack stack--3" aria-label="Decoded NOTAM">
            <TokenList tokens={notam.tokens} />
            <p className="small muted">
              The US plans to move to the ICAO NOTAM format in the coming years; this explainer reads today&apos;s US domestic format.
            </p>
          </div>
        ) : pirep ? (
          <div className="stack stack--3" aria-label="Decoded pilot report">
            <TokenList tokens={pirep.tokens} />
          </div>
        ) : taf ? (
          <div className="stack stack--3" aria-label="Decoded forecast">
            <TokenList tokens={taf.header} />
            {taf.periods.map((period, index) => (
              <section key={index} className="stack stack--2" aria-label={period.label}>
                <h3>{period.label}</h3>
                <p>{period.meaning}:</p>
                <TokenList tokens={period.tokens} />
                <p>{period.categoryNote}</p>
              </section>
            ))}
          </div>
        ) : result && result.tokens.length ? (
          <div className="stack stack--3" aria-label="Decoded groups">
            <TokenList tokens={result.tokens} />
            <p>{result.categoryNote}</p>
          </div>
        ) : null}
        <div className="stack stack--2">
          <h3>Weather practice</h3>
          <WeatherPractice minimums={minimums} />
        </div>
      </CardBody>
    </Card>
  );
}

export function PilotToolkit() {
  const { data, mutate } = useAppData();
  const [params, setParams] = useSearchParams();
  const tool = toolFrom(params.get("tool"));
  const choice = TOOLS.find((entry) => entry.id === tool) ?? null;
  const [saved, setSaved] = useState(false);
  const [quizBusy, setQuizBusy] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const homeHeading = useRef<HTMLHeadingElement>(null);
  const toolHeading = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  // Opening a tool, or coming back to the home, starts at the top and moves focus to the new heading.
  useEffect(() => {
    window.scrollTo?.(0, 0);
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    (tool ? toolHeading.current : homeHeading.current)?.focus();
  }, [tool]);
  // A quiz that is no longer on screen is no longer in progress (browser back, Quick Find).
  useEffect(() => {
    if (tool !== "quiz") setQuizBusy(false);
  }, [tool]);
  const openTool = (id: Tool) => setParams({ tool: id });
  const openHome = () => setParams({});

  // Owned here, not by the medical card, so a choice still saving keeps both
  // buttons locked when the student leaves the tool and comes back.
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
        subtitle={tool ? undefined : "Choose a tool to open it."}
        action={
          saved ? <span className="small toolkit-saved">Saved.</span> : null
        }
      />
      {data.toolkitUnreadable ? (
        <p className="small" role="status">
          {TOOLKIT_UNREADABLE_MESSAGE}
        </p>
      ) : null}
      {!tool || !choice ? (
        <section className="toolkit-home" aria-labelledby="toolkit-home-heading">
          <h2 id="toolkit-home-heading" ref={homeHeading} tabIndex={-1} className="toolkit-home__title">
            All tools
          </h2>
          {visibleGroups(data.toolkit.showCareerPortfolio === true).map((entry) => (
            <section key={entry.id} className="toolkit-group" aria-labelledby={`toolkit-group-${entry.id}`}>
              <div className="toolkit-group__head">
                <h3 id={`toolkit-group-${entry.id}`} className="toolkit-group__title">{entry.label}</h3>
              </div>
              <ul className="toolkit-links">
                {entry.tools.map((item) => {
                  const ToolIcon = TOOL_ICONS[item.id];
                  return (
                    <li key={item.id}>
                      <button type="button" className="toolkit-link" onClick={() => openTool(item.id)}>
                        <ToolIcon size={20} className="toolkit-link__icon" />
                        <span className="toolkit-link__text">
                          <span className="toolkit-link__name">{item.label}</span>
                          <span className="toolkit-link__line">{item.line}</span>
                        </span>
                        <ChevronRightIcon size={14} className="toolkit-link__chevron" aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </section>
      ) : (
      <section className="toolkit-tabpanel" aria-labelledby="toolkit-tool-heading">
        <div className="toolkit-nav">
          <Link
            to={{ search: "" }}
            className="toolkit-back"
            onClick={(event) => {
              event.preventDefault();
              // Same question as the quiz's Exit button when answers are in progress.
              if (tool === "quiz" && quizBusy) setConfirmLeave(true);
              else openHome();
            }}
          >
            <ChevronLeftIcon size={16} />
            All tools
          </Link>
        </div>
        <div className="toolkit-tool-head">
          <h2 id="toolkit-tool-heading" ref={toolHeading} tabIndex={-1} className="toolkit-tool-head__title">
            {choice.label}
          </h2>
        </div>
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
        {tool === "safety" ? (
          <>
            <SafetyTool state={data.toolkit} save={save} />
            <InoperativeEquipmentCard />
            <AccidentCaseDrill />
          </>
        ) : null}
        {tool === "quiz" ? (
          <>
            <QuizTool state={data.toolkit} save={save} onBusyChange={setQuizBusy} />
            <ChartSymbolDrill />
            <RegCardDrill />
            <FigureDrill />
            <SectionalDrill />
          </>
        ) : null}
        {tool === "radio" ? <RadioWords /> : null}
        {tool === "career" ? (
          <CareerTool state={data.toolkit} save={save} />
        ) : null}
        {tool === "metar" ? <MetarTool minimums={data.toolkit.personalMinimums} /> : null}
        {tool === "e6b" ? <E6bTrainer /> : null}
      </section>
      )}
      <ConfirmDialog
        open={confirmLeave}
        title="Leave this quiz?"
        message="Your answers in this quiz are not kept."
        confirmLabel="Leave"
        cancelLabel="Keep going"
        destructive={true}
        onConfirm={() => {
          setConfirmLeave(false);
          setQuizBusy(false);
          openHome();
        }}
        onCancel={() => setConfirmLeave(false)}
      />
    </>
  );
}

function EndorsementChecklist({ state, save }: ToolProps) {
  const checks = state.endorsementChecks ?? {};
  const update = (id: string, next: { done: boolean; date?: string }) =>
    save((current) => ({
      ...current,
      endorsementChecks: {
        ...(current.endorsementChecks ?? {}),
        [id]: next.date ? { done: next.done, date: next.date } : { done: next.done },
      },
    }));
  return (
    <details className="card material-fold" id="endorsements-checklist">
      <summary>Endorsements checklist</summary>
      <p className="tiny dim">
        Your instructor writes the real endorsements in your logbook. This list only helps you keep track.
      </p>
      <div className="stack stack--4">
        {ENDORSEMENT_ITEMS.map((item) => {
          const entry = checks[item.id];
          return (
            <div key={item.id} className="stack stack--2">
              <Checkbox
                checked={entry?.done === true}
                onChange={(done) => void update(item.id, { done, date: entry?.date })}
                label={item.label}
                meta={item.cite}
              />
              {entry?.done ? (
                <TypedDateField
                  label={`Date: ${item.label}`}
                  value={entry.date ?? ""}
                  onChange={(date) => void update(item.id, { done: true, date: date || undefined })}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </details>
  );
}

function BringChecklist({ state, save }: ToolProps) {
  const days = daysToCheckride(state.checkrideDate);
  const soon = days !== null && days <= 30;
  const checks = state.bringChecks ?? {};
  const update = (id: string, done: boolean) =>
    save((current) => ({
      ...current,
      bringChecks: { ...(current.bringChecks ?? {}), [id]: done },
    }));
  return (
    <details className="card material-fold" id="bring-checklist">
      <summary>What to bring</summary>
      {soon ? null : <p className="tiny dim">For checkride day. You can look now.</p>}
      <p className="tiny dim">Your examiner and instructor tell you exactly what to bring.</p>
      <div className="stack stack--4">
        {BRING_ITEMS.map((item) => (
          <Checkbox
            key={item.id}
            checked={checks[item.id] === true}
            onChange={(done) => void update(item.id, done)}
            label={item.label}
          />
        ))}
      </div>
    </details>
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
      <AcsReadinessList />
      <Card>
        <CardHeader
          title="Private pilot checkride prep"
          eyebrow="Planning checklist"
        />
        <CardBody>
          <div className="toolkit-hero-metrics">
            <div>
              <p className="toolkit-number numeric">
                {summary.ready}/{summary.total}
              </p>
              <p className="tiny dim">feel confident or signed off</p>
            </div>
            <div>
              <p className="toolkit-number numeric">{summary.signedOff}</p>
              <p className="tiny dim">instructor signed off</p>
            </div>
          </div>
          <div
            className="toolkit-progress"
            role="progressbar"
            aria-label="Checkride prep checklist"
            aria-valuemin={0}
            aria-valuemax={summary.total}
            aria-valuenow={summary.ready}
          >
            <span style={{ width: `${summary.percent}%` }} />
          </div>
          <p className="small muted toolkit-note">
            Your own checklist for talks with your instructor. It doesn't
            certify you or show you are eligible: only your instructor's
            endorsements and the examiner decide that.
          </p>
        </CardBody>
      </Card>

      <HoursToGoCard state={state} />

      <BringChecklist state={state} save={save} />

      <p className="small">
        <Link to="/flight-path">What the examiner looks for, by skill</Link>
      </p>

      {areas.map(([area, title]) => (
        <Card key={area} variant="grouped">
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
        every item with your instructor; this is intentionally not an exhaustive
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
      <Card variant="grouped">
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
        <Section title="Current goals">
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
              <p className="small muted">No goals marked In Progress.</p>
            )}
        </Section>
        <Section title="Recent instructor feedback">
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
        </Section>
      </div>
      <Section title="Discussion notes">
          <div
            className="report-writing-lines"
            aria-label="Blank lines for printed notes"
          />
      </Section>
      <p className="tiny dim">
        Personal summary generated from Your Flight Deck. Confirm all flight time
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
 * Settings and the student's saved medical record disagree about when the medical
 * expires. The student says which matches the student's certificate; only then is the other
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
      // dates stay as they were and the student can choose again.
      if (outcome === "none") setStaleNotice(true);
    } finally {
      guard.release();
    }
  };

  return (
    <Card variant="grouped">
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

const BLANK_CREDENTIAL_DRAFT = {
  type: "pilot_certificate" as CredentialType,
  title: "",
  identifier: "",
  issuedOn: "",
  expiresOn: "",
  notes: "",
  materialId: "",
};

function RecordsTool({
  state,
  save,
  medicalChoice,
  medicalChoosing,
}: ToolProps & { medicalChoice: PendingChoice; medicalChoosing: boolean }) {
  const { data, deleteWithUndo } = useAppData();
  const [draft, setDraft] = useState(BLANK_CREDENTIAL_DRAFT);
  const draftStarted = (Object.keys(BLANK_CREDENTIAL_DRAFT) as (keyof typeof BLANK_CREDENTIAL_DRAFT)[])
    .some((key) => draft[key] !== BLANK_CREDENTIAL_DRAFT[key]);
  const [removing, setRemoving] = useState<CredentialRecord | null>(null);
  const issuedField = useRef<TypedDateFieldHandle>(null);
  const expiresField = useRef<TypedDateFieldHandle>(null);
  const today = todayIso();

  // A double-click must not add the record twice.
  const adding = useRef(false);
  const [addBusy, setAddBusy] = useState(false);
  const add = async () => {
    if (adding.current) return;
    // Both dates are optional, but a typed one that isn't a date is never saved as none.
    const issuedOk = issuedField.current?.check() ?? true;
    const expiresOk = expiresField.current?.check() ?? true;
    if (!draft.title.trim() || !issuedOk || !expiresOk) return;
    adding.current = true;
    setAddBusy(true);
    try {
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
        setDraft(BLANK_CREDENTIAL_DRAFT);
    } finally {
      adding.current = false;
      setAddBusy(false);
    }
  };

  return (
    <div className="stack stack--5">
      <MedicalDateConflictCard state={state} guard={medicalChoice} choosing={medicalChoosing} />
      <Card variant="grouped">
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
                placeholder="e.g. Third-class medical"
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
            <TypedDateField
              ref={issuedField}
              label="Issued"
              value={draft.issuedOn}
              onChange={(issuedOn) => setDraft((current) => ({ ...current, issuedOn }))}
            />
            <TypedDateField
              ref={expiresField}
              label="Expires"
              value={draft.expiresOn}
              onChange={(expiresOn) => setDraft((current) => ({ ...current, expiresOn }))}
            />
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
          <div className="row row--wrap toolkit-mt-4">
            <Button variant="primary" onClick={() => void add()} disabled={addBusy}>
              {addBusy ? "Saving…" : "Add record"}
            </Button>
            {draftStarted ? (
              <Button variant="ghost" onClick={() => setDraft(BLANK_CREDENTIAL_DRAFT)} disabled={addBusy}>
                Clear
              </Button>
            ) : null}
            <Link className="button button--secondary" to="/study">
              Upload a document copy
            </Link>
          </div>
        </CardBody>
      </Card>
      <Card variant="grouped">
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
      <EndorsementChecklist state={state} save={save} />
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

const MINIMUM_FIELDS = [
  ["ceilingFt", "Lowest ceiling (ft AGL)", "numeric"],
  ["visibilitySm", "Lowest visibility (SM)", "decimal"],
  ["windKt", "Max wind (kt)", "numeric"],
  ["crosswindKt", "Max crosswind (kt)", "numeric"],
] as const;

type MinimumKey = (typeof MINIMUM_FIELDS)[number][0];

function toNumber(text: string): number | undefined {
  if (text.trim() === "") return undefined;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function PersonalMinimumsPanel({ state, save }: ToolProps) {
  const saved = state.personalMinimums;
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<MinimumKey | "note", string>>({
    ceilingFt: "",
    visibilitySm: "",
    windKt: "",
    crosswindKt: "",
    note: "",
  });
  const [today, setToday] = useState<Record<MinimumKey, string>>({
    ceilingFt: "",
    visibilitySm: "",
    windKt: "",
    crosswindKt: "",
  });
  const [busy, setBusy] = useState(false);
  const line = minimumsLine(saved);

  const open = () => {
    setForm({
      ceilingFt: saved?.ceilingFt?.toString() ?? "",
      visibilitySm: saved?.visibilitySm?.toString() ?? "",
      windKt: saved?.windKt?.toString() ?? "",
      crosswindKt: saved?.crosswindKt?.toString() ?? "",
      note: saved?.note ?? "",
    });
    setEditing(true);
  };
  const commit = async (next: PersonalMinimums | undefined) => {
    if (busy) return;
    setBusy(true);
    try {
      const ok = await save((current) => {
        const { personalMinimums: _old, ...rest } = current;
        return next ? { ...rest, personalMinimums: next } : rest;
      });
      if (ok) setEditing(false);
    } finally {
      setBusy(false);
    }
  };
  const onSave = () =>
    void commit(
      normalizePersonalMinimums({
        ceilingFt: toNumber(form.ceilingFt),
        visibilitySm: toNumber(form.visibilitySm),
        windKt: toNumber(form.windKt),
        crosswindKt: toNumber(form.crosswindKt),
        note: form.note,
      }),
    );

  const comparison = compareToMinimums(saved, {
    ceilingFt: toNumber(today.ceilingFt),
    visibilitySm: toNumber(today.visibilitySm),
    windKt: toNumber(today.windKt),
    crosswindKt: toNumber(today.crosswindKt),
  });
  const summary = minimumsSummary(comparison);
  const verdictText = (v: MinimumVerdict | undefined) =>
    v === "outside" ? "outside your minimum" : v === "inside" ? "inside" : null;

  return (
    <div className="stack stack--2">
      {line ? <p className="small">{line}</p> : null}
      {saved && !editing ? (
        <div className="stack stack--2">
          <p className="tiny dim">Optional: type today&apos;s conditions to compare.</p>
          <div className="row row--wrap">
            {MINIMUM_FIELDS.filter(([key]) => saved[key] !== undefined).map(([key, label, mode]) => (
              <div key={key}>
                <Field label={label.replace("Lowest ", "Today's ").replace("Max ", "Today's ")}>
                  <TextInput
                    type="number"
                    inputMode={mode}
                    min="0"
                    value={today[key]}
                    onChange={(e) => setToday({ ...today, [key]: e.target.value })}
                  />
                </Field>
                {verdictText(comparison[key]) ? (
                  <span
                    className={comparison[key] === "outside" ? "tiny" : "tiny dim"}
                    data-verdict={comparison[key]}
                  >
                    {verdictText(comparison[key])}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
          {summary ? (
            <p className="small" data-testid="minimums-summary">
              {summary}
            </p>
          ) : null}
        </div>
      ) : null}
      {editing ? (
        <div className="stack stack--2">
          <p className="tiny dim">Set these once with your instructor. All fields are optional.</p>
          {MINIMUM_FIELDS.map(([key, label, mode]) => (
            <Field label={label} key={key}>
              <TextInput
                type="number"
                inputMode={mode}
                min="0"
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              />
            </Field>
          ))}
          <Field label="One more line (optional)">
            <TextInput
              maxLength={140}
              value={form.note}
              placeholder="e.g. no night flights yet"
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </Field>
          <div className="row">
            <Button variant="primary" onClick={onSave} disabled={busy}>
              Save my minimums
            </Button>
            <Button onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button onClick={open}>{saved ? "Edit" : "Set my minimums"}</Button>
        </div>
      )}
    </div>
  );
}

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
  // A double-click must not save the check-in twice.
  const recording = useRef(false);
  const [recordBusy, setRecordBusy] = useState(false);
  const record = async () => {
    if (recording.current) return;
    recording.current = true;
    setRecordBusy(true);
    const check: SafetyCheck = { id: newId(), date: nowIso(), ...draft };
    try {
      if (
        await save((current) => ({
          ...current,
          safetyChecks: [check, ...current.safetyChecks].slice(0, 100),
        }))
      )
        setDraft(emptySafety());
    } finally {
      recording.current = false;
      setRecordBusy(false);
    }
  };
  return (
    <>
    <div className="toolkit-two-column">
      <Card variant="grouped">
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
              <Fragment key={key}>
                <Checkbox
                  checked={draft[key]}
                  onChange={(checked) => setDraft({ ...draft, [key]: checked })}
                  label={label}
                  meta={meta}
                />
                {key === "personalMinimumsMet" ? (
                  <PersonalMinimumsPanel state={state} save={save} />
                ) : null}
              </Fragment>
            ))}
            <Field label="My decision">
              <Select
                options={[
                  { value: "go", label: "No concerns you noted" },
                  { value: "discuss", label: "Talk it over with your instructor" },
                  { value: "no_go", label: "You chose not to fly" },
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
            <Button variant="primary" onClick={() => void record()} disabled={recordBusy}>
              {recordBusy ? "Saving…" : "Save this check-in"}
            </Button>
            <p className="tiny dim">
              This prompt never makes the decision for you. Stop and involve the
              instructor whenever anything is uncertain.
            </p>
          </div>
        </CardBody>
      </Card>
      <Card variant="grouped">
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
                      ? "Chose not to fly"
                      : check.decision === "go"
                        ? "No concerns noted"
                        : "Talk it over"}
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
      <PerformanceAidCard />
    </div>
    <WeightBalancePractice />
    </>
  );
}

function WeightBalancePractice() {
  const [input, setInput] = useState<WbInput>(emptyWbInput);
  const [showAnswer, setShowAnswer] = useState<string | null>(null);
  const [practice, setPractice] = useState<WbPractice | null>(null);
  const result = useMemo(() => calculateWeightBalance(input), [input]);
  const untouched = WB_ROW_KEYS.every((k) => input.rows[k].amount.trim() === "" && input.rows[k].arm.trim() === "");
  const setRow = (key: WbRowKey, field: "amount" | "arm", value: string) =>
    setInput((cur) => ({ ...cur, rows: { ...cur.rows, [key]: { ...cur.rows[key], [field]: value } } }));
  return (
    <Card variant="grouped">
      <CardHeader title="Weight & balance practice" eyebrow="Study aid only" />
      <CardBody>
        <div className="stack stack--3">
          <p>Study aid only. Use your airplane's POH and check with your instructor.</p>
          <p>Fuel is entered in gallons and counted at {AVGAS_LB_PER_GAL} lb per gallon (avgas).</p>
          {practice ? <p><strong>{practice.title}.</strong> {describeWbPractice(practice.input)}</p> : null}
          <div className="form-grid">
            {WB_ROW_KEYS.map((key) => (
              <Fragment key={key}>
                <Field label={`${WB_ROW_LABELS[key]}${key === "fuel" ? "" : " (lb)"}`}>
                  <TextInput
                    value={input.rows[key].amount}
                    onChange={(e) => setRow(key, "amount", e.target.value)}
                  />
                </Field>
                <Field label={`${WB_ROW_LABELS[key].replace(" (gallons)", "")} arm (in)`}>
                  <TextInput
                    value={input.rows[key].arm}
                    onChange={(e) => setRow(key, "arm", e.target.value)}
                  />
                </Field>
              </Fragment>
            ))}
            <Field label="Max gross weight (lb, optional)">
              <TextInput value={input.maxGross} onChange={(e) => setInput({ ...input, maxGross: e.target.value })} />
            </Field>
            <Field label="Forward CG limit (in, optional)">
              <TextInput value={input.forwardLimit} onChange={(e) => setInput({ ...input, forwardLimit: e.target.value })} />
            </Field>
            <Field label="Aft CG limit (in, optional)">
              <TextInput value={input.aftLimit} onChange={(e) => setInput({ ...input, aftLimit: e.target.value })} />
            </Field>
          </div>
          <div aria-live="polite" style={{ overflowX: "auto" }}>
            {untouched ? (
              <p>Enter your numbers, or fill in a practice problem below.</p>
            ) : result.ok ? (
              <>
                <table>
                  <thead>
                    <tr><th scope="col">Item</th><th scope="col">Weight (lb)</th><th scope="col">Arm (in)</th><th scope="col">Moment</th></tr>
                  </thead>
                  <tbody>
                    {result.rows.map((r) => (
                      <tr key={r.key}><th scope="row">{WB_ROW_LABELS[r.key].replace(" (gallons)", "")}</th><td>{r.weight}</td><td>{r.arm}</td><td>{r.moment}</td></tr>
                    ))}
                    <tr><th scope="row">Total</th><td>{result.totalWeight}</td><td>{result.cg}</td><td>{result.totalMoment}</td></tr>
                  </tbody>
                </table>
                <p>Center of gravity: {result.cg} in. {result.verdict}</p>
              </>
            ) : (
              <p>{result.error}</p>
            )}
          </div>
          <h3>Try this</h3>
          <p>Practice numbers, not a real airplane.</p>
          <div className="stack stack--3">
            {WB_PRACTICE.map((p) => (
              <div key={p.id}>
                <strong>{p.title}</strong>
                <div>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setInput(JSON.parse(JSON.stringify(p.input)));
                      setPractice(p);
                      setShowAnswer(null);
                    }}
                  >
                    Fill in {p.title.split(":")[0]}
                  </Button>{" "}
                  {practice?.id === p.id ? (
                    <Button variant="ghost" onClick={() => setShowAnswer(showAnswer === p.id ? null : p.id)}>
                      {showAnswer === p.id ? "Hide answer" : "Show answer"}
                    </Button>
                  ) : null}
                </div>
                {showAnswer === p.id ? <p>{p.answer}</p> : null}
              </div>
            ))}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

export function windSteps(runway: number, dir: number, speed: number): string[] {
  const heading = runway <= 36 ? runway * 10 : runway;
  const angle = (((dir - heading) % 360) + 360) % 360;
  const a = angle > 180 ? 360 - angle : angle;
  const rad = (a * Math.PI) / 180;
  return [
    `Study aid, worked steps. Runway heading ${heading}°, wind from ${dir}° at ${speed} kt, so the angle is ${a}°.`,
    `Crosswind = ${speed} × sin(${a}°) = ${Math.round(Math.abs(speed * Math.sin(rad)))} kt.`,
    `Headwind = ${speed} × cos(${a}°) = ${Math.round(speed * Math.cos(rad))} kt (negative means tailwind).`,
  ];
}

export function densitySteps(elev: number, alt: number, oat: number, d: DensityResult): string[] {
  return [
    `Study aid, worked steps. Pressure altitude = ${elev} + (29.92 − ${alt}) × 1,000 = ${d.pressureAltitude.toLocaleString("en-US")} ft.`,
    `ISA temperature = 15 − 2 × (${d.pressureAltitude.toLocaleString("en-US")} ÷ 1,000) = ${d.isaTemp} °C.`,
    `Density altitude = ${d.pressureAltitude.toLocaleString("en-US")} + 120 × (${oat} − ${d.isaTemp}) = about ${d.densityAltitude.toLocaleString("en-US")} ft (rounded to 10).`,
  ];
}

function PerformanceAidCard() {
  const [runway, setRunway] = useState("");
  const [windDir, setWindDir] = useState("");
  const [windSpeed, setWindSpeed] = useState("");
  const [elevation, setElevation] = useState("");
  const [altimeter, setAltimeter] = useState("29.92");
  const [oat, setOat] = useState("");
  const num = (v: string) => (v.trim() === "" ? NaN : Number(v));
  const runwayNum = num(runway);
  const runwayBad = runway.trim() !== "" && !(Number.isInteger(runwayNum) && runwayNum >= 1 && runwayNum <= 36);
  const wind = runwayBad ? null : windComponents(runwayNum, num(windDir), num(windSpeed));
  const density = densityAltitude(num(elevation), num(altimeter), num(oat));
  const windText = runwayBad
    ? "Runway numbers are whole numbers from 1 to 36. Try again."
    : wind
    ? `${wind.crosswind === 0 ? "Crosswind 0 kt" : `Crosswind ${wind.crosswind} kt from the ${wind.side}`}, ${
        wind.headwind < 0 ? `tailwind ${-wind.headwind} kt` : `headwind ${wind.headwind} kt`
      }.`
    : "Enter a runway (1-36), wind direction and wind speed.";
  const fmt = (n: number) => n.toLocaleString("en-US");
  const densityText = density
    ? `Pressure altitude ${fmt(density.pressureAltitude)} ft, density altitude about ${fmt(density.densityAltitude)} ft.`
    : "Enter field elevation, altimeter setting and temperature.";
  return (
    <Card variant="grouped">
      <CardHeader title="Crosswind & density altitude" />
      <CardBody>
        <div className="stack stack--3">
          <div className="form-grid">
            <Field label="Runway (1-36)">
              <TextInput type="number" inputMode="numeric" min="1" max="36" step="1" value={runway} onChange={(e) => setRunway(e.target.value)} />
            </Field>
            <Field label="Wind direction (degrees)">
              <TextInput type="number" inputMode="numeric" min="0" max="360" value={windDir} onChange={(e) => setWindDir(e.target.value)} />
            </Field>
            <Field label="Wind speed (kt)">
              <TextInput type="number" inputMode="numeric" min="0" value={windSpeed} onChange={(e) => setWindSpeed(e.target.value)} />
            </Field>
          </div>
          <p className="small" role="status">{windText}</p>
          {wind && !runwayBad ? (
            <ul className="small muted" aria-label="Worked steps for crosswind">
              {windSteps(runwayNum, num(windDir), num(windSpeed)).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
          <div className="form-grid">
            <Field label="Field elevation (ft)">
              <TextInput type="number" inputMode="numeric" value={elevation} onChange={(e) => setElevation(e.target.value)} />
            </Field>
            <Field label="Altimeter (inHg)">
              <TextInput type="number" inputMode="decimal" step="0.01" value={altimeter} onChange={(e) => setAltimeter(e.target.value)} />
            </Field>
            <Field label="Outside air temperature (°C)">
              <TextInput type="number" value={oat} onChange={(e) => setOat(e.target.value)} />
            </Field>
          </div>
          <p className="small" role="status">{densityText}</p>
          {density ? (
            <ul className="small muted" aria-label="Worked steps for density altitude">
              {densitySteps(num(elevation), num(altimeter), num(oat), density).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
          <p className="small muted">
            High density altitude means a longer takeoff run and a weaker climb.
          </p>
          <p className="tiny dim">
            Study aid only. Use your POH performance charts and check with your instructor.
          </p>
        </div>
      </CardBody>
    </Card>
  );
}

/** Ask before Exit only once an answer has been given. */
export function quizNeedsLeaveConfirm(answered: number, checkedNow: boolean): boolean {
  return answered > 0 || checkedNow;
}

// Not a valid choice index, so makeQuizAttempt scores it as a miss.
const QUIZ_DONT_KNOW = -1;

function QuizTool({ state, save, onBusyChange }: ToolProps & { onBusyChange?: (busy: boolean) => void }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<QuizAttempt | null>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (result) resultHeading.current?.focus();
  }, [result]);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<number[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const busy = running && !result && quizNeedsLeaveConfirm(answers.length, checked);
  useLeaveGuard(busy, "Leave this quiz?", "Your answers in this quiz are not kept.");
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);
  const [questions, setQuestions] = useState(() => selectQuizQuestions(Date.now()));
  const question = questions[index]!;
  const best = state.quizAttempts.length
    ? Math.max(...state.quizAttempts.map((item) => item.score / item.total))
    : null;

  const start = () => {
    setQuestions(selectQuizQuestions(Date.now()));
    setResult(null);
    setRunning(true);
    setIndex(0);
    setAnswers([]);
    setSelected(null);
    setChecked(false);
  };
  // A double-click on Finish quiz must not save the attempt twice.
  const finishing = useRef(false);
  const [finishBusy, setFinishBusy] = useState(false);
  const next = async () => {
    if (selected === null || finishing.current) return;
    const nextAnswers = [...answers, selected];
    if (index === questions.length - 1) {
      finishing.current = true;
      setFinishBusy(true);
      const attempt = makeQuizAttempt(nextAnswers, nowIso(), newId(), questions);
      try {
        await save((current) => ({
          ...current,
          quizAttempts: [attempt, ...current.quizAttempts].slice(0, 50),
        }));
      } finally {
        finishing.current = false;
        setFinishBusy(false);
      }
      setResult(attempt);
      setRunning(false);
      return;
    }
    setAnswers(nextAnswers);
    setIndex(index + 1);
    setSelected(null);
    setChecked(false);
  };

  if (!running && result)
    return (
      <Card>
        <CardHeader title="Quiz finished" eyebrow="Knowledge quiz" />
        <CardBody>
          <h3 ref={resultHeading} tabIndex={-1} className="display">
            {result.score} of {result.total} right.
          </h3>
          {result.weakTopics.length ? (
            <p className="small muted">
              Review:{" "}
              {result.weakTopics.map((topic) => TOPIC_LABELS[topic]).join(", ")}
            </p>
          ) : null}
          <Button
            variant="primary"
            className="toolkit-mt-5"
            onClick={() => setResult(null)}
          >
            Try another quiz
          </Button>
        </CardBody>
      </Card>
    );

  if (!running)
    return (
      <div className="toolkit-two-column">
        <Card>
          <CardHeader title="Knowledge quiz" eyebrow="Eight-question review" />
          <CardBody>
            <p className="small muted">
              Practice broad private-pilot knowledge topics and see which areas
              deserve another study session.
            </p>
            <div className="toolkit-hero-metrics toolkit-mt-5">
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
              className="toolkit-mt-5"
              onClick={start}
            >
              Start quiz
            </Button>
            <p className="small muted">
              Practice questions in the style of the FAA knowledge test. A study aid; check against FAA guidance and your instructor.
            </p>
          </CardBody>
        </Card>
        <Card variant="grouped">
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
              <p className="small muted">
                No knowledge quiz attempts yet. Practice tests on your study
                materials are kept in the Study Library.
              </p>
            )}
          </CardBody>
        </Card>
      </div>
    );

  return (
    <Card variant="grouped">
      <CardHeader
        title={`Question ${index + 1} of ${questions.length}`}
        eyebrow={TOPIC_LABELS[question.topic]}
      />
      <CardBody>
        <div className="quiz">
          <p className="display quiz__prompt">{question.prompt}</p>
          <div role="radiogroup" aria-label="Answer choices" className="stack stack--2">
            {[...question.choices, "I don't know"].map((choice, position) => {
              const choiceIndex = position < question.choices.length ? position : QUIZ_DONT_KNOW;
              return (
                <label
                  key={choice}
                  className={`quiz__choice${selected === choiceIndex ? " is-selected" : ""}${checked && choiceIndex === question.correct ? " is-correct" : ""}${checked && selected === choiceIndex && choiceIndex !== question.correct ? " is-wrong" : ""}`}
                >
                  <input
                    type="radio"
                    name={`quiz-question-${index}`}
                    className="quiz__radio"
                    disabled={checked}
                    checked={selected === choiceIndex}
                    onChange={() => setSelected(choiceIndex)}
                  />
                  {choice}
                </label>
              );
            })}
          </div>
          {checked ? (
            <p className="quiz__explanation small">
              {selected === question.correct
                ? "Correct. "
                : selected === QUIZ_DONT_KNOW
                  ? `No problem, here is the answer: ${question.choices[question.correct]}. `
                  : `Not quite. The correct answer is: ${question.choices[question.correct]}. `}
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
              <Button variant="primary" onClick={() => void next()} disabled={finishBusy}>
                {finishBusy
                  ? "Saving…"
                  : index === questions.length - 1
                  ? "Finish quiz"
                  : "Next question"}
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={() => (quizNeedsLeaveConfirm(answers.length, checked) ? setLeaving(true) : setRunning(false))}
            >
              Exit
            </Button>
          </div>
          <ConfirmDialog
            open={leaving}
            title="Leave this quiz?"
            message="Your answers in this quiz are not kept."
            confirmLabel="Leave"
            cancelLabel="Keep going"
            destructive={true}
            onConfirm={() => {
              setLeaving(false);
              setRunning(false);
            }}
            onCancel={() => setLeaving(false)}
          />
        </div>
      </CardBody>
    </Card>
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
      <Card>
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
        <Card variant="grouped">
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
        <Card variant="grouped">
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
