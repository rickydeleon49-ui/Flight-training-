import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { ActionFormDialog, type ActionDraft } from "@/components/actions/ActionFormDialog";
import { ActionRow } from "@/components/actions/ActionRow";
import { RescheduleDialog } from "@/components/actions/RescheduleDialog";
import { DailyPlanCard } from "@/components/dailyPlan/DailyPlanCard";
import { focusRenderedAction } from "@/components/dailyPlan/startAction";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  AlertIcon,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CheckIcon,
  ClockIcon,
  EmptyState,
  PlaneIcon,
  PlusIcon,
  TargetIcon,
} from "@/components/ui";
import {
  ACTION_CATEGORY_DESCRIPTIONS,
  ACTION_CATEGORY_LABELS,
  REVIEW_STATUS_LABELS,
  TOPIC_LABELS,
  type IsoDate,
  type JournalEntry,
  type NextAction,
} from "@/domain/types";
import { describeRelativeDate, formatLongDate, formatShortDate, formatTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { buildDashboard } from "@/logic/dashboard";
import { flightActivity, flightLogTotals, formatHours } from "@/logic/flightLog";
import { useAppData } from "@/state/AppDataContext";
import { useActionOperations } from "@/state/useActions";

import "./flightDeck.css";

export function FlightDeck() {
  const { data } = useAppData();
  const operations = useActionOperations();

  const [editing, setEditing] = useState<NextAction | null>(null);
  const [creating, setCreating] = useState(false);
  const [rescheduling, setRescheduling] = useState<NextAction | null>(null);

  const model = useMemo(
    () =>
      buildDashboard({
        profile: data.profile,
        actions: data.actions,
        events: data.events,
        prepItems: data.prepItems,
        materials: data.materials,
        milestones: data.milestones,
        goals: data.goals,
        checklistItems: data.checklistItems,
        journalEntries: data.journalEntries,
        questions: data.questions,
        transactions: data.transactions,
      }),
    [data],
  );

  // Start on a Flight Deck action: focus its own control where it is shown;
  // an action this page does not list (e.g. due later) opens in its editor.
  const startAction = (actionId: string) => {
    if (focusRenderedAction(actionId)) return;
    const action = data.actions.find((a) => a.id === actionId && a.status === "open");
    if (action) setEditing(action);
  };

  const saveAction = async (draft: ActionDraft) => {
    const result = editing
      ? await operations.update(editing.id, draft)
      : await operations.create(draft);
    if (result === null) return;
    setEditing(null);
    setCreating(false);
  };

  if (model.isEmpty) {
    return (
      <>
        <PageHeader title="Today's Flight Plan" subtitle={model.greeting} />
        <Card>
          <EmptyState
            icon={<PlaneIcon size={30} />}
            title="Your flight deck is ready."
            body="Add your first lesson, study material, or goal and this page will start telling you what to do next."
            action={
              <div className="row row--wrap" style={{ justifyContent: "center" }}>
                <Button variant="primary" onClick={() => setCreating(true)}>
                  Add a next action
                </Button>
                <Link className="button button--secondary" to="/schedule">
                  Schedule a lesson
                </Link>
                <Link className="button button--secondary" to="/study">
                  Add study material
                </Link>
              </div>
            }
          />
        </Card>
        {/* Her why belongs here most of all: a deck with nothing in it yet is
            exactly when the reason for starting is worth seeing. */}
        <div style={{ marginTop: "var(--space-5)", maxWidth: "34rem" }}>
          <WhyCard model={model} />
        </div>

        <ActionFormDialog
          open={creating}
          onClose={() => setCreating(false)}
          onSave={saveAction}
          defaultCategory="non_negotiable"
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Today's Flight Plan"
        subtitle={
          <>
            <span className="strong">{model.greeting}</span>
            {model.subtitle ? <> &nbsp;·&nbsp; {model.subtitle}</> : null}
          </>
        }
        action={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <PlusIcon size={16} /> Add action
          </Button>
        }
      />

      <div className="deck">
        <div className="deck__column">
          <DailyPlanCard onStartAction={startAction} />

          {model.topAction ? (
            <div className="top-action">
              <p className="top-action__label">Most important next</p>
              <p className="top-action__title wrap-anywhere">{model.topAction.title}</p>
              {model.topAction.dueDate ? (
                <p className="small muted" style={{ marginTop: "var(--space-2)" }}>
                  {describeRelativeDate(model.topAction.dueDate, model.today)}
                </p>
              ) : null}
            </div>
          ) : null}

          {model.needsAttention.length > 0 ? (
            <Card>
              <CardHeader
                title="Needs attention"
                action={
                  <Badge tone="overdue">
                    {model.needsAttention.length} overdue
                  </Badge>
                }
              />
              <CardBody>
                <p className="small muted" style={{ marginBottom: "var(--space-3)" }}>
                  This didn&rsquo;t get finished. Choose a realistic new time, or mark it done.
                </p>
                {model.needsAttention.map((action) => (
                  <div className="attention-row" key={action.id} id={`attention-${action.id}`}>
                    <div style={{ minWidth: 0 }}>
                      <p className="attention-row__title wrap-anywhere">{action.title}</p>
                      <p className="tiny" style={{ color: "var(--status-overdue)" }}>
                        {describeRelativeDate(action.dueDate as string, model.today)}
                      </p>
                    </div>
                    <div className="row" style={{ flex: "none" }}>
                      <Button size="small" onClick={() => setRescheduling(action)}>
                        Reschedule
                      </Button>
                      <Button
                        size="small"
                        variant="primary"
                        onClick={() => operations.toggle(action)}
                      >
                        Complete
                      </Button>
                    </div>
                  </div>
                ))}
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader
              title="Today's plan"
              action={
                <span className="tiny dim">
                  {model.planDoneCount > 0 ? `${model.planDoneCount} done · ` : ""}
                  {model.planCount} left
                </span>
              }
            />
            <CardBody flush>
              {model.planGroups.length === 0 ? (
                <EmptyState
                  icon={<CheckIcon size={26} />}
                  title="Nothing is scheduled for today."
                  body="A good moment to look at your Flight Path and choose the next step."
                  action={
                    <Button onClick={() => setCreating(true)}>Add an action</Button>
                  }
                />
              ) : (
                <div style={{ paddingBottom: "var(--space-4)" }}>
                  {model.planGroups.map((group) => (
                    <section className="action-group" key={group.category}>
                      <header className="action-group__heading">
                        <h3 className="action-group__name">
                          {ACTION_CATEGORY_LABELS[group.category]}
                        </h3>
                        <p className="action-group__hint">
                          {ACTION_CATEGORY_DESCRIPTIONS[group.category]}
                        </p>
                      </header>
                      {group.actions.map((action) => (
                        <div key={action.id} id={`action-${action.id}`}>
                          <ActionRow
                            action={action}
                            today={model.today}
                            onToggle={operations.toggle}
                            onEdit={setEditing}
                            onReschedule={setRescheduling}
                            onDelete={operations.remove}
                          />
                        </div>
                      ))}
                    </section>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          {model.encouragement ? (
            <p className="encouragement">
              <CheckIcon size={17} />
              <span>{model.encouragement}</span>
            </p>
          ) : null}
        </div>

        <div className="deck__column">
          <NextFlightCard model={model} />
          <FlightHoursCard entries={data.journalEntries} today={model.today} />
          <MilestoneCard model={model} />
          <StudyFocusCard model={model} />
          <KeyDatesCard model={model} />
          <WhyCard model={model} />

          {model.awaitingDebrief.length > 0 ? (
            <Card>
              <CardHeader title="Waiting on a debrief" eyebrow="Flight Journal" />
              <CardBody>
                <div className="stack stack--2">
                  {model.awaitingDebrief.slice(0, 3).map((event) => (
                    <div className="row row--between" key={event.id}>
                      <span className="small truncate">{event.title}</span>
                      <Link className="button button--ghost button--small" to="/journal">
                        Write it
                      </Link>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>

      <ActionFormDialog
        open={creating || editing !== null}
        action={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSave={saveAction}
      />

      <RescheduleDialog
        action={rescheduling}
        onClose={() => setRescheduling(null)}
        onReschedule={async (action, date) => {
          const result = await operations.reschedule(action, date);
          if (result === null) return;
          setRescheduling(null);
        }}
      />
    </>
  );
}

/* ----------------------------- Sub-cards ----------------------------- */

type Model = ReturnType<typeof buildDashboard>;

function FlightHoursCard({
  entries,
  today,
}: {
  entries: JournalEntry[];
  today: IsoDate;
}) {
  const totals = flightLogTotals(entries);
  if (totals.flights === 0) return null;
  const activity = flightActivity(entries, today);

  return (
    <Card>
      <CardHeader
        title="Flight hours"
        eyebrow="Logbook snapshot"
        action={<span className="tiny dim">{totals.flights} flights</span>}
      />
      <CardBody>
        <div className="deck-flight-hours">
          <div>
            <p className="deck-flight-hours__total numeric">{formatHours(totals.totalTime)}</p>
            <p className="tiny dim">total hours</p>
          </div>
          <div className="deck-flight-hours__recent">
            <p className="strong numeric">{formatHours(activity.hoursLast30Days)} hr</p>
            <p className="tiny dim">across {activity.flightsLast30Days} flights in 30 days</p>
          </div>
        </div>
        <div className="deck-flight-hours__categories tiny dim">
          <span>Dual {formatHours(totals.dualReceived)}</span>
          <span>Solo {formatHours(totals.soloTime)}</span>
          <span>XC {formatHours(totals.crossCountryTime)}</span>
          <span>Night {formatHours(totals.nightTime)}</span>
        </div>
        <Link
          className="button button--ghost button--small"
          style={{ marginTop: "var(--space-3)" }}
          to="/journal"
        >
          View hour dashboard
        </Link>
      </CardBody>
    </Card>
  );
}

function NextFlightCard({ model }: { model: Model }) {
  if (!model.nextFlight) {
    return (
      <Card>
        <CardHeader title="Next flight" />
        <CardBody>
          <EmptyState
            icon={<PlaneIcon size={26} />}
            title="Nothing scheduled yet."
            body="Add your next lesson and its preparation will appear here."
            action={
              <Link className="button button--secondary" to="/schedule">
                Open Schedule
              </Link>
            }
          />
        </CardBody>
      </Card>
    );
  }

  const { event, preparation, materials, daysAway } = model.nextFlight;

  return (
    <Card variant="accent">
      <CardHeader
        title="Next flight"
        action={
          <Badge tone="flight">
            {daysAway === 0 ? "Today" : daysAway === 1 ? "Tomorrow" : `in ${daysAway} days`}
          </Badge>
        }
      />
      <CardBody>
        <div className="stack stack--4">
          <div>
            <p className="next-flight__when">
              {formatLongDate(event.date, model.today)}
              {event.startTime ? ` · ${formatTime(event.startTime)}` : ""}
            </p>
            <p className="next-flight__title wrap-anywhere">{event.title}</p>
            {event.instructor || event.location ? (
              <p className="small muted" style={{ marginTop: "var(--space-1)" }}>
                {[event.instructor, event.location].filter(Boolean).join(" · ")}
              </p>
            ) : null}
          </div>

          {preparation.total > 0 ? (
            <div className="stack stack--3">
              <p className="prep-summary">
                <span className="strong">
                  {preparation.completed} of {preparation.total} ready
                </span>
              </p>
              <ul className="prep-list">
                {preparation.lines.map((line) => (
                  <li
                    className={`prep-list__item${line.done ? " prep-list__item--done" : ""}`}
                    key={`${line.source}-${line.id}`}
                  >
                    <span
                      className={`prep-list__state prep-list__state--${line.done ? "done" : "todo"}`}
                    >
                      {line.done ? <CheckIcon size={13} /> : <span aria-hidden="true">○</span>}
                      {line.done ? "Complete" : "Incomplete"}
                    </span>
                    <span className="prep-list__label wrap-anywhere">{line.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="small muted">
              No preparation listed yet. Add checklist items to this lesson so you know
              what to get ready.
            </p>
          )}

          {materials.length > 0 ? (
            <div className="stack stack--2">
              <p className="route-rule tiny strong" style={{ color: "var(--text-tertiary)" }}>
                Materials
              </p>
              {materials.map((material) => (
                <Link key={material.id} className="small truncate" to={`/study/${material.id}`}>
                  {material.title}
                </Link>
              ))}
            </div>
          ) : null}

          {event.estimatedCost ? (
            <p className="small muted numeric">
              Estimated cost: <span className="strong">{formatMoney(event.estimatedCost)}</span>
            </p>
          ) : null}

          <Link className="button button--secondary button--block" to={`/schedule/${event.id}`}>
            Open lesson
          </Link>
        </div>
      </CardBody>
    </Card>
  );
}

function MilestoneCard({ model }: { model: Model }) {
  if (!model.currentMilestone) return null;
  const { milestone, progress, nextAction } = model.currentMilestone;

  return (
    <Card>
      <CardHeader title={milestone.title} eyebrow="Current milestone" />
      <CardBody>
        <div className="stack stack--4">
          {progress.total === 0 ? (
            <p className="small muted">
              No goals yet for this milestone. Add one to start tracking real evidence.
            </p>
          ) : (
            <>
              {progress.completed.length > 0 ? (
                <div className="stack stack--2">
                  <p className="tiny strong dim">Completed</p>
                  <ul className="evidence-list">
                    {progress.completed.slice(0, 3).map((goal) => (
                      <li className="evidence-list__item" key={goal.id}>
                        <span className="evidence-list__marker">
                          <CheckIcon size={13} />
                        </span>
                        <span className="wrap-anywhere">{goal.title}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {progress.workingOn.length > 0 ? (
                <div className="stack stack--2">
                  <p className="tiny strong dim">Working on</p>
                  <ul className="evidence-list">
                    {progress.workingOn.slice(0, 3).map((goal) => (
                      <li className="evidence-list__item" key={goal.id}>
                        <span className="evidence-list__marker evidence-list__marker--open">
                          <TargetIcon size={13} />
                        </span>
                        <span className="wrap-anywhere">{goal.title}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          )}

          {nextAction ? (
            <div>
              <p className="tiny strong dim">Next action</p>
              <p className="small wrap-anywhere">{nextAction.title}</p>
            </div>
          ) : null}

          <Link className="button button--ghost button--small" to="/flight-path">
            View Flight Path
          </Link>
        </div>
      </CardBody>
    </Card>
  );
}

/**
 * Why she started, in her own words.
 *
 * Deliberately the quietest thing on the page and the only card that asks
 * nothing of her — it sits at the end of the column, below the work.
 */
function WhyCard({ model }: { model: Model }) {
  if (!model.personal) return null;
  const { photo, whyNote } = model.personal;

  return (
    <section className="why-card">
      {photo ? <img className="why-card__photo" src={photo} alt="" /> : null}
      {whyNote ? (
        <>
          <p className="why-card__label">Why you started</p>
          <p className="why-card__note wrap-anywhere">{whyNote}</p>
        </>
      ) : null}
    </section>
  );
}

function KeyDatesCard({ model }: { model: Model }) {
  if (model.keyDates.length === 0) return null;

  return (
    <Card>
      <CardHeader title="Dates ahead" />
      <CardBody>
        <div className="stack stack--3">
          {model.keyDates.map((date) => (
            <div className="row row--between" key={date.id}>
              <span className="small truncate">{date.label}</span>
              <span className="row" style={{ gap: "var(--space-2)", flex: "none" }}>
                <span className="tiny dim">{formatShortDate(date.date)}</span>
                {date.passed ? (
                  <Badge tone="overdue" icon={<AlertIcon size={12} />}>
                    Expired
                  </Badge>
                ) : date.daysAway <= 30 ? (
                  <Badge tone="due" icon={<ClockIcon size={12} />}>
                    {date.daysAway === 0 ? "Today" : `${date.daysAway}d`}
                  </Badge>
                ) : (
                  <span className="tiny dim">{date.daysAway}d</span>
                )}
              </span>
            </div>
          ))}
          <p className="tiny dim">
            Your own reminders. Official documents and your instructor remain the
            authority on what is current.
          </p>
        </div>
      </CardBody>
    </Card>
  );
}

function StudyFocusCard({ model }: { model: Model }) {
  if (!model.studyFocus) return null;
  const { material, nextAction } = model.studyFocus;

  return (
    <Card>
      <CardHeader title="Study focus" />
      <CardBody>
        <div className="stack stack--3">
          <div>
            <p className="strong wrap-anywhere">{material.title}</p>
            <div className="row row--wrap" style={{ marginTop: "var(--space-2)" }}>
              <Badge tone="study">{TOPIC_LABELS[material.topic]}</Badge>
              <Badge>{REVIEW_STATUS_LABELS[material.reviewStatus]}</Badge>
            </div>
          </div>
          {nextAction ? (
            <div>
              <p className="tiny strong dim">Next action</p>
              <p className="small wrap-anywhere">{nextAction.title}</p>
            </div>
          ) : null}
          <Link className="button button--secondary button--small" to={`/study/${material.id}`}>
            Open material
          </Link>
        </div>
      </CardBody>
    </Card>
  );
}
