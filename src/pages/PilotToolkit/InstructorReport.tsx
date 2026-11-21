import { Button, Card, CardBody, CardHeader, Section } from "@/components/ui";
import { formatLongDate, formatShortDate, todayIso } from "@/lib/dates";
import { flightActivity, flightLogTotals, formatHours } from "@/logic/flightLog";
import { readinessSummary } from "@/logic/toolkit";
import { useAppData } from "@/state/AppDataContext";
import { ReportMetric } from "./toolkitShared";

export function InstructorReport() {
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
