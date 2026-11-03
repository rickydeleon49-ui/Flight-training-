import { useState } from "react";
import { Button, Dialog } from "@/components/ui";
import type { PracticeTest, StudyMaterial } from "@/domain/types";
import {
  buildMixedTest,
  MIXED_MIN_MATERIALS,
  mixedChoices,
  type MixedQuestion,
} from "@/logic/mixedPractice";
import { QuickQuestionRun } from "./QuickQuestionRun";

/**
 * One untimed practice test mixed from several of her own materials. It reuses
 * the saved questions as they are, and nothing is stored: the result is for today only.
 */
export function MixedPracticeTest({ practiceTests, materials }: {
  practiceTests: readonly PracticeTest[];
  materials: readonly StudyMaterial[];
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [run, setRun] = useState<MixedQuestion[] | null>(null);
  const choices = mixedChoices(practiceTests, materials);
  const close = () => { setOpen(false); setPicked([]); setRun(null); };

  return <>
    <Button variant="secondary" onClick={() => setOpen(true)}>Mixed practice test</Button>
    {open ? <Dialog open title="Mixed practice test" onClose={close}>
      <div className="stack stack--3">
        {!run ? <>
          {choices.length >= MIXED_MIN_MATERIALS ? <>
            <p className="small">Pick at least two materials. You get up to 20 questions from them, with no timer.</p>
            <fieldset className="stack stack--2">
              <legend className="tiny dim">Materials with practice questions</legend>
              {choices.map((choice) => <label key={choice.materialId} className="small">
                <input type="checkbox" checked={picked.includes(choice.materialId)}
                  onChange={(event) => setPicked(event.target.checked
                    ? [...picked, choice.materialId] : picked.filter((id) => id !== choice.materialId))} />
                {" "}{choice.title} · {choice.questionCount} {choice.questionCount === 1 ? "question" : "questions"}
              </label>)}
            </fieldset>
            <Button disabled={picked.length < MIXED_MIN_MATERIALS} onClick={() => {
              setRun(buildMixedTest(practiceTests, materials, picked));
            }}>Start mixed test</Button>
            {picked.length < MIXED_MIN_MATERIALS ? <p className="tiny dim">Choose {MIXED_MIN_MATERIALS - picked.length} more to start.</p> : null}
          </> : <p>Mixed practice needs at least two materials that already have practice questions.</p>}
        </> : null}
        {run ? <QuickQuestionRun questions={run} resultLabel="Mixed practice result" onDone={close} /> : null}
        <p className="tiny dim">Study aid — check it against FAA guidance and your instructor.</p>
      </div>
    </Dialog> : null}
  </>;
}
