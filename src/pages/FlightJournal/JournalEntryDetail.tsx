import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { ActionRow } from "@/components/actions/ActionRow";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  EmptyState,
} from "@/components/ui";
import { formatLongDate, todayIso } from "@/lib/dates";
import { actionsFor } from "@/logic/actions";
import { flightRoute, hasFlightLogData } from "@/logic/flightLog";
import { useAppData } from "@/state/AppDataContext";
import { useActionOperations } from "@/state/useActions";

import "./journal.css";

export function JournalEntryDetail() {
  const { entryId } = useParams();
  const navigate = useNavigate();
  const { data, deleteWithUndo } = useAppData();
  const operations = useActionOperations();
  const today = todayIso();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const entry = data.journalEntries.find((candidate) => candidate.id === entryId) ?? null;

  if (!entry) {
    return (
      <>
        <PageHeader title="Entry not found" />
        <Card>
          <EmptyState
            title="That entry is no longer here."
            action={
              <Link className="button button--secondary" to="/journal">
                Back to Flight Journal
              </Link>
            }
          />
        </Card>
      </>
    );
  }

  const event = data.events.find((candidate) => candidate.id === entry.eventId);
  const goal = data.goals.find((candidate) => candidate.id === entry.goalId);
  const actions = actionsFor(data.actions, "journal", entry.id);
  const questions = data.questions.filter((question) => question.journalId === entry.id);
  const aircraft = [entry.aircraftType, entry.aircraftId].filter(Boolean).join(" · ");
  const hours = (value: number | null) => (value == null ? "" : `${value.toFixed(1)} hr`);
  const flightDetails: Array<[string, string]> = [
    ["Aircraft", aircraft],
    ["Route", flightRoute(entry) === "—" ? "" : flightRoute(entry)],
    ["Instructor", entry.instructorName],
    ["Total time", hours(entry.totalTime)],
    ["Training received", hours(entry.dualReceived)],
    ["Solo", hours(entry.soloTime)],
    ["PIC", hours(entry.picTime)],
    ["Cross-country", hours(entry.crossCountryTime)],
    ["Night", hours(entry.nightTime)],
    ["Actual instrument", hours(entry.actualInstrumentTime)],
    ["Simulated instrument", hours(entry.simulatedInstrumentTime)],
    ["Day landings", entry.dayLandings?.toString() ?? ""],
    ["Night landings", entry.nightLandings?.toString() ?? ""],
  ];

  const sections: Array<[string, string]> = [
    ["Today's mission", entry.mission],
    ["What you practised", entry.practiced],
    ["What went well", entry.wentWell],
    ["What was difficult", entry.wasDifficult],
    ["Instructor feedback", entry.instructorFeedback],
    ["Questions for next time", entry.questionsForNextTime],
  ];

  return (
    <>
      <PageHeader
        title={entry.title || event?.title || "Lesson debrief"}
        subtitle={formatLongDate(entry.date, today)}
        action={
          <div className="row">
            <Link className="button button--ghost" to="/journal">
              Back
            </Link>
            <Link className="button button--secondary" to={`/journal/${entry.id}/edit`}>
              Edit
            </Link>
            <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
              Delete
            </Button>
          </div>
        }
      />

      <div className="detail">
        <div className="detail__column">
          <Card>
            <CardBody>
              {sections.every(([, body]) => !body.trim()) ? (
                <p className="small muted">This entry has no notes yet.</p>
              ) : (
                sections
                  .filter(([, body]) => body.trim())
                  .map(([label, body]) => (
                    <section className="debrief-section" key={label}>
                      <h2 className="debrief-section__label">{label}</h2>
                      <p className="debrief-section__body wrap-anywhere">{body}</p>
                    </section>
                  ))
              )}
            </CardBody>
          </Card>

          {actions.length > 0 ? (
            <Card>
              <CardHeader title="What came out of this" />
              <CardBody flush>
                <div style={{ paddingBottom: "var(--space-3)" }}>
                  {actions.map((action) => (
                    <ActionRow
                      key={action.id}
                      action={action}
                      today={today}
                      onToggle={operations.toggle}
                      onDelete={operations.remove}
                    />
                  ))}
                </div>
              </CardBody>
            </Card>
          ) : null}
        </div>

        <div className="detail__column">
          {hasFlightLogData(entry) ? (
            <Card>
              <CardHeader title="Flight log" />
              <CardBody>
                <dl className="definition">
                  {flightDetails
                    .filter(([, value]) => value)
                    .map(([label, value]) => (
                      <div key={label} style={{ display: "contents" }}>
                        <dt>{label}</dt>
                        <dd className="wrap-anywhere">{value}</dd>
                      </div>
                    ))}
                </dl>
                <p className="tiny dim" style={{ marginTop: "var(--space-4)" }}>
                  Personal copy only. The instructor-endorsed logbook remains authoritative.
                </p>
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <dl className="definition">
                <dt>Date</dt>
                <dd>{formatLongDate(entry.date, today)}</dd>
                {entry.confidence != null ? (
                  <>
                    <dt>Confidence</dt>
                    <dd>
                      <Badge tone="study">{entry.confidence} of 5</Badge>
                    </dd>
                  </>
                ) : null}
                {event ? (
                  <>
                    <dt>Lesson</dt>
                    <dd>
                      <Link to={`/schedule/${event.id}`}>{event.title}</Link>
                    </dd>
                  </>
                ) : null}
                {goal ? (
                  <>
                    <dt>Goal</dt>
                    <dd>
                      <Link to="/flight-path">{goal.title}</Link>
                    </dd>
                  </>
                ) : null}
              </dl>
              {entry.confidence != null ? (
                <p className="tiny dim" style={{ marginTop: "var(--space-4)" }}>
                  Confidence is your own reflection, not an official proficiency rating.
                </p>
              ) : null}
            </CardBody>
          </Card>

          {questions.length > 0 ? (
            <Card>
              <CardHeader title="Questions saved" />
              <CardBody>
                <div className="stack stack--2">
                  {questions.map((question) => (
                    <div className="row row--between" key={question.id}>
                      <span className="small wrap-anywhere">{question.text}</span>
                      <Link className="tiny" to="/questions">
                        Open
                      </Link>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={confirmingDelete}
        title="Delete this entry?"
        message="The debrief is removed. Actions and questions it created are kept."
        onConfirm={() => {
          setConfirmingDelete(false);
          deleteWithUndo({
            ids: [entry.id],
            label: entry.title || formatLongDate(entry.date, today),
            run: (repos) => repos.journal.remove(entry.id),
          });
          navigate("/journal");
        }}
        onCancel={() => setConfirmingDelete(false)}
      />
    </>
  );
}
