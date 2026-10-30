import { useRef, useState } from "react";
import { Link } from "react-router-dom";

import { ActionFormDialog, type ActionDraft } from "@/components/actions/ActionFormDialog";
import { ActionRow } from "@/components/actions/ActionRow";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CheckIcon,
  Checkbox,
  ChevronLeftIcon,
  ChevronRightIcon,
  ConfirmDialog,
  EditIcon,
  EmptyState,
  IconButton,
  PlusIcon,
  RouteIcon,
  Select,
  TextInput,
  TrashIcon,
} from "@/components/ui";
import {
  GOAL_STATUS_LABELS,
  GOAL_STATUS_OPTIONS,
  type Goal,
  type Milestone,
} from "@/domain/types";
import { formatShortDate, todayIso } from "@/lib/dates";
import { actionsFor } from "@/logic/actions";
import { trainingDuration } from "@/logic/keyDates";
import { goalEvidence, hasEvidence, milestoneProgress, reorderMilestones } from "@/logic/progress";
import { useAppData } from "@/state/AppDataContext";
import { useActionOperations } from "@/state/useActions";

import { GoalFormDialog, type GoalDraft } from "./GoalFormDialog";
import { MilestoneFormDialog, type MilestoneDraft } from "./MilestoneFormDialog";
import { SkillsSection } from "./skills/SkillsSection";
import { BeforeYouEnroll } from "./BeforeYouEnroll";
import "./flightPath.css";

