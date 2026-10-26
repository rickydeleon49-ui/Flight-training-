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
import {
  flightActivity,
  flightLogTotals,
  flightRoute,
  flightTimeChecks,
  formatHours,
  hasFlightLogData,
  privatePilotPart61Reference,
} from "@/logic/flightLog";
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
  const notesWithoutFlightCount = data.journalEntries.length - loggedFlights.length;
  const totals = useMemo(() => flightLogTotals(data.journalEntries), [data.journalEntries]);
  const activity = useMemo(
    () => flightActivity(data.journalEntries, today),
    [data.journalEntries, today],
  );
  const privatePilotReference = useMemo(() => privatePilotPart61Reference(totals), [totals]);
  const timeChecks = useMemo(() => flightTimeChecks(data.journalEntries), [data.journalEntries]);

  return (
    <>
      <PageHeader
        title="Flight Log & Journal"
        subtitle="Flight time, lesson notes, and instructor feedback in one training history."
        action={
          <div className="row header-actions">
            <Link className="button button--secondary" to="/journal/new?mode=quick">
              Quick debrief
            </Link>
            <Link className="button button--secondary" to="/journal/new?mode=discovery">
              Log discovery flight
            </Link>
            <Link className="button button--primary" to="/journal/new">
              <PlusIcon size={16} /> Log a flight
            </Link>
          </div>
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
          Debriefs{data.journalEntries.length > 0 ? ` (${data.journalEntries.length})` : ""}
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

          {timeChecks.length > 0 ? (
            <Card>
              <CardHeader
                title={
                  timeChecks.length === 1
                    ? "One flight's times don't add up"
                    : `${timeChecks.length} flights' times don't add up`
                }
              />
              <CardBody>
                <div className="stack stack--3" role="note" aria-label="Flights to check">
                  <p className="small">
                    Part of {timeChecks.length === 1 ? "this flight" : "each of these flights"} is
                    logged as longer than its total time. Nothing has been changed: the times stay
                    as you entered them and still count in the totals above, so check them against
                    your logbook and correct them when you can.
                  </p>
                  {timeChecks.map(({ entry, problem }) => (
                    <div className="time-check" key={entry.id}>
                      <div style={{ minWidth: 0 }}>
                        <Link className="small strong" to={`/journal/${entry.id}`}>
                          {formatLongDate(entry.date, today)}
                          {entry.title ? ` · ${entry.title}` : ""}
                        </Link>
                        <p className="tiny muted">{problem}</p>
                      </div>
                      <Link className="button button--ghost button--small" to={`/journal/${entry.id}/edit`}>
                        Correct times
                      </Link>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          ) : null}

          {loggedFlights.length > 0 ? (
            <div className="flight-progress-grid">
              <Card>
                <CardHeader title="Training rhythm" eyebrow="Last 30 days" />
                <CardBody>
                  <div className="flight-rhythm">
                    <div>
                      <p className="tiny dim">Recent time</p>
                      <p className="flight-rhythm__value numeric">
                        {formatHours(activity.hoursLast30Days)} <span>hr</span>
                      </p>
                    </div>
                    <div>
                      <p className="tiny dim">Recent flights</p>
                      <p className="flight-rhythm__value numeric">{activity.flightsLast30Days}</p>
                    </div>
                    <div>
                      <p className="tiny dim">Average flight</p>
                      <p className="flight-rhythm__value numeric">
                        {formatHours(activity.averageFlightTime)} <span>hr</span>
                      </p>
                    </div>
                  </div>
                  <p className="small muted" style={{ marginTop: "var(--space-4)" }}>
                    {activity.lastFlightDate
                      ? `Last logged flight: ${formatLongDate(activity.lastFlightDate, today)}`
                      : "No completed flight has been logged yet."}
                  </p>
                </CardBody>
              </Card>

              <Card>
                <CardHeader
                  title="Private pilot hour reference"
                  eyebrow="Part 61 planning view"
                />
                <CardBody>
                  <div className="hour-reference-list">
                    {privatePilotReference.map((item) => (
                      <div className="hour-reference" key={item.key}>
                        <div className="row row--between">
                          <span className="small">{item.label}</span>
                          <span className="tiny dim numeric">
                            {formatHours(item.logged)} / {item.reference} hr
                          </span>
                        </div>
                        <div
                          className="hour-reference__track"
                          role="progressbar"
                          aria-label={`${item.label}: ${formatHours(item.logged)} logged, compared with ${item.reference} hours`}
                          aria-valuemin={0}
                          aria-valuemax={item.reference}
                          aria-valuenow={Math.min(item.logged, item.reference)}
                        >
                          <span style={{ width: `${item.percent}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="flight-reference-note tiny dim">
                    Planning comparison only. Logged categories can overlap, and the rules
                    include specific training, cross-country, night, instrument, takeoff,
                    landing, endorsement, and proficiency requirements. Confirm qualifying
                    time with her instructor and authoritative logbook.
                    {timeChecks.length > 0
                      ? " These totals include the flights above whose times don't add up yet."
                      : ""}
                  </p>
                </CardBody>
              </Card>
            </div>
          ) : null}

          <Card>
            <CardHeader
              title="Training flights"
              action={<span className="tiny dim">{totals.flights} logged</span>}
            />
            <CardBody flush>
              {notesWithoutFlightCount > 0 ? (
                <div className="journal-notes-callout">
                  <span className="small muted">
                    {notesWithoutFlightCount} {notesWithoutFlightCount === 1 ? "entry has notes without flight details" : "entries have notes without flight details"} in your debriefs history.
                  </span>
                  <button
                    type="button"
                    className="button button--ghost button--small"
                    onClick={() => setView("debriefs")}
                  >
                    View in Debriefs
                  </button>
                </div>
              ) : null}
              {loggedFlights.length === 0 ? (
                <EmptyState
                  icon={<JournalIcon size={28} />}
                  title="Your flight log is ready."
                  body="After an instructor flight, enter the aircraft, route, and the flight-time categories agreed with your instructor."
                  action={
                    <div className="row" style={{ gap: "var(--space-3)", flexWrap: "wrap", justifyContent: "center" }}>
                      <Link className="button button--secondary" to="/journal/new?mode=discovery">
                        Log discovery flight
                      </Link>
                      <Link className="button button--primary" to="/journal/new">
                        <PlusIcon size={16} /> Log a flight
                      </Link>
                    </div>
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
                      <div className="row" style={{ gap: "var(--space-2)" }}>
                        <Link
                          className="button button--secondary button--small"
                          to={`/journal/new?event=${event.id}&mode=quick`}
                        >
                          Quick debrief
                        </Link>
                        <Link
                          className="button button--ghost button--small"
                          to={`/journal/new?event=${event.id}`}
                        >
                          Full log
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader
              title="Your training history"
              action={
                <span className="tiny dim">
                  {data.journalEntries.length}{" "}
                  {data.journalEntries.length === 1 ? "entry" : "entries"}
                </span>
              }
            />
            <CardBody flush>
              {data.journalEntries.length === 0 ? (
                <EmptyState
                  icon={<JournalIcon size={28} />}
                  title="Your journal is ready."
                  body="After your next lesson, write down what you practised, what your instructor said, and the one thing to work on. Over time this becomes the clearest record of how far you have come."
                  action={
                    <div className="row" style={{ gap: "var(--space-3)", flexWrap: "wrap", justifyContent: "center" }}>
                      <Link className="button button--secondary" to="/journal/new?mode=discovery">
                        Log discovery flight
                      </Link>
                      <Link className="button button--primary" to="/journal/new">
                        Log your first flight
                      </Link>
                    </div>
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
                        {entry.schoolName ? (
                          <span className="journal-entry__school tiny muted wrap-anywhere">
                            · {entry.schoolName}
                          </span>
                        ) : null}
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
