import { Link } from "react-router-dom";
import { Badge, Checkbox, ClockIcon, EditIcon, IconButton, TrashIcon } from "@/components/ui";
import { formatDuration, todayIso } from "@/lib/dates";
import { actionTiming, isOverdue } from "@/logic/actions";
import { useAppData } from "@/state/AppDataContext";
import type { NextAction } from "@/domain/types";

import "./actions.css";

interface ActionRowProps {
  action: NextAction;
  today?: string;
  onToggle: (action: NextAction) => void;
  onEdit?: (action: NextAction) => void;
  onReschedule?: (action: NextAction) => void;
  onDelete?: (action: NextAction) => void;
  /** Extra context, e.g. the lesson an action belongs to. */
  context?: string;
}

/**
 * One Next Action. Used on the dashboard and on every detail screen, so an
 * action looks and behaves the same wherever it appears.
 */
export function ActionRow({
  action,
  today = todayIso(),
  onToggle,
  onEdit,
  onReschedule,
  onDelete,
  context,
}: ActionRowProps) {
  const { data } = useAppData();
  const boundHw = data.homework?.find(h => h.assignment.action_id === action.id && !h.assignment.archived);
  const overdue = isOverdue(action, today);
  const timing = actionTiming(action, today);
  const duration = formatDuration(action.estimatedMinutes);

  const timingText = boundHw
    ? (timing?.tone === "overdue" ? "Homework overdue" : timing?.tone === "due" ? "Homework due" : timing?.text)
    : timing?.text;

  const meta = (
    <span className="action-row__meta">
      {timing?.tone === "overdue" ? (
        <Badge tone="overdue">{timingText}</Badge>
      ) : timing?.tone === "due" ? (
        <Badge tone="due">{timingText}</Badge>
      ) : timing?.tone === "done" ? (
        <Badge tone="complete">{timingText}</Badge>
      ) : timing ? (
        <span>{timingText}</span>
      ) : null}
      {duration ? (
        <span className="row" style={{ gap: 4 }}>
          <ClockIcon size={13} />
          {duration}
        </span>
      ) : null}
      {context ? <span className="truncate">{context}</span> : null}
      {action.description ? (
        <span className="truncate" title={action.description}>
          {action.description}
        </span>
      ) : null}
    </span>
  );

  if (boundHw) {
    return (
      <div className={`action-row${overdue ? " action-row--overdue" : ""}`}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
          <span className="strong wrap-anywhere">{action.title}</span>
          {meta}
        </div>
        <div className="action-row__tools">
          <Link
            className="button button--secondary button--small"
            to={`/study/homework/${boundHw.assignment.id}`}
          >
            Open homework
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={`action-row${overdue ? " action-row--overdue" : ""}`}>
      <Checkbox
        checked={action.status === "completed"}
        onChange={() => onToggle(action)}
        label={<span className="wrap-anywhere">{action.title}</span>}
        meta={meta}
      />

      <div className="action-row__tools">
        {onReschedule ? (
          <IconButton label={`Reschedule ${action.title}`} onClick={() => onReschedule(action)}>
            <ClockIcon size={16} />
          </IconButton>
        ) : null}
        {onEdit ? (
          <IconButton label={`Edit ${action.title}`} onClick={() => onEdit(action)}>
            <EditIcon size={16} />
          </IconButton>
        ) : null}
        {onDelete ? (
          <IconButton className="destructive-action" label={`Delete ${action.title}`} tone="danger" onClick={() => onDelete(action)}>
            <TrashIcon size={16} />
          </IconButton>
        ) : null}
      </div>
    </div>
  );
}
