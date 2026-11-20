import { useEffect, useRef, useState } from "react";
import { Badge, Button } from "@/components/ui";
import { FigureViewer } from "@/components/FigureViewer";
import { getFigure, type FaaFigure } from "@/logic/figures";
import type { MixedQuestion } from "@/logic/mixedPractice";

/**
 * An untimed run through a fixed list of the student's own saved questions. Each answer
 * shows the correct one, the explanation and the source page; the result is
 * for today only. Nothing here reads or writes the database: the caller owns
 * the questions and gets `onDone` when the student closes the result.
 */
export function QuickQuestionRun({ questions, resultLabel, onDone, onProgress, onFinished, resolveFigure }: {
  questions: readonly MixedQuestion[];
  /** Accessible name of the result section. */
  resultLabel: string;
  onDone: () => void;
  /** Tells the caller whether an answer has been given and whether the result is showing. */
  onProgress?: (started: boolean, finished: boolean) => void;
  /** Called once when the run ends, with the questions answered wrong. */
  onFinished?: (missed: MixedQuestion[]) => void;
  /** Finds a question's figure (and an optional image source, e.g. from a downloaded pack). Defaults to the bundled figures. */
  resolveFigure?: (id: string) => { figure: FaaFigure; src?: string } | undefined;
}) {
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState<number | null>(null);
  const [answers, setAnswers] = useState<number[]>([]);
  const heading = useRef<HTMLHeadingElement>(null);

  const finished = answers.length === questions.length;
  const started = answer !== null || answers.length > 0;
  useEffect(() => { onProgress?.(started, finished); }, [started, finished, onProgress]);
  useEffect(() => { heading.current?.focus(); }, [index, finished]);
  const finishedSent = useRef(false);
  useEffect(() => {
    if (!finished || finishedSent.current) return;
    finishedSent.current = true;
    onFinished?.(questions.filter((item, i) => answers[i] !== item.question.correctIndex));
  }, [finished, onFinished, questions, answers]);

  const next = () => {
    if (answer === null) return;
    setAnswers([...answers, answer]); setAnswer(null);
    if (index + 1 < questions.length) setIndex(index + 1);
  };
  const current = !finished ? questions[index] : undefined;
  const question = current?.question;
  const correct = questions.filter((item, i) => answers[i] === item.question.correctIndex).length;
  const total = questions.length;
  const percent = total ? Math.round((correct / total) * 100) : 0;

  const resolved: { figure: FaaFigure; src?: string } | undefined = question?.figureId
    ? (resolveFigure ? resolveFigure(question.figureId) : (() => { const f = getFigure(question.figureId!); return f ? { figure: f } : undefined; })())
    : undefined;
  const figure = resolved?.figure;
  const body = question && current ? <>
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
    </> : null;

  return <>
    {figure ? <div className="figure-run figure-run--question-first">
      <div className="figure-run__question stack stack--2">{body}</div>
      <FigureViewer key={figure.id} figure={figure} src={resolved?.src} questionFirst />
    </div> : body}
    {finished ? <section className="stack stack--2" aria-label={resultLabel}>
      <h3 ref={heading} tabIndex={-1} className="ai-guide__title">{correct} of {total} correct</h3>
      <div className="row">
        <Badge tone="complete">{correct} correct</Badge>
        <Badge tone="overdue">{total - correct} incorrect</Badge>
      </div>
      <p className="tiny dim">{`Practice result from your materials (${percent}%). Not an official FAA knowledge test score or certification of flight readiness. This result is for today only and is not saved.`}</p>
      {questions.some((item, i) => answers[i] !== item.question.correctIndex) ? <>
        <p className="small">Review these:</p>
        <ul className="stack stack--2">
          {questions.map((item, i) => answers[i] === item.question.correctIndex ? null : <li key={i} className="small">
            {item.question.question} <span className="tiny dim">({item.materialTitle})</span>
            <br />Correct answer: {item.question.options[item.question.correctIndex]}
          </li>)}
        </ul>
      </> : null}
      <Button onClick={onDone}>Done</Button>
    </section> : null}
  </>;
}
