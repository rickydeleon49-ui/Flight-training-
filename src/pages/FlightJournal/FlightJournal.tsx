import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { PageHeader } from "@/components/layout/PageHeader";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  JournalIcon,
  PlusIcon,
  Select,
} from "@/components/ui";
import { formatLongDate, todayIso } from "@/lib/dates";
import { collectFeedback, goalsWithFeedback } from "@/logic/feedback";
import { flightLogTotals, flightRoute, formatHours, hasFlightLogData } from "@/logic/flightLog";
import { lessonsAwaitingDebrief } from "@/logic/preparation";
import { useAppData } from "@/state/AppDataContext";

import "./journal.css";

type View = "log" | "debriefs" | "feedback";

export function FlightJournal() {
  const { data } = useAppData();
  const today = todayIso();
  const [view, setView] = useState<View>("log");
  const [goalFilter, setGoalFilter] = useState("");

  const journalEventIds = new Set(
    data.journalEntries.map((entry) => entry.eventId).filter((id): id is string => id !== null),
  );
  const awaiting = lessonsAwaitingDebrief(data.events, journalEventIds, today);

  const feedback = useMemo(
    () => collectFeedback(data.journalEntries, data.events, data.goals),
    [data.journalEntries, data.events, data.goals],
  );
  const feedbackGoals = useMemo(() => goalsWithFeedback(feedback), [feedback]);
  const visibleFeedback = goalFilter
    ? feedback.filter((note) => note.goalId === goalFilter)
    : feedback;
  const loggedFlights = useMemo(
    () => data.journalEntries.filter(hasFlightLogData),
    [data.journalEntries],
  );
  const totals = useMemo(() => flightLogTotals(data.journalEntries), [data.journalEntries]);

  return (
    <>
      <PageHeader
        title="Flight Log & Journal"
        subtitle="Flight time, lesson notes, and instructor feedback in one training history."
        action={
          <Link className="button button--primary" to="/journal/new">
            <PlusIcon size={16} /> Log a flight
          </Link>
        }
      />

      <div className="view-tabs filter-chips">
        <button
          type="button"
          className={`filter-chip${view === "log" ? " is-active" : ""}`}
          aria-pressed={view === "log"}
          onClick={() => setView("log")}
        >
          Flight log{loggedFlights.length > 0 ? ` (${loggedFlights.length})` : ""}
        </button>
        <button
          type="button"
          className={`filter-chip${view === "debriefs" ? " is-active" : ""}`}
          aria-pressed={view === "debriefs"}
          onClick={() => setView("debriefs")}
        >
          Debriefs
        </button>
        <button
          type="button"
          className={`filter-chip${view === "feedback" ? " is-active" : ""}`}
          aria-pressed={view === "feedback"}
          onClick={() => setView("feedback")}
        >
          Instructor feedback{feedback.length > 0 ? ` (${feedback.length})` : ""}
        </button>
      </div>

      {view === "feedback" ? (
        <Card>
          <CardHeader
            title="What your instructors have said"
            action={
              feedbackGoals.length > 1 ? (
                <Select
                  aria-label="Filter feedback by goal"
                  placeholder="Every goal"
                  options={feedbackGoals.map((goal) => ({ value: goal.id, label: goal.title }))}
                  value={goalFilter}
                  onChange={(value) => setGoalFilter(value)}
                  style={{ width: "auto" }}
                />
              ) : null
            }
          />
          <CardBody flush>
            {visibleFeedback.length === 0 ? (
              <EmptyState
                icon={<JournalIcon size={26} />}
                title={
                  feedback.length === 0
                    ? "No feedback recorded yet."
                    : "No feedback for that goal yet."
                }
                body={
                  feedback.length === 0
                    ? "When you write a debrief, put your instructor's words in as close to how they said them as you can. They collect here so you can look back across lessons."
                    : undefined
                }
              />
            ) : (
              visibleFeedback.map((note) => (
                <Link className="feedback-note" key={note.entryId} to={`/journal/${note.entryId}`}>
                  <span className="feedback-note__quote wrap-anywhere">“{note.text}”</span>
                  <span className="feedback-note__meta">
                    <span>{formatLongDate(note.date, today)}</span>
                    <span>·</span>
                    <span className="truncate">{note.title}</span>
                    {note.goalTitle ? <Badge tone="study">{note.goalTitle}</Badge> : null}
                    {note.confidence != null ? (
                      <span>Confidence {note.confidence}/5</span>
                    ) : null}
                  </span>
                </Link>
              ))
            )}
          </CardBody>
        </Card>
      ) : view === "log" ? (
        <div className="stack stack--5">
          <div className="flight-log-summary">
            {(
              [
                ["Total time", formatHours(totals.totalTime)],
                ["Training received", formatHours(totals.dualReceived)],
                ["PIC", formatHours(totals.picTime)],
                ["Cross-country", formatHours(totals.crossCountryTime)],
                ["Night", formatHours(totals.nightTime)],
                ["Instrument", formatHours(totals.instrumentTime)],
              ] as const
            ).map(([label, value]) => (
              <Card variant="quiet" key={label}>
                <CardBody>
                  <p className="tiny dim">{label}</p>
                  <p className="flight-log-summary__value numeric">{value}</p>
                  <p className="tiny dim">hours</p>
                </CardBody>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader
              title="Training flights"
              action={<span className="tiny dim">{totals.flights} logged</span>}
            />
            <CardBody flush>
              {loggedFlights.length === 0 ? (
                <EmptyState
                  icon={<JournalIcon size={28} />}
                  title="Your flight log is ready."
                  body="After an instructor flight, enter the aircraft, route, and the flight-time categories agreed with your instructor."
                  action={
                    <Link className="button button--primary" to="/journal/new">
                      Log your first flight
                    </Link>
                  }
                />
              ) : (
                <div className="flight-log-table-wrap">
                  <table className="flight-log-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Route</th>
                        <th>Aircraft</th>
                        <th>Total</th>
                        <th>Dual</th>
                        <th>PIC</th>
                        <th>Solo</th>
                        <th>Night</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loggedFlights.map((entry) => (
                        <tr key={entry.id}>
                          <td>
                            <Link to={`/journal/${entry.id}`}>{entry.date}</Link>
                          </td>
                          <td>{flightRoute(entry)}</td>
                          <td>
                            {[entry.aircraftType, entry.aircraftId].filter(Boolean).join(" · ") || "—"}
                          </td>
                          <td className="numeric">{entry.totalTime?.toFixed(1) ?? "—"}</td>
                          <td className="numeric">{entry.dualReceived?.toFixed(1) ?? "—"}</td>
                          <td className="numeric">{entry.picTime?.toFixed(1) ?? "—"}</td>
                          <td className="numeric">{entry.soloTime?.toFixed(1) ?? "—"}</td>
                          <td className="numeric">{entry.nightTime?.toFixed(1) ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="flight-log-disclaimer tiny dim">
                This is a personal training companion. Keep the instructor-endorsed logbook
                and required records as the authoritative source.
              </p>
            </CardBody>
          </Card>
        </div>
      ) : (
        <div className="stack stack--5">
          {awaiting.length > 0 ? (
            <Card>
              <CardHeader title="Lessons without a debrief" />
              <CardBody>
                <div className="stack stack--3">
                  <p className="small muted">
                    Writing this down while it is fresh is what makes it useful later.
                  </p>
                  {awaiting.slice(0, 5).map((event) => (
                    <div className="row row--between" key={event.id}>
                      <span className="small truncate">
                        {event.title} · {formatLongDate(event.date, today)}
                      </span>
                      <Link
                        className="button button--secondary button--small"
                        to={`/journal/new?event=${event.id}`}
                      >
                        Write it
                      </Link>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader
              title="Your training history"
              action={<span className="tiny dim">{data.journalEntries.length} entries</span>}
            />
            <CardBody flush>
              {data.journalEntries.length === 0 ? (
                <EmptyState
                  icon={<JournalIcon size={28} />}
                  title="Your journal is ready."
                  body="After your next lesson, write down what you practised, what your instructor said, and the one thing to work on. Over time this becomes the clearest record of how far you have come."
                  action={
                    <Link className="button button--primary" to="/journal/new">
                      Log your first flight
                    </Link>
                  }
                />
              ) : (
                data.journalEntries.map((entry) => {
                  const event = data.events.find((candidate) => candidate.id === entry.eventId);
                  return (
                    <Link className="journal-entry" key={entry.id} to={`/journal/${entry.id}`}>
                      <span className="journal-entry__head">
                        <span className="journal-entry__date">
                          {formatLongDate(entry.date, today)}
                        </span>
                        <span className="strong wrap-anywhere">
                          {entry.title || event?.title || "Lesson debrief"}
                        </span>
                        {entry.confidence != null ? (
                          <Badge tone="study">Confidence {entry.confidence}/5</Badge>
                        ) : null}
                      </span>
                      {entry.mission ? (
                        <span className="journal-entry__mission wrap-anywhere">{entry.mission}</span>
                      ) : null}
                      {entry.instructorFeedback ? (
                        <span className="journal-entry__feedback wrap-anywhere">
                          “{entry.instructorFeedback}”
                        </span>
                      ) : null}
                    </Link>
                  );
                })
              )}
            </CardBody>
          </Card>
        </div>
      )}
    </>
  );
}
