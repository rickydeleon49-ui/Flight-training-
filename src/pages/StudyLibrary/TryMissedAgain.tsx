import { useCallback, useState } from "react";
import { Button, ConfirmDialog, Dialog } from "@/components/ui";
import { useLeaveGuard } from "@/state/leaveGuard";
import type { PracticeAttempt, PracticeResponse, PracticeTestItem } from "@/domain/types";
import { missedAgainQuestions, type MixedQuestion } from "@/logic/mixedPractice";
import { QuickQuestionRun } from "./QuickQuestionRun";

/**
 * MISSED-AGAIN-01: after a finished test, a quick untimed retry of just the
 * questions the student got wrong or marked "don't know". Nothing is saved: the
 * attempt, its history and its score stay exactly as they were.
 */
export function TryMissedAgain({ attempt, items, responses, materialTitle, primary = false }: {
  attempt: Pick<PracticeAttempt, "id" | "sourceMaterialId">;
  items: readonly PracticeTestItem[];
  responses: readonly PracticeResponse[];
  materialTitle: string;
  /** The one filled button of a results screen: "Review N missed questions". */
  primary?: boolean;
}) {
  const [run, setRun] = useState<MixedQuestion[] | null>(null);
  const [progress, setProgress] = useState({ started: false, finished: false });
  const [leaving, setLeaving] = useState(false);
  const onProgress = useCallback((started: boolean, finished: boolean) => setProgress({ started, finished }), []);
  useLeaveGuard(Boolean(run && progress.started && !progress.finished), "Leave this test?", "Your answers in this try are not kept.");
  const missed = missedAgainQuestions(attempt.id, items, responses, attempt.sourceMaterialId ?? "", materialTitle);
  if (missed.length === 0) return null;
  const close = () => { setRun(null); setProgress({ started: false, finished: false }); setLeaving(false); };
  const requestClose = () => { if (run && progress.started && !progress.finished) setLeaving(true); else close(); };

  return <>
    <div className="row row--wrap row--gap-2">
      <Button variant={primary ? "primary" : "secondary"} onClick={() => setRun(missed)}>
        {primary ? `Review ${missed.length} missed questions` : `Try the ${missed.length} you missed again`}
      </Button>
    </div>
    {run ? <Dialog open title="Try them again" onClose={requestClose}>
      <div className="stack stack--3">
        <p className="tiny dim">No timer. This try is not saved, and your test result stays as it is.</p>
        <QuickQuestionRun questions={run} resultLabel="Try again result" onDone={close} onProgress={onProgress} />
        <p className="tiny dim">Study aid — check it against FAA guidance and your instructor.</p>
      </div>
    </Dialog> : null}
    <ConfirmDialog open={leaving} title="Leave this test?" message="Your answers in this try are not kept."
      confirmLabel="Leave" cancelLabel="Keep going" destructive={true}
      onConfirm={close} onCancel={() => setLeaving(false)} />
  </>;
}
