import { type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { BookIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon, ClockIcon, DocumentIcon, JournalIcon, NoteIcon, PlaneIcon, QuestionIcon, TargetIcon } from "@/components/ui/Icons";
import { PageHeader } from "@/components/layout/PageHeader";
import { ConfirmDialog } from "@/components/ui";
import { type ToolkitState } from "@/domain/types";
import { useAppData } from "@/state/AppDataContext";
import { TOOLKIT_UNREADABLE_MESSAGE } from "@/data/repositories/toolkitRepository";
import { ChartSymbolDrill } from "./ChartSymbolDrill";
import { AccidentCaseDrill } from "./AccidentCaseDrill";
import { InoperativeEquipmentCard } from "./InoperativeEquipmentCard";
import { FigureDrill } from "./FigureDrill";
import { SectionalDrill } from "./SectionalDrill";
import { RegCardDrill } from "./RegCardDrill";
import { E6bTrainer } from "./E6bTrainer";
import { RadioWords } from "./RadioWords";
import { MetarTool } from "./MetarTool";
import { ReadinessTool } from "./ReadinessTool";
import { InstructorReport } from "./InstructorReport";
import { RecordsTool } from "./RecordsTool";
import { SafetyTool } from "./SafetyTool";
import { QuizTool } from "./QuizTool";
import { CareerTool } from "./CareerTool";
import { type PendingChoice } from "./toolkitShared";
import "./pilotToolkit.css";

export { windSteps, densitySteps } from "./PerformanceAidCard";
export { quizNeedsLeaveConfirm } from "./QuizTool";


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