export function FlightPath() {
  const { data, mutate, deleteWithUndo } = useAppData();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [creatingGoalFor, setCreatingGoalFor] = useState<string | null>(null);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [editingMilestone, setEditingMilestone] = useState<Milestone | null>(null);
  const [deletingMilestone, setDeletingMilestone] = useState<Milestone | null>(null);
  const [newMilestone, setNewMilestone] = useState("");
  // Enter held down or a double-click must not add the stage twice.
  const addingMilestone = useRef(false);
  const [milestoneBusy, setMilestoneBusy] = useState(false);

  // Goals with no stage — created that way, or left behind when a milestone
  // was deleted. Without this they would exist but be invisible.
  const milestoneIds = new Set(data.milestones.map((milestone) => milestone.id));
  const unassignedGoals = data.goals.filter(
    (goal) => goal.milestoneId === null || !milestoneIds.has(goal.milestoneId),
  );

  const trainedFor = trainingDuration(data.profile.trainingStartedOn);

  const currentId =
    data.profile.currentMilestoneId ??
    data.milestones.find((m) => m.status === "in_progress")?.id ??
    null;

  const addMilestone = async () => {
    const title = newMilestone.trim();
    if (!title || addingMilestone.current) return;
    addingMilestone.current = true;
    setMilestoneBusy(true);
    try {
      const created = await mutate((repos) =>
        repos.milestones.create({ title, position: data.milestones.length }),
      );
      if (created === null) return;
      setNewMilestone("");
    } finally {
      addingMilestone.current = false;
      setMilestoneBusy(false);
    }
  };

  const moveMilestone = (milestone: Milestone, direction: "up" | "down") => {
    const updates = reorderMilestones(data.milestones, milestone.id, direction);
    if (updates.length === 0) return;
    // One atomic write: a failure part-way never leaves a half-moved list.
    return mutate((repos) => repos.milestones.reorder(updates));
  };

  const saveMilestone = async (draft: MilestoneDraft) => {
    if (!editingMilestone) return;
    const result = await mutate((repos) =>
      repos.milestones.update(editingMilestone.id, draft),
    );
    if (result === null) return;
    setEditingMilestone(null);
  };

  const saveGoal = async (draft: GoalDraft) => {
    const result = editingGoal
      ? await mutate((repos) => repos.goals.update(editingGoal.id, draft))
      : await mutate((repos) => repos.goals.create(draft));
    if (result === null) return;
    setEditingGoal(null);
    setCreatingGoalFor(null);
  };

  if (data.milestones.length === 0) {
    return (
      <>
        <PageHeader title="Flight Path" subtitle="Where you are going, and what you are working toward." />
        <BeforeYouEnroll profile={data.profile} />
        <Card>
          <EmptyState
            icon={<RouteIcon size={30} />}
            title="Your flight path starts here."
            body="Add the stages of your training — exploring, ground school, first lessons, the skills you want to build. Requirements differ by school and instructor, so these are yours to shape."
            action={
              <div className="inline-add" style={{ maxWidth: "26rem" }}>
                <TextInput
                  value={newMilestone}
                  aria-label="New milestone"
                  placeholder="Build Landing Confidence"
                  onChange={(e) => setNewMilestone(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void addMilestone();
                    }
                  }}
                />
                <Button variant="primary" onClick={addMilestone} disabled={milestoneBusy || !newMilestone.trim()}>
                  Add
                </Button>
              </div>
            }
          />
        </Card>
        <SkillsSection />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Flight Path"
        subtitle={
          trainedFor
            ? `Where you are going, and what you are working toward. ${trainedFor} of training so far.`
            : "Where you are going, and what you are working toward."
        }
      />

      <BeforeYouEnroll profile={data.profile} />

      <div className="path">
        {data.milestones.map((milestone, index) => (
          <MilestoneSection
            key={milestone.id}
            milestone={milestone}
            isCurrent={milestone.id === currentId}
            expandedGoalId={expanded}
            onToggleGoal={(goalId) => setExpanded(expanded === goalId ? null : goalId)}
            onAddGoal={() => setCreatingGoalFor(milestone.id)}
            onEditGoal={setEditingGoal}
            onEditMilestone={() => setEditingMilestone(milestone)}
            onDeleteMilestone={() => setDeletingMilestone(milestone)}
            onMove={(direction) => moveMilestone(milestone, direction)}
            canMoveUp={index > 0}
            canMoveDown={index < data.milestones.length - 1}
          />
        ))}

        {unassignedGoals.length > 0 ? (
          <section className="waypoint waypoint--unassigned">
            <span className="waypoint__marker" aria-hidden="true" />
            <div className="waypoint__head">
              <h2 className="waypoint__title">Not part of a stage</h2>
              <span className="tiny dim">
                {unassignedGoals.length} {unassignedGoals.length === 1 ? "goal" : "goals"}
              </span>
            </div>
            <p className="small muted" style={{ marginBottom: "var(--space-3)" }}>
              These are yours to keep here, or edit one to move it into a stage.
            </p>
            {unassignedGoals.map((goal) => (
              <GoalCard
                key={goal.id}
                goal={goal}
                expanded={expanded === goal.id}
                onToggle={() => setExpanded(expanded === goal.id ? null : goal.id)}
                onEdit={() => setEditingGoal(goal)}
              />
            ))}
          </section>
        ) : null}
      </div>

      <Card variant="quiet">
        <CardBody>
          <div className="inline-add" style={{ maxWidth: "28rem" }}>
            <TextInput
              value={newMilestone}
              aria-label="New milestone"
              placeholder="Add another stage of your training"
              onChange={(e) => setNewMilestone(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void addMilestone();
                }
              }}
            />
            <Button onClick={addMilestone} disabled={milestoneBusy || !newMilestone.trim()}>
              <PlusIcon size={14} /> Milestone
            </Button>
          </div>
          <p className="tiny dim" style={{ marginTop: "var(--space-3)" }}>
            Training requirements differ by location, school, instructor and certificate.
            These stages are yours — your instructor and the official requirements remain
            authoritative.
          </p>
        </CardBody>
      </Card>

      <SkillsSection />

      <MilestoneFormDialog
        open={editingMilestone !== null}
        milestone={editingMilestone}
        onClose={() => setEditingMilestone(null)}
        onSave={saveMilestone}
      />

      <ConfirmDialog
        open={deletingMilestone !== null}
        title="Delete this milestone?"
        message="Goals in it are kept and simply stop belonging to a stage. You can move them to another milestone afterwards."
        onConfirm={() => {
          const milestone = deletingMilestone;
          setDeletingMilestone(null);
          if (milestone) {
            deleteWithUndo({
              ids: [milestone.id],
              label: milestone.title,
              run: (repos) => repos.milestones.remove(milestone.id),
            });
          }
        }}
        onCancel={() => setDeletingMilestone(null)}
      />

      <GoalFormDialog
        open={creatingGoalFor !== null || editingGoal !== null}
        goal={editingGoal}
        milestoneId={creatingGoalFor ?? editingGoal?.milestoneId ?? null}
        milestones={data.milestones}
        onClose={() => {
          setCreatingGoalFor(null);
          setEditingGoal(null);
        }}
        onSave={saveGoal}
      />
    </>
  );
}

