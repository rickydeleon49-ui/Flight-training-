import { useEffect, useRef, useState } from "react";
import { Button, Dialog } from "@/components/ui";
import type { PracticeQuestion, PracticeTest, StudyMaterial } from "@/domain/types";
import { ACS_TASK_CATALOG } from "@/logic/acsTaskCatalog";
import { AcsTaskChip } from "./AcsTaskChip";

type DrillQuestion = { question: PracticeQuestion; materialTitle: string };

export function CheckrideTopicPractice({ practiceTests, materials }: {
  practiceTests: readonly PracticeTest[];
  materials: readonly StudyMaterial[];
}) {
  const [open, setOpen] = useState(false);
  const [drill, setDrill] = useState<DrillQuestion[] | null>(null);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState<number | null>(null);
  const nextButton = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const topics = ACS_TASK_CATALOG.map((task) => ({ ...task,
    questions: practiceTests.flatMap((test) => {
      const material = materials.find((entry) => entry.id === test.sourceMaterialId);
      return material ? test.questions.filter((question) => question.acsTask === task.code)
        .map((question) => ({ question, materialTitle: material.title })) : [];
    }),
  })).filter((task) => task.questions.length > 0);
  const close = () => { setOpen(false); setDrill(null); setIndex(0); setAnswer(null); };
  const next = () => {
    if (!drill || answer === null) return;
    if (index + 1 === drill.length) close();
    else { setIndex(index + 1); setAnswer(null); }
  };
  useEffect(() => { if (drill) heading.current?.focus(); }, [drill, index]);
  useEffect(() => { if (answer !== null) nextButton.current?.focus(); }, [answer]);
  const current = drill?.[index];
  const question = current?.question;

  return <>
    <Button variant="secondary" onClick={() => setOpen(true)}>Practice by checkride topic</Button>
    {open ? <Dialog open title="Practice by checkride topic" onClose={close}>
      <div className="stack stack--3" onKeyDown={(event) => {
        if (!question || event.altKey || event.ctrlKey || event.metaKey || event.repeat ||
          (event.target instanceof Element && event.target.closest("details"))) return;
        if (/^[1-3]$/.test(event.key) && answer === null) {
          const chosen = Number(event.key) - 1;
          if (chosen < question.options.length) { event.preventDefault(); setAnswer(chosen); }
        } else if (event.key === "Enter" && answer !== null) {
          event.preventDefault(); next();
        }
      }}>
        {!drill ? topics.length ? topics.map((task) => <Button key={task.code} variant="secondary" onClick={() => {
          setDrill(task.questions); setIndex(0); setAnswer(null);
        }}>{task.code} · {task.title} · {task.questions.length} {task.questions.length === 1 ? "question" : "questions"}</Button>) :
          <p>New practice tests made from a PDF will be grouped by checkride topic.</p> : null}
        {question && current ? <>
          <h3 ref={heading} tabIndex={-1} className="ai-guide__title">Question {index + 1} of {drill!.length}</h3>
          <AcsTaskChip code={question.acsTask} showSources />
          <p className="small ai-copy">{question.question}</p>
          <p className="tiny dim">Use 1–3 to choose an answer, then Enter for the next question.</p>
          <div className="stack stack--2" role="group" aria-label="Answer choices">
            {question.options.map((option, optionIndex) => <button key={optionIndex} type="button"
              className={`practice-option practice-option--${answer === null ? "default" : optionIndex === question.correctIndex ? "correct" : optionIndex === answer ? "incorrect" : "default"}`}
              aria-pressed={answer === optionIndex} disabled={answer !== null}
              onClick={() => setAnswer(optionIndex)}>{optionIndex + 1}. {option}</button>)}
          </div>
          {answer !== null ? <div className="stack stack--2" role="status">
            <p>{answer === question.correctIndex ? "Correct" : "Incorrect"}. Correct answer: {question.options[question.correctIndex]}</p>
            <p className="small ai-copy">{question.explanation}</p>
            <p className="tiny">Source: {current.materialTitle}{question.sourcePage !== null ? ` · Page ${question.sourcePage}` : ""}</p>
            <Button ref={nextButton} onClick={next}>{index + 1 < drill!.length ? "Next" : "Done"}</Button>
          </div> : null}
          <p className="tiny dim">Study aid — check it against FAA guidance and your instructor.</p>
        </> : null}
      </div>
    </Dialog> : null}
  </>;
}
