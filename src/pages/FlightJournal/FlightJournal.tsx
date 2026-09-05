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
import { lessonsAwaitingDebrief } from "@/logic/preparation";
import { useAppData } from "@/state/AppDataContext";

import "./journal.css";

type View = "debriefs" | "feedback";

export function FlightJournal() {
  const { data } = useAppData();
  const today = todayIso();
  const [view, setView] = useState<View>("debriefs");
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

  return (
    <>
      <PageHeader
        title="Flight Journal"
        subtitle="What happened, what your instructor said, and what to do about it."
        action={
          <Link className="button button--primary" to="/journal/new">
            <PlusIcon size={16} /> Write a debrief
          </Link>
        }
      />

      <div className="view-tabs filter-chips">
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
                      Write your first debrief
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
