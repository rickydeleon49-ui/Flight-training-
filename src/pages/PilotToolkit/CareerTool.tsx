import { useState } from "react";
import { Button, Card, CardBody, CardHeader, Field, TextArea, TextInput } from "@/components/ui";
import { flightLogTotals, formatHours } from "@/logic/flightLog";
import { useAppData } from "@/state/AppDataContext";
import { type ToolProps, ReportMetric } from "./toolkitShared";

export function CareerTool({ state, save }: ToolProps) {
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
