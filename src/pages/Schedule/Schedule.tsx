import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { PageHeader } from "@/components/layout/PageHeader";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  EmptyState,
  IconButton,
  PlusIcon,
} from "@/components/ui";
import { EVENT_TYPE_LABELS, type ScheduleEvent } from "@/domain/types";
import {
  addDays,
  formatMonthYear,
  formatTime,
  monthGrid,
  parseIsoDate,
  startOfMonth,
  todayIso,
  WEEKDAY_INITIALS,
} from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { useAppData } from "@/state/AppDataContext";

import { EventFormDialog, type EventDraft } from "./EventFormDialog";
import "./schedule.css";

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function Schedule() {
  const { data, mutate } = useAppData();
  const today = todayIso();
  const [saved, setSaved] = useState<ScheduleEvent | null>(null);
  const [creating, setCreating] = useState(false);
  const [monthAnchor, setMonthAnchor] = useState(startOfMonth(today));

  const { upcoming, past } = useMemo(() => {
    const sorted = [...data.events].sort((a, b) => a.date.localeCompare(b.date));
    return {
      upcoming: sorted.filter((event) => event.date >= today),
      past: sorted.filter((event) => event.date < today).reverse(),
    };
  }, [data.events, today]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, ScheduleEvent[]>();
    for (const event of data.events) {
      const list = map.get(event.date) ?? [];
      list.push(event);
      map.set(event.date, list);
    }
    return map;
  }, [data.events]);

  const save = async (draft: EventDraft) => {
    const created = await mutate((repos) => repos.schedule.create(draft));
    if (created === null) return;
    setCreating(false);
    setSaved(created);
  };

  return (
    <>
      <PageHeader
        title="Schedule"
        subtitle="Lessons, study sessions, tests and the deadlines around them."
        action={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <PlusIcon size={16} /> Add event
          </Button>
        }
      />

      {saved ? (
        <div className="row gap--3" style={{ marginBottom: "var(--space-4)", flexWrap: "wrap" }}>
          <p role="status" className="small">Added “{saved.title}” to your schedule.</p>
          {saved.eventType === "flight_lesson" ? (
            <Link to={`/schedule/${saved.id}#lesson-preparation`}>Add preparation</Link>
          ) : null}
        </div>
      ) : null}

      <div className="schedule">
        <div className="stack stack--5">
          <Card>
            <CardHeader
              title="Coming up"
              action={<span className="tiny dim">{upcoming.length} scheduled</span>}
            />
            <CardBody flush>
              {upcoming.length === 0 ? (
                <EmptyState
                  icon={<CalendarIcon size={26} />}
                  title="Nothing scheduled yet."
                  body="Add your next lesson, ground school session, or a deadline you need to keep in view."
                  action={
                    <Button variant="primary" onClick={() => setCreating(true)}>
                      Add your first event
                    </Button>
                  }
                />
              ) : (
                upcoming.map((event) => <EventRow key={event.id} event={event} today={today} />)
              )}
            </CardBody>
          </Card>

          {past.length > 0 ? (
            <Card>
              <CardHeader title="Already flown" />
              <CardBody flush>
                {past.slice(0, 12).map((event) => (
                  <EventRow key={event.id} event={event} today={today} past />
                ))}
              </CardBody>
            </Card>
          ) : null}
        </div>

        <Card>
          <CardHeader
            title={formatMonthYear(monthAnchor)}
            action={
              <div className="row" style={{ gap: 2 }}>
                <IconButton
                  label="Previous month"
                  onClick={() => setMonthAnchor(startOfMonth(addDays(monthAnchor, -1)))}
                >
                  <ChevronLeftIcon size={16} />
                </IconButton>
                <IconButton
                  label="Next month"
                  onClick={() => setMonthAnchor(startOfMonth(addDays(monthAnchor, 32)))}
                >
                  <ChevronRightIcon size={16} />
                </IconButton>
              </div>
            }
          />
          <CardBody>
            <div className="month">
              {WEEKDAY_INITIALS.map((initial, index) => (
                <div className="month__weekday" key={index} aria-hidden="true">
                  {initial}
                </div>
              ))}
              {monthGrid(monthAnchor)
                .flat()
                .map((date) => {
                  const dayEvents = eventsByDate.get(date) ?? [];
                  const outside = date.slice(0, 7) !== monthAnchor.slice(0, 7);
                  return (
                    <div
                      key={date}
                      className={[
                        "month__day",
                        outside ? "month__day--outside" : "",
                        date === today ? "month__day--today" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      <span>{parseIsoDate(date).getDate()}</span>
                      <span className="month__dots">
                        {dayEvents.slice(0, 3).map((event) => (
                          <span
                            key={event.id}
                            className={`month__dot${
                              event.eventType === "flight_lesson" ? "" : " month__dot--other"
                            }`}
                          />
                        ))}
                      </span>
                    </div>
                  );
                })}
            </div>
            <p className="tiny dim" style={{ marginTop: "var(--space-3)" }}>
              Dots mark days with something scheduled.
            </p>
          </CardBody>
        </Card>
      </div>

      <EventFormDialog
        open={creating}
        goals={data.goals}
        profile={data.profile}
        onClose={() => setCreating(false)}
        onSave={save}
      />
    </>
  );
}

function EventRow({
  event,
  today,
  past = false,
}: {
  event: ScheduleEvent;
  today: string;
  past?: boolean;
}) {
  const date = parseIsoDate(event.date);

  return (
    <Link className={`event-row${past ? " event-row--past" : ""}`} to={`/schedule/${event.id}`}>
      <span className="event-row__date">
        <span className="event-row__month">{MONTH_SHORT[date.getMonth()]}</span>
        <span className="event-row__day">{date.getDate()}</span>
      </span>

      <span className="event-row__main">
        <span className="event-row__title wrap-anywhere">{event.title}</span>
        <span className="event-row__meta">
          <Badge tone={event.eventType === "flight_lesson" ? "flight" : "neutral"}>
            {EVENT_TYPE_LABELS[event.eventType]}
          </Badge>
          {event.startTime ? <span>{formatTime(event.startTime)}</span> : null}
          {event.instructor ? <span>{event.instructor}</span> : null}
          {event.location ? <span>{event.location}</span> : null}
          {event.status === "completed" ? <Badge tone="complete">Completed</Badge> : null}
          {event.status === "cancelled" ? <Badge>Cancelled</Badge> : null}
          {event.date === today ? <Badge tone="due">Today</Badge> : null}
        </span>
      </span>

      {event.actualCost ?? event.estimatedCost ? (
        <span className="event-row__cost numeric">
          {event.actualCost != null ? (
            <>
              {formatMoney(event.actualCost)}
              <span className="tiny dim" style={{ display: "block" }}>
                actual
              </span>
            </>
          ) : (
            <>
              {formatMoney(event.estimatedCost as number)}
              <span className="tiny dim" style={{ display: "block" }}>
                estimated
              </span>
            </>
          )}
        </span>
      ) : null}
    </Link>
  );
}
