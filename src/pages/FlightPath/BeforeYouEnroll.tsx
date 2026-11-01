import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Link } from "react-router-dom";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Card, CardBody, CardHeader, Checkbox } from "@/components/ui";
import { isTauri } from "@/data";
import type { Profile } from "@/domain/types";
import { useAppData } from "@/state/AppDataContext";
import { useRememberedState } from "@/state/useRememberedState";

const steps = [
  { id: "discovery", label: "Book a discovery flight (an intro lesson with an instructor)." },
  { id: "medical", label: "Get an FAA medical certificate from an Aviation Medical Examiner (third class is enough for private pilot).", url: "https://www.faa.gov/faq/when-required-what-class-medical-certificate-must-student-pilot-have" },
  { id: "student", label: "Apply for a student pilot certificate through IACRA with a school or instructor.", url: "https://www.faa.gov/pilots/become/student_cert" },
  { id: "study", label: "Start ground study.", to: "/study", link: "Study Library" },
  { id: "test", label: "Ask your instructor for a knowledge test endorsement, then book the test at a testing center.", url: "https://www.faa.gov/training_testing/testing" },
  { id: "solo", label: "Your instructor gives you endorsements for solo flights when you are ready.", url: "https://www.faa.gov/training_testing/training" },
  { id: "budget", label: "Set a budget.", to: "/finances", link: "Finances" },
  { id: "checkride", label: "Plan your practical test (the checkride) with your instructor.", url: "https://www.faa.gov/training_testing/testing/acs" },
] as const;

type Progress = { hidden: boolean; done: string[] };
function isProgress(value: unknown): value is Progress {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Progress>;
  return typeof candidate.hidden === "boolean" && Array.isArray(candidate.done)
    && candidate.done.every((id) => steps.some((step) => step.id === id));
}

const sources = [
  { label: "FAA", url: "https://www.faa.gov/pilots/become/faq" },
  { label: "Medical", url: "https://www.faa.gov/faq/when-required-what-class-medical-certificate-must-student-pilot-have" },
  { label: "Student certificate", url: "https://www.faa.gov/pilots/become/student_cert" },
];

export function BeforeYouEnroll({ profile }: { profile: Pick<Profile, "flightSchool" | "trainingStartedOn"> }) {
  const [progress, remember] = useRememberedState<Progress>(
    "before-you-enroll", { hidden: false, done: [] }, isProgress, "device",
  );
  const [linkError, setLinkError] = useState(false);
  const { repositories } = useAppData();
  const store = repositories?.studentPilotSteps;
  // Ticks live in her saved data. Until they load (or if saving is unavailable) they stay on screen only.
  const [done, setDone] = useState<string[]>([]);
  const [saveError, setSaveError] = useState(false);
  const older = useRef(progress);
  useEffect(() => {
    if (!store) return;
    let active = true;
    void (async () => {
      // One time: ticks an older version kept on this computer move into her data.
      const legacy = older.current.done;
      if (legacy.length) {
        await store.importDone(legacy);
        remember({ hidden: older.current.hidden, done: [] });
        older.current = { ...older.current, done: [] };
      }
      const saved = await store.listDone();
      if (active) { setDone((now) => [...new Set([...saved, ...now])]); }
    })().catch(() => { if (active) setSaveError(true); });
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  function tick(id: string, checked: boolean) {
    setDone((now) => checked ? [...now.filter((x) => x !== id), id] : now.filter((x) => x !== id));
    setSaveError(false);
    if (store) void store.setDone(id, checked).catch(() => setSaveError(true));
  }

  if (profile.flightSchool.trim() || profile.trainingStartedOn) return null;
  // Hide is not a dead end: until she has a school, one quiet link brings the card back.
  if (progress.hidden) {
    return (
      <p className="enroll-show">
        <button type="button" className="enroll-hide small" onClick={() => remember({ hidden: false, done: [] })}>
          Show first steps
        </button>
      </p>
    );
  }

  function openSource(event: MouseEvent<HTMLAnchorElement>, url: string) {
    if (!isTauri()) return;
    event.preventDefault();
    setLinkError(false);
    void openUrl(url).catch(() => setLinkError(true));
  }

  return (
    <Card variant="quiet" className="enroll-card">
      <CardHeader title="Before you enroll" action={
        <button type="button" className="enroll-hide small" onClick={() => remember({ hidden: true, done: [] })}>Hide</button>
      } />
      <CardBody>
        <ul className="enroll-checklist stack stack--3">
          {steps.map((step) => (
            <li key={step.id} className="row row--wrap">
              <Checkbox label={step.label} checked={done.includes(step.id)} strikethrough={false}
                onChange={(checked) => tick(step.id, checked)} />
              {"to" in step ? <Link className="small" to={step.to}>{step.link}</Link> : null}
              {"url" in step ? <a className="small" href={step.url} target="_blank" rel="noopener noreferrer"
                aria-label={`FAA page: ${step.label}`} onClick={(event) => openSource(event, step.url)}>FAA</a> : null}
            </li>
          ))}
        </ul>
        <p className="tiny muted enroll-footnote">
          Check the details with the <a href={sources[0]!.url} target="_blank" rel="noopener noreferrer" onClick={(event) => openSource(event, sources[0]!.url)}>FAA</a> and your instructor.{" "}
          {sources.slice(1).map((source, index) => <span key={source.url}>
            {index > 0 ? " · " : ""}<a href={source.url} target="_blank" rel="noopener noreferrer" onClick={(event) => openSource(event, source.url)}>{source.label}</a>
          </span>)}
        </p>
        <p className="tiny muted">FAA pages last checked: 31 October 2026.</p>
        {saveError ? <p role="alert" className="small muted">Your ticks could not be saved just now. Please try again.</p> : null}
        {linkError ? <p role="alert" className="small muted">Could not open the FAA page. Please try again.</p> : null}
      </CardBody>
    </Card>
  );
}
