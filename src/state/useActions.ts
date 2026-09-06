import { useCallback } from "react";

import { useAppData } from "./AppDataContext";
import { completionChanges, reopenChanges, rescheduleChanges } from "@/logic/actions";
import { nowIso } from "@/lib/dates";
import type { ActionDraft } from "@/components/actions/ActionFormDialog";
import type { Id, NextAction } from "@/domain/types";

/**
 * Next Action operations, shared by every screen that shows actions so the
 * behaviour of completing or rescheduling is defined exactly once.
 */
export function useActionOperations() {
  const { mutate, deleteWithUndo } = useAppData();

  const toggle = useCallback(
    (action: NextAction) =>
      mutate((repos) =>
        repos.actions.update(
          action.id,
          action.status === "completed" ? reopenChanges() : completionChanges(nowIso()),
        ),
      ),
    [mutate],
  );

  const reschedule = useCallback(
    (action: NextAction, date: string) =>
      mutate((repos) => repos.actions.update(action.id, rescheduleChanges(date))),
    [mutate],
  );

  const create = useCallback(
    (draft: ActionDraft) => mutate((repos) => repos.actions.create(draft)),
    [mutate],
  );

  const update = useCallback(
    (id: Id, draft: ActionDraft) => mutate((repos) => repos.actions.update(id, draft)),
    [mutate],
  );

  const remove = useCallback(
    (action: NextAction) =>
      deleteWithUndo({
        ids: [action.id],
        label: action.title,
        run: (repos) => repos.actions.remove(action.id),
      }),
    [deleteWithUndo],
  );

  return { toggle, reschedule, create, update, remove };
}
