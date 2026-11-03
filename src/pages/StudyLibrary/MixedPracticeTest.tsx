import { useEffect, useRef, useState } from "react";
import { Badge, Button, Dialog } from "@/components/ui";
import type { PracticeTest, StudyMaterial } from "@/domain/types";
import {
  buildMixedTest,
  MIXED_MIN_MATERIALS,
  mixedChoices,
  type MixedQuestion,
} from "@/logic/mixedPractice";

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
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState<number | null>(null);
  const [answers, setAnswers] = useState<number[]>([]);
  const heading = useRef<HTMLHeadingElement>(null);
  const choices = mixedChoices(practiceTests, materials);
  const close = () => { setOpen(false); setPicked([]); setRun(null); setIndex(0); setAnswer(null); setAnswers([]); };
  useEffect(() => { if (run) heading.current?.focus(); }, [run, index]);

  const finished = run !== null && answers.length === run.length;
  const next = () => {
    if (!run || answer === null) return;
    setAnswers([...answers, answer]); setAnswer(null);
    if (index + 1 < run.length) setIndex(index + 1);
  };
  const current = run && !finished ? run[index] : undefined;
  const question = current?.question;
  const correct = run ? run.filter((item, i) => answers[i] === item.question.correctIndex).length : 0;
  const total = run?.length ?? 0;
  const percent = total ? Math.round((correct / total) * 100) : 0;

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
              setRun(buildMixedTest(practiceTests, materials, picked)); setIndex(0); setAnswer(null); setAnswers([]);
            }}>Start mixed test</Button>
            {picked.length < MIXED_MIN_MATERIALS ? <p className="tiny dim">Choose {MIXED_MIN_MATERIALS - picked.length} more to start.</p> : null}
          </> : <p>Mixed practice needs at least two materials that already have practice questions.</p>}
        </> : null}
        {question && current ? <>
          <h3 ref={heading} tabIndex={-1} className="ai-guide__title">Question {index + 1} of {total}</h3>
          <p className="small ai-copy">{question.question}</p>
          <div className="stack stack--2" role="group" aria-label="Answer choices">
            {question.options.map((option, i) => <button key={i} type="button"
              className={`practice-option practice-option--${answer === null ? "default" : i === question.correctIndex ? "correct" : i === answer ? "incorrect" : "default"}`}
              aria-pressed={answer === i} disabled={answer !== null}
              onClick={() => setAnswer(i)}>{i + 1}. {option}</button>)}
          </div>
          {answer !== null ? <div className="stack stack--2" role="status">
            <p>{answer === question.correctIndex ? "Correct" : "Incorrect"}. Correct answer: {question.options[question.correctIndex]}</p>
            <p className="small ai-copy">{question.explanation}</p>
            <p className="tiny">Source: {current.materialTitle}{question.sourcePage !== null ? ` · Page ${question.sourcePage}` : ""}</p>
            <Button onClick={next}>{index + 1 < total ? "Continue" : "See score"}</Button>
          </div> : null}
        </> : null}
        {finished && run ? <section className="stack stack--2" aria-label="Mixed practice result">
          <h3 ref={heading} tabIndex={-1} className="ai-guide__title">{correct} of {total} correct</h3>
          <div className="row">
            <Badge tone="complete">{correct} correct</Badge>
            <Badge tone="overdue">{total - correct} incorrect</Badge>
          </div>
          <p className="tiny dim">{`Practice result from your materials (${percent}%). Not an official FAA knowledge test score or certification of flight readiness. This result is for today only and is not saved.`}</p>
          {run.some((item, i) => answers[i] !== item.question.correctIndex) ? <>
            <p className="small">Review these:</p>
            <ul className="stack stack--2">
              {run.map((item, i) => answers[i] === item.question.correctIndex ? null : <li key={i} className="small">
                {item.question.question} <span className="tiny dim">({item.materialTitle})</span>
                <br />Correct answer: {item.question.options[item.question.correctIndex]}
              </li>)}
            </ul>
          </> : null}
          <Button onClick={close}>Done</Button>
        </section> : null}
        <p className="tiny dim">Study aid — check it against FAA guidance and your instructor.</p>
      </div>
    </Dialog> : null}
  </>;
}
