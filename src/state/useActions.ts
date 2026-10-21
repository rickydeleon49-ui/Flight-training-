import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { homeworkActionTarget } from "@/logic/actions";

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
  const { data, mutate, deleteWithUndo } = useAppData();
  const navigate = useNavigate();

  const toggle = useCallback(
    (action: NextAction) => {
      const target = homeworkActionTarget(action.id, data.homework);
      if (target) { navigate(target); return Promise.resolve(undefined); }
      return mutate((repos) =>
        repos.actions.update(
          action.id,
          action.status === "completed" ? reopenChanges() : completionChanges(nowIso()),
        ),
      );
    },
    [mutate, data.homework, navigate],
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
