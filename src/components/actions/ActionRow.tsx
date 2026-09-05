import { Badge, Checkbox, ClockIcon, EditIcon, IconButton, TrashIcon } from "@/components/ui";
import { describeRelativeDate, formatDuration, todayIso } from "@/lib/dates";
import { isOverdue } from "@/logic/actions";
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
  const overdue = isOverdue(action, today);
  const dueToday = action.status === "open" && action.dueDate === today;
  const duration = formatDuration(action.estimatedMinutes);

  const meta = (
    <span className="action-row__meta">
      {overdue ? (
        <Badge tone="overdue">{describeRelativeDate(action.dueDate as string, today)}</Badge>
      ) : dueToday ? (
        <Badge tone="due">Today</Badge>
      ) : action.dueDate ? (
        <span>{describeRelativeDate(action.dueDate, today)}</span>
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
          <IconButton label={`Delete ${action.title}`} tone="danger" onClick={() => onDelete(action)}>
            <TrashIcon size={16} />
          </IconButton>
        ) : null}
      </div>
    </div>
  );
}