function MilestoneSection({
  milestone,
  isCurrent,
  expandedGoalId,
  onToggleGoal,
  onAddGoal,
  onEditGoal,
  onEditMilestone,
  onDeleteMilestone,
  onMove,
  canMoveUp,
  canMoveDown,
}: {
  milestone: Milestone;
  isCurrent: boolean;
  expandedGoalId: string | null;
  onToggleGoal: (goalId: string) => void;
  onAddGoal: () => void;
  onEditGoal: (goal: Goal) => void;
  onEditMilestone: () => void;
  onDeleteMilestone: () => void;
  onMove: (direction: "up" | "down") => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const { data } = useAppData();
  const progress = milestoneProgress(milestone, data.goals);
  const goals = data.goals.filter((goal) => goal.milestoneId === milestone.id);

  const state = milestone.status === "completed" ? "done" : isCurrent ? "current" : "ahead";

  return (
    <section className={`waypoint waypoint--${state}`}>
      <span className="waypoint__marker" aria-hidden="true">
        {milestone.status === "completed" ? <CheckIcon size={11} /> : null}
      </span>

      <div className="waypoint__head">
        <h2 className="waypoint__title">{milestone.title}</h2>
        {isCurrent ? <Badge tone="berry">Current</Badge> : null}
        {milestone.status === "completed" ? <Badge tone="complete">Completed</Badge> : null}
        {progress.total > 0 ? (
          <span className="tiny dim">
            {progress.completed.length} of {progress.total} goals comfortable or complete
          </span>
        ) : null}
        <div className="waypoint__tools">
          <Button size="small" variant="ghost" onClick={onAddGoal}>
            <PlusIcon size={13} /> Goal
          </Button>
          <IconButton
            label={`Move ${milestone.title} earlier`}
            disabled={!canMoveUp}
            onClick={() => onMove("up")}
          >
            <span style={{ transform: "rotate(90deg)", display: "inline-flex" }}>
              <ChevronLeftIcon size={15} />
            </span>
          </IconButton>
          <IconButton
            label={`Move ${milestone.title} later`}
            disabled={!canMoveDown}
            onClick={() => onMove("down")}
          >
            <span style={{ transform: "rotate(90deg)", display: "inline-flex" }}>
              <ChevronRightIcon size={15} />
            </span>
          </IconButton>
          <IconButton label={`Edit ${milestone.title}`} onClick={onEditMilestone}>
            <EditIcon size={15} />
          </IconButton>
          <IconButton
            className="destructive-action" label={`Delete ${milestone.title}`}
            tone="danger"
            onClick={onDeleteMilestone}
          >
            <TrashIcon size={15} />
          </IconButton>
        </div>
      </div>

      {milestone.description ? (
        <p className="small muted" style={{ marginBottom: "var(--space-3)" }}>
          {milestone.description}
        </p>
      ) : null}

      {goals.length === 0 ? (
        <p className="small dim">No goals here yet.</p>
      ) : (
        goals.map((goal) => (
          <GoalCard
            key={goal.id}
            goal={goal}
            expanded={expandedGoalId === goal.id}
            onToggle={() => onToggleGoal(goal.id)}
            onEdit={() => onEditGoal(goal)}
          />
        ))
      )}
    </section>
  );
}

function GoalCard({
  goal,
  expanded,
  onToggle,
  onEdit,
}: {
  goal: Goal;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
}) {
  const { data, mutate, deleteWithUndo } = useAppData();
  const operations = useActionOperations();
  const today = todayIso();
  const [addingAction, setAddingAction] = useState(false);
  const [newItem, setNewItem] = useState("");
  const addingItem = useRef(false);
  const [itemBusy, setItemBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const evidence = goalEvidence(goal, {
    journalEntries: data.journalEntries,
    materials: data.materials,
    checklistItems: data.checklistItems,
    events: data.events,
  });
  const checklist = data.checklistItems.filter((item) => item.goalId === goal.id);
  const actions = actionsFor(data.actions, "goal", goal.id);
  const materials = data.materials.filter((material) => material.goalId === goal.id);

  const tone =
    goal.status === "completed" || goal.status === "comfortable"
      ? "complete"
      : goal.status === "working_on"
        ? "berry"
        : "neutral";

  const addChecklistItem = async () => {
    const title = newItem.trim();
    if (!title || addingItem.current) return;
    addingItem.current = true;
    setItemBusy(true);
    try {
      const result = await mutate((repos) =>
        repos.goals.addChecklistItem(goal.id, title, checklist.length),
      );
      if (result === null) return;
      setNewItem("");
    } finally {
      addingItem.current = false;
      setItemBusy(false);
    }
  };

  return (
    <article className="goal-card">
      <button
        type="button"
        className="goal-card__head"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <span
          style={{
            transform: expanded ? "rotate(90deg)" : "none",
            transition: "transform var(--transition)",
            color: "var(--text-tertiary)",
            display: "inline-flex",
          }}
          aria-hidden="true"
        >
          <ChevronRightIcon size={16} />
        </span>
        <span className="goal-card__title wrap-anywhere">{goal.title}</span>
        <Badge tone={tone}>{GOAL_STATUS_LABELS[goal.status]}</Badge>
      </button>

      {expanded ? (
        <div className="goal-card__body stack stack--4">
          {goal.description ? <p className="small muted">{goal.description}</p> : null}

          {hasEvidence(evidence) ? (
            <div className="evidence">
              {evidence.lessonsRecorded > 0 ? (
                <span className="evidence__item">
                  <span className="evidence__value">{evidence.lessonsRecorded}</span>
                  {evidence.lessonsRecorded === 1 ? "lesson recorded" : "lessons recorded"}
                </span>
              ) : null}
              {evidence.journalEntries > 0 ? (
                <span className="evidence__item">
                  <span className="evidence__value">{evidence.journalEntries}</span>
                  {evidence.journalEntries === 1 ? "journal entry" : "journal entries"}
                </span>
              ) : null}
              {evidence.materialsTotal > 0 ? (
                <span className="evidence__item">
                  <span className="evidence__value">
                    {evidence.materialsReviewed}/{evidence.materialsTotal}
                  </span>
                  materials reviewed
                </span>
              ) : null}
              {evidence.checklistTotal > 0 ? (
                <span className="evidence__item">
                  <span className="evidence__value">
                    {evidence.checklistDone}/{evidence.checklistTotal}
                  </span>
                  checklist done
                </span>
              ) : null}
              {evidence.confidence != null ? (
                <span className="evidence__item">
                  Confidence
                  <span className="confidence" aria-label={`Confidence ${evidence.confidence} of 5`}>
                    {[1, 2, 3, 4, 5].map((pip) => (
                      <span
                        key={pip}
                        className={`confidence__pip${
                          pip <= (evidence.confidence ?? 0) ? " confidence__pip--on" : ""
                        }`}
                      />
                    ))}
                  </span>
                </span>
              ) : null}
              {evidence.lastPracticed ? (
                <span className="evidence__item">
                  Last practised
                  <span className="evidence__value">{formatShortDate(evidence.lastPracticed)}</span>
                </span>
              ) : null}
            </div>
          ) : (
            <p className="small dim">
              No evidence yet. Lessons, journal entries and reviewed materials will show up
              here as you work on this.
            </p>
          )}

          {checklist.length > 0 ? (
            <div className="stack stack--1">
              {checklist.map((item) => (
                <div className="checklist-row" key={item.id}>
                  <Checkbox
                    checked={item.done}
                    label={item.title}
                    onChange={(done) =>
                      mutate((repos) => repos.goals.setChecklistItemDone(item.id, done))
                    }
                  />
                  <span className="checklist-row__tools">
                    <IconButton
                      label={`Remove ${item.title}`}
                      tone="danger"
                      onClick={() => mutate((repos) => repos.goals.removeChecklistItem(item.id))}
                    >
                      <TrashIcon size={15} />
                    </IconButton>
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          <div className="inline-add">
            <TextInput
              value={newItem}
              aria-label={`New checklist item for ${goal.title}`}
              placeholder="Add a checklist item"
              onChange={(e) => setNewItem(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void addChecklistItem();
                }
              }}
            />
            <Button onClick={addChecklistItem} disabled={itemBusy || !newItem.trim()}>
              Add
            </Button>
          </div>

          {actions.length > 0 ? (
            <div>
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
          ) : null}

          {materials.length > 0 ? (
            <div className="stack stack--2">
              <p className="tiny strong dim">Related materials</p>
              {materials.map((material) => (
                <Link key={material.id} className="small truncate" to={`/study/${material.id}`}>
                  {material.title}
                </Link>
              ))}
            </div>
          ) : null}

          {goal.notes ? <p className="small muted wrap-anywhere">{goal.notes}</p> : null}

          <div className="row row--wrap">
            <Select
              aria-label={`Status for ${goal.title}`}
              options={GOAL_STATUS_OPTIONS}
              value={goal.status}
              onChange={(value) => mutate((repos) => repos.goals.update(goal.id, { status: value }))}
              style={{ width: "auto" }}
            />
            <Button size="small" onClick={() => setAddingAction(true)}>
              <PlusIcon size={13} /> Next action
            </Button>
            <Button size="small" onClick={onEdit}>
              Edit
            </Button>
            <Button size="small" variant="danger" className="destructive-action" onClick={() => setConfirmingDelete(true)}>
              Delete
            </Button>
          </div>

          <ActionFormDialog
            open={addingAction}
            relatedType="goal"
            relatedId={goal.id}
            onClose={() => setAddingAction(false)}
            onSave={async (draft: ActionDraft) => {
              const result = await operations.create(draft);
              if (result === null) return;
              setAddingAction(false);
            }}
          />

          <ConfirmDialog
            open={confirmingDelete}
            title="Delete this goal?"
            message="Its checklist is removed. Lessons, materials and journal entries linked to it are kept and simply unlinked."
            onConfirm={() => {
              setConfirmingDelete(false);
              deleteWithUndo({
                // The checklist goes with the goal, so it hides with it too.
                ids: [goal.id, ...checklist.map((item) => item.id)],
                label: goal.title,
                run: (repos) => repos.goals.remove(goal.id),
              });
            }}
            onCancel={() => setConfirmingDelete(false)}
          />
        </div>
      ) : null}
    </article>
  );
}
