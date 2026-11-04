import { useState } from "react";
import { Button, Dialog } from "@/components/ui";
import type { PracticeAttempt, PracticeResponse, PracticeTestItem } from "@/domain/types";
import { missedAgainQuestions, type MixedQuestion } from "@/logic/mixedPractice";
import { QuickQuestionRun } from "./QuickQuestionRun";

/**
 * MISSED-AGAIN-01: after a finished test, a quick untimed retry of just the
 * questions the student got wrong or marked "don't know". Nothing is saved: the
 * attempt, its history and its score stay exactly as they were.
 */
export function TryMissedAgain({ attempt, items, responses, materialTitle }: {
  attempt: PracticeAttempt;
  items: readonly PracticeTestItem[];
  responses: readonly PracticeResponse[];
  materialTitle: string;
}) {
  const [run, setRun] = useState<MixedQuestion[] | null>(null);
  const missed = missedAgainQuestions(attempt.id, items, responses, attempt.sourceMaterialId ?? "", materialTitle);
  if (missed.length === 0) return null;
  const close = () => setRun(null);

  return <>
    <div className="row row--wrap row--gap-2">
      <Button variant="secondary" onClick={() => setRun(missed)}>
        Try the {missed.length} you missed again
      </Button>
    </div>
    {run ? <Dialog open title="Try them again" onClose={close}>
      <div className="stack stack--3">
        <p className="tiny dim">No timer. This try is not saved, and your test result stays as it is.</p>
        <QuickQuestionRun questions={run} resultLabel="Try again result" onDone={close} />
        <p className="tiny dim">Study aid — check it against FAA guidance and your instructor.</p>
      </div>
    </Dialog> : null}
  </>;
}
