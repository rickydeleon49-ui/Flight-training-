import { useState, type MouseEvent } from "react";
import { Link } from "react-router-dom";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Card, CardBody, CardHeader, Checkbox } from "@/components/ui";
import { isTauri } from "@/data";
import type { Profile } from "@/domain/types";
import { useRememberedState } from "@/state/useRememberedState";

const steps = [
  { id: "discovery", label: "Book a discovery flight (an intro lesson with an instructor)." },
  { id: "medical", label: "Get an FAA medical certificate from an Aviation Medical Examiner (third class is enough for private pilot)." },
  { id: "student", label: "Apply for a student pilot certificate through IACRA with a school or instructor." },
  { id: "budget", label: "Set a budget.", to: "/finances", link: "Finances" },
  { id: "study", label: "Start ground study.", to: "/study", link: "Study Library" },
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

  if (profile.flightSchool.trim() || profile.trainingStartedOn || progress.hidden) return null;

  function openSource(event: MouseEvent<HTMLAnchorElement>, url: string) {
    if (!isTauri()) return;
    event.preventDefault();
    setLinkError(false);
    void openUrl(url).catch(() => setLinkError(true));
  }

  return (
    <Card variant="quiet">
      <CardHeader title="Before you enroll" action={
        <button type="button" className="enroll-hide small" onClick={() => remember({ ...progress, hidden: true })}>Hide</button>
      } />
      <CardBody>
        <ul className="enroll-checklist stack stack--3">
          {steps.map((step) => (
            <li key={step.id} className="row row--wrap">
              <Checkbox label={step.label} checked={progress.done.includes(step.id)} strikethrough={false}
                onChange={(checked) => remember({ ...progress, done: checked
                  ? [...progress.done, step.id] : progress.done.filter((id) => id !== step.id) })} />
              {"to" in step ? <Link className="small" to={step.to}>{step.link}</Link> : null}
            </li>
          ))}
        </ul>
        <p className="tiny muted enroll-footnote">
          Check the details with the <a href={sources[0]!.url} target="_blank" rel="noopener noreferrer" onClick={(event) => openSource(event, sources[0]!.url)}>FAA</a> and your instructor.{" "}
          {sources.slice(1).map((source, index) => <span key={source.url}>
            {index > 0 ? " · " : ""}<a href={source.url} target="_blank" rel="noopener noreferrer" onClick={(event) => openSource(event, source.url)}>{source.label}</a>
          </span>)}
        </p>
        {linkError ? <p role="alert" className="small muted">Could not open the FAA page. Please try again.</p> : null}
      </CardBody>
    </Card>
  );
}
