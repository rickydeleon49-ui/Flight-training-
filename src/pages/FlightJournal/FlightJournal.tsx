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
} from "@/components/ui";
import { formatLongDate, todayIso } from "@/lib/dates";
import { lessonsAwaitingDebrief } from "@/logic/preparation";
import { useAppData } from "@/state/AppDataContext";

import "./journal.css";

export function FlightJournal() {
  const { data } = useAppData();
  const today = todayIso();

  const journalEventIds = new Set(
    data.journalEntries.map((entry) => entry.eventId).filter((id): id is string => id !== null),
  );
  const awaiting = lessonsAwaitingDebrief(data.events, journalEventIds, today);

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
    </>
  );
}
