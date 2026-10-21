import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { ActionFormDialog, type ActionDraft } from "@/components/actions/ActionFormDialog";
import { ActionRow } from "@/components/actions/ActionRow";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CheckIcon,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  IconButton,
  PlusIcon,
  Select,
  TextInput,
  TrashIcon,
} from "@/components/ui";
import { EVENT_STATUS_LABELS, EVENT_TYPE_LABELS, type Id } from "@/domain/types";
import { formatLongDate, formatTime, todayIso } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { actionsFor } from "@/logic/actions";
import { lessonPreparation } from "@/logic/preparation";
import { useAppData } from "@/state/AppDataContext";
import { useActionOperations } from "@/state/useActions";

import { CalendarExportDialog } from "./CalendarExportDialog";
import { EventFormDialog, type EventDraft } from "./EventFormDialog";
import { LessonBriefDialog } from "./LessonBriefDialog";
import "./schedule.css";

export function EventDetail() {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const { data, mutate, deleteWithUndo } = useAppData();
  const operations = useActionOperations();
  const today = todayIso();

  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [briefOpen, setBriefOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [addingAction, setAddingAction] = useState(false);
  const [newPrepItem, setNewPrepItem] = useState("");
  const [materialToAttach, setMaterialToAttach] = useState("");

  const event = data.events.find((candidate) => candidate.id === eventId) ?? null;

  const preparation = useMemo(
    () =>
      event
        ? lessonPreparation(event, { prepItems: data.prepItems, questions: data.questions, homework: data.homework })
        : null,
    [event, data.prepItems, data.questions, data.homework],
  );

  const relatedActions = event ? actionsFor(data.actions, "event", event.id) : [];
  const attachedMaterials = event
    ? data.materials.filter((material) => event.materialIds.includes(material.id))
    : [];
  const journalEntry = event
    ? data.journalEntries.find((entry) => entry.eventId === event.id)
    : undefined;
  const recordedCost = event
    ? data.transactions.find(
        (transaction) => transaction.eventId === event.id && transaction.source === "lesson_cost",
      )
    : undefined;

  if (!event) {
    return (
      <>
        <PageHeader title="Event not found" />
        <Card>
          <EmptyState
            title="That event is no longer here."
            body="It may have been deleted."
            action={
              <Link className="button button--secondary" to="/schedule">
                Back to Schedule
              </Link>
            }
          />
        </Card>
      </>
    );
  }

  const prepItems = data.prepItems.filter((item) => item.eventId === event.id);
  // Only a lesson that has happened can be debriefed or turned into an expense.
  const hasHappened = event.date <= today || event.status === "completed";
  const goal = data.goals.find((candidate) => candidate.id === event.goalId);
  const availableMaterials = data.materials.filter(
    (material) => !event.materialIds.includes(material.id),
  );

  const saveEvent = async (draft: EventDraft) => {
    const result = await mutate((repos) => repos.schedule.update(event.id, draft));
    if (result === null) return;
    setEditing(false);
  };

  const addPrepItem = async () => {
    const title = newPrepItem.trim();
    if (!title) return;
    const result = await mutate((repos) =>
      repos.schedule.addPrepItem(event.id, title, prepItems.length),
    );
    if (result === null) return;
    setNewPrepItem("");
  };

  const attachMaterial = async (materialId: Id) => {
    if (!materialId) return;
    const result = await mutate((repos) =>
      repos.schedule.setMaterials(event.id, [...event.materialIds, materialId]),
    );
    if (result === null) return;
    setMaterialToAttach("");
  };

  const recordCost = () => {
    const amount = event.actualCost ?? event.estimatedCost;
    if (amount == null) return;
    return mutate((repos) =>
      repos.finance.recordLessonCost({
        eventId: event.id,
        amount,
        date: event.date,
        description: event.title,
        goalId: event.goalId,
      }),
    );
  };

  return (
    <>
      <PageHeader
        title={event.title}
        subtitle={
          <>
            {formatLongDate(event.date, today)}
            {event.startTime ? ` · ${formatTime(event.startTime)}` : ""}
            {event.endTime ? `–${formatTime(event.endTime)}` : ""}
          </>
        }
        action={
          <div className="row">
            <Link className="button button--ghost" to="/schedule">
              Back
            </Link>
            <Button onClick={() => setBriefOpen(true)}>Lesson brief</Button>
            {event.status !== "completed" ? (
              <Button onClick={() => setCalendarOpen(true)}>Add to calendar…</Button>
            ) : null}
            <Button onClick={() => setEditing(true)}>Edit</Button>
            <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
              Delete
            </Button>
          </div>
        }
      />

      <div className="detail">
        <div className="detail__column">
          <Card>
            <CardHeader
              title="Preparation"
              action={
                preparation && preparation.total > 0 ? (
                  <Badge tone={preparation.ready ? "complete" : "neutral"}>
                    {preparation.completed} of {preparation.total} ready
                  </Badge>
                ) : null
              }
            />
            <CardBody>
              <div className="stack stack--4">
                {prepItems.length === 0 && preparation?.total === 0 ? (
                  <p className="small muted">
                    Nothing listed yet. Add what you want ready before this lesson so the
                    Flight Deck can remind you.
                  </p>
                ) : (
                  <div>
                    {prepItems.map((item) => (
                      <div className="checklist-row" key={item.id}>
                        <Checkbox
                          checked={item.done}
                          label={item.title}
                          onChange={(done) =>
                            mutate((repos) => repos.schedule.setPrepItemDone(item.id, done))
                          }
                        />
                        <span className="checklist-row__tools">
                          <IconButton
                            label={`Remove ${item.title}`}
                            tone="danger"
                            onClick={() => mutate((repos) => repos.schedule.removePrepItem(item.id))}
                          >
                            <TrashIcon size={16} />
                          </IconButton>
                        </span>
                      </div>
                    ))}

                    {preparation?.lines
                      .filter((line) => line.source === "question" || line.source === "homework")
                      .map((line) => (
                        <div className="checklist-row" key={line.id}>
                          <span className="small">
                            {line.done ? (
                              <span style={{ color: "var(--status-complete)" }}>
                                <CheckIcon size={13} />{" "}
                              </span>
                            ) : (
                              <span className="dim">○ </span>
                            )}
                            {line.label}
                          </span>
                          <Link className="tiny" to={line.source === "homework" ? `/study/homework/${line.assignmentId}?activity=${line.id}` : "/questions"}>
                            {line.source === "homework" ? "Homework" : "Questions"}
                          </Link>
                        </div>
                      ))}
                  </div>
                )}

                <div className="inline-add">
                  <TextInput
                    value={newPrepItem}
                    placeholder="Weather review"
                    aria-label="New preparation item"
                    onChange={(e) => setNewPrepItem(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void addPrepItem();
                      }
                    }}
                  />
                  <Button onClick={addPrepItem} disabled={!newPrepItem.trim()}>
                    Add
                  </Button>
                </div>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Next actions"
              action={
                <Button size="small" onClick={() => setAddingAction(true)}>
                  <PlusIcon size={14} /> Add
                </Button>
              }
            />
            <CardBody flush>
              {relatedActions.length === 0 ? (
                <p className="small muted" style={{ padding: "0 var(--space-5) var(--space-5)" }}>
                  Nothing attached to this lesson yet.
                </p>
              ) : (
                <div style={{ paddingBottom: "var(--space-3)" }}>
                  {relatedActions.map((action) => (
                    <ActionRow
                      key={action.id}
                      action={action}
                      today={today}
                      onToggle={operations.toggle}
                      onDelete={operations.remove}
                    />
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Study materials" />
            <CardBody>
              <div className="stack stack--3">
                {attachedMaterials.length === 0 ? (
                  <p className="small muted">
                    Attach the notes or worksheets you want to review before this lesson.
                  </p>
                ) : (
                  attachedMaterials.map((material) => (
                    <div className="row row--between" key={material.id}>
                      <Link className="small truncate" to={`/study/${material.id}`}>
                        {material.title}
                      </Link>
                      <IconButton
                        label={`Detach ${material.title}`}
                        onClick={() =>
                          mutate((repos) =>
                            repos.schedule.setMaterials(
                              event.id,
                              event.materialIds.filter((id) => id !== material.id),
                            ),
                          )
                        }
                      >
                        <TrashIcon size={15} />
                      </IconButton>
                    </div>
                  ))
                )}

                {availableMaterials.length > 0 ? (
                  <Select
                    aria-label="Attach a study material"
                    placeholder="Attach a material…"
                    options={availableMaterials.map((m) => ({ value: m.id, label: m.title }))}
                    value={materialToAttach}
                    onChange={(value) => attachMaterial(value)}
                  />
                ) : null}
              </div>
            </CardBody>
          </Card>
        </div>

        <div className="detail__column">
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <dl className="definition">
                <dt>Type</dt>
                <dd>{EVENT_TYPE_LABELS[event.eventType]}</dd>
                <dt>Status</dt>
                <dd>{EVENT_STATUS_LABELS[event.status]}</dd>
                {event.instructor ? (
                  <>
                    <dt>Instructor</dt>
                    <dd>{event.instructor}</dd>
                  </>
                ) : null}
                {event.location ? (
                  <>
                    <dt>Location</dt>
                    <dd>{event.location}</dd>
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
                {event.notes ? (
                  <>
                    <dt>Notes</dt>
                    <dd className="wrap-anywhere">{event.notes}</dd>
                  </>
                ) : null}
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Cost" />
            <CardBody>
              <div className="stack stack--3">
                <dl className="definition">
                  <dt>Estimated</dt>
                  <dd className="numeric">
                    {event.estimatedCost != null ? formatMoney(event.estimatedCost) : "—"}
                  </dd>
                  <dt>Actual</dt>
                  <dd className="numeric">
                    {event.actualCost != null ? formatMoney(event.actualCost) : "—"}
                  </dd>
                </dl>

                {recordedCost ? (
                  <p className="small" style={{ color: "var(--status-complete)" }}>
                    <CheckIcon size={14} /> Recorded as an expense of{" "}
                    {formatMoney(recordedCost.amount)}.{" "}
                    <Link to="/finances">See it in Finances</Link>
                  </p>
                ) : event.actualCost == null && event.estimatedCost == null ? (
                  <p className="small muted">Add a cost to this lesson to record it as an expense.</p>
                ) : event.status === "cancelled" && event.actualCost == null ? (
                  <p className="small muted">
                    This lesson was cancelled, so its estimate isn't recorded. If you paid a
                    cancellation fee, add it as the actual cost to record it.
                  </p>
                ) : ((event.actualCost ?? event.estimatedCost) as number) <= 0 ? (
                  <p className="small muted">
                    Edit this lesson's cost to an amount above zero to record it as an expense.
                  </p>
                ) : hasHappened ? (
                  <>
                    <Button variant="primary" block onClick={recordCost}>
                      Record{" "}
                      {formatMoney((event.actualCost ?? event.estimatedCost) as number)} as an
                      expense
                    </Button>
                    <p className="tiny dim">
                      This can only be done once for a lesson, so the same cost never lands
                      twice.
                    </p>
                  </>
                ) : (
                  <p className="tiny dim">
                    Counted as an upcoming cost in Finances. You can record what it actually
                    cost once it has happened.
                  </p>
                )}
              </div>
            </CardBody>
          </Card>

          {hasHappened ? (
          <Card>
            <CardHeader title="After the lesson" />
            <CardBody>
              <div className="stack stack--3">
                {event.status !== "completed" ? (
                  <Button
                    block
                    onClick={() => mutate((repos) => repos.schedule.update(event.id, { status: "completed" }))}
                  >
                    Mark as completed
                  </Button>
                ) : null}

                {journalEntry ? (
                  <Link
                    className="button button--secondary button--block"
                    to={`/journal/${journalEntry.id}`}
                  >
                    Debrief written — open journal
                  </Link>
                ) : (
                  <div className="stack stack--2">
                    <Link
                      className="button button--primary button--block"
                      to={`/journal/new?event=${event.id}&mode=quick`}
                    >
                      Quick debrief
                    </Link>
                    <Link
                      className="button button--secondary button--block"
                      to={`/journal/new?event=${event.id}`}
                    >
                      Full flight log & debrief
                    </Link>
                  </div>
                )}
              </div>
            </CardBody>
          </Card>
          ) : null}
        </div>
      </div>

      <LessonBriefDialog open={briefOpen} event={event} onClose={() => setBriefOpen(false)} />

      <CalendarExportDialog
        open={calendarOpen}
        event={event}
        onClose={() => setCalendarOpen(false)}
      />

      <EventFormDialog
        open={editing}
        event={event}
        goals={data.goals}
        profile={data.profile}
        onClose={() => setEditing(false)}
        onSave={saveEvent}
      />

      <ActionFormDialog
        open={addingAction}
        relatedType="event"
        relatedId={event.id}
        onClose={() => setAddingAction(false)}
        onSave={async (draft: ActionDraft) => {
          const result = await operations.create(draft);
          if (result === null) return;
          setAddingAction(false);
        }}
      />

      <ConfirmDialog
        open={confirmingDelete}
        title="Delete this event?"
        message="Its preparation checklist goes with it. Journal entries and expenses you have recorded are kept."
        onConfirm={() => {
          setConfirmingDelete(false);
          deleteWithUndo({
            // Its preparation checklist disappears with it.
            ids: [event.id, ...prepItems.map((item) => item.id)],
            label: event.title,
            run: (repos) => repos.schedule.remove(event.id),
          });
          navigate("/schedule");
        }}
        onCancel={() => setConfirmingDelete(false)}
      />
    </>
  );
}
