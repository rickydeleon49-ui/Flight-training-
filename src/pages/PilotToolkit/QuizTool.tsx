import { useEffect, useRef, useState } from "react";
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog } from "@/components/ui";
import { TOPIC_LABELS, type QuizAttempt } from "@/domain/types";
import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/id";
import { makeQuizAttempt, selectQuizQuestions } from "@/logic/toolkit";
import { useLeaveGuard } from "@/state/leaveGuard";
import { type ToolProps, ReportMetric } from "./toolkitShared";

/** Ask before Exit only once an answer has been given. */
export function quizNeedsLeaveConfirm(answered: number, checkedNow: boolean): boolean {
  return answered > 0 || checkedNow;
}

// Not a valid choice index, so makeQuizAttempt scores it as a miss.
const QUIZ_DONT_KNOW = -1;

export function QuizTool({ state, save, onBusyChange }: ToolProps & { onBusyChange?: (busy: boolean) => void }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<QuizAttempt | null>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (result) resultHeading.current?.focus();
  }, [result]);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<number[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const busy = running && !result && quizNeedsLeaveConfirm(answers.length, checked);
  useLeaveGuard(busy, "Leave this quiz?", "Your answers in this quiz are not kept.");
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);
  const [questions, setQuestions] = useState(() => selectQuizQuestions(Date.now()));
  const question = questions[index]!;
  const best = state.quizAttempts.length
    ? Math.max(...state.quizAttempts.map((item) => item.score / item.total))
    : null;

  const start = () => {
    setQuestions(selectQuizQuestions(Date.now()));
    setResult(null);
    setRunning(true);
    setIndex(0);
    setAnswers([]);
    setSelected(null);
    setChecked(false);
  };
  // A double-click on Finish quiz must not save the attempt twice.
  const finishing = useRef(false);
  const [finishBusy, setFinishBusy] = useState(false);
  const next = async () => {
    if (selected === null || finishing.current) return;
    const nextAnswers = [...answers, selected];
    if (index === questions.length - 1) {
      finishing.current = true;
      setFinishBusy(true);
      const attempt = makeQuizAttempt(nextAnswers, nowIso(), newId(), questions);
      try {
        await save((current) => ({
          ...current,
          quizAttempts: [attempt, ...current.quizAttempts].slice(0, 50),
        }));
      } finally {
        finishing.current = false;
        setFinishBusy(false);
      }
      setResult(attempt);
      setRunning(false);
      return;
    }
    setAnswers(nextAnswers);
    setIndex(index + 1);
    setSelected(null);
    setChecked(false);
  };

  if (!running && result)
    return (
      <Card>
        <CardHeader title="Quiz finished" eyebrow="Knowledge quiz" />
        <CardBody>
          <h3 ref={resultHeading} tabIndex={-1} className="display">
            {result.score} of {result.total} right.
          </h3>
          {result.weakTopics.length ? (
            <p className="small muted">
              Review:{" "}
              {result.weakTopics.map((topic) => TOPIC_LABELS[topic]).join(", ")}
            </p>
          ) : null}
          <Button
            variant="primary"
            className="toolkit-mt-5"
            onClick={() => setResult(null)}
          >
            Try another quiz
          </Button>
        </CardBody>
      </Card>
    );

  if (!running)
    return (
      <div className="toolkit-two-column">
        <Card>
          <CardHeader title="Knowledge quiz" eyebrow="Eight-question review" />
          <CardBody>
            <p className="small muted">
              Practice broad private-pilot knowledge topics and see which areas
              deserve another study session.
            </p>
            <div className="toolkit-hero-metrics toolkit-mt-5">
              <ReportMetric
                label="Attempts"
                value={String(state.quizAttempts.length)}
              />
              <ReportMetric
                label="Best score"
                value={best == null ? "—" : `${Math.round(best * 100)}%`}
              />
            </div>
            <Button
              variant="primary"
              className="toolkit-mt-5"
              onClick={start}
            >
              Start quiz
            </Button>
            <p className="small muted">
              Practice questions in the style of the FAA knowledge test. A study aid; check against FAA guidance and your instructor.
            </p>
          </CardBody>
        </Card>
        <Card variant="grouped">
          <CardHeader title="Recent results" />
          <CardBody>
            {state.quizAttempts.length ? (
              <div className="stack stack--3">
                {state.quizAttempts.slice(0, 6).map((attempt) => (
                  <div key={attempt.id}>
                    <div className="row row--between">
                      <span className="small">
                        {new Date(attempt.date).toLocaleDateString()}
                      </span>
                      <Badge
                        tone={
                          attempt.score / attempt.total >= 0.8
                            ? "complete"
                            : "study"
                        }
                      >
                        {attempt.score}/{attempt.total}
                      </Badge>
                    </div>
                    {attempt.weakTopics.length ? (
                      <p className="tiny dim">
                        Review:{" "}
                        {attempt.weakTopics
                          .map((topic) => TOPIC_LABELS[topic])
                          .join(", ")}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="small muted">
                No knowledge quiz attempts yet. Practice tests on your study
                materials are kept in the Study Library.
              </p>
            )}
          </CardBody>
        </Card>
      </div>
    );

  return (
    <Card variant="grouped">
      <CardHeader
        title={`Question ${index + 1} of ${questions.length}`}
        eyebrow={TOPIC_LABELS[question.topic]}
      />
      <CardBody>
        <div className="quiz">
          <p className="display quiz__prompt">{question.prompt}</p>
          <div role="radiogroup" aria-label="Answer choices" className="stack stack--2">
            {[...question.choices, "I don't know"].map((choice, position) => {
              const choiceIndex = position < question.choices.length ? position : QUIZ_DONT_KNOW;
              return (
                <label
                  key={choice}
                  className={`quiz__choice${selected === choiceIndex ? " is-selected" : ""}${checked && choiceIndex === question.correct ? " is-correct" : ""}${checked && selected === choiceIndex && choiceIndex !== question.correct ? " is-wrong" : ""}`}
                >
                  <input
                    type="radio"
                    name={`quiz-question-${index}`}
                    className="quiz__radio"
                    disabled={checked}
                    checked={selected === choiceIndex}
                    onChange={() => setSelected(choiceIndex)}
                  />
                  {choice}
                </label>
              );
            })}
          </div>
          {checked ? (
            <p className="quiz__explanation small">
              {selected === question.correct
                ? "Correct. "
                : selected === QUIZ_DONT_KNOW
                  ? `No problem, here is the answer: ${question.choices[question.correct]}. `
                  : `Not quite. The correct answer is: ${question.choices[question.correct]}. `}
              {question.explanation}
            </p>
          ) : null}
          <div className="row">
            {!checked ? (
              <Button
                variant="primary"
                disabled={selected === null}
                onClick={() => setChecked(true)}
              >
                Check answer
              </Button>
            ) : (
              <Button variant="primary" onClick={() => void next()} disabled={finishBusy}>
                {finishBusy
                  ? "Saving…"
                  : index === questions.length - 1
                  ? "Finish quiz"
                  : "Next question"}
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={() => (quizNeedsLeaveConfirm(answers.length, checked) ? setLeaving(true) : setRunning(false))}
            >
              Exit
            </Button>
          </div>
          <ConfirmDialog
            open={leaving}
            title="Leave this quiz?"
            message="Your answers in this quiz are not kept."
            confirmLabel="Leave"
            cancelLabel="Keep going"
            destructive={true}
            onConfirm={() => {
              setLeaving(false);
              setRunning(false);
            }}
            onCancel={() => setLeaving(false)}
          />
        </div>
      </CardBody>
    </Card>
  );
}
