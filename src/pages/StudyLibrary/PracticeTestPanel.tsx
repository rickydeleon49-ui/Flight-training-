import { useState } from "react";

import { Badge, Button } from "@/components/ui";
import type { PracticeTest } from "@/domain/types";

/**
 * One saved practice test, taken one question at a time.
 *
 * Keyed by the caller on `practiceTest.updatedAt` (see `MaterialDetail`), so
 * regenerating the test remounts this with fresh state instead of leaving a
 * stale answer selected against a question that no longer exists.
 */
export function PracticeTestPanel({ practiceTest }: { practiceTest: PracticeTest }) {
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [correctCount, setCorrectCount] = useState(0);

  const { questions } = practiceTest;
  const finished = index >= questions.length;
  const question = questions[index];

  const retake = () => {
    setIndex(0);
    setSelected(null);
    setCorrectCount(0);
  };

  if (finished) {
    return (
      <div className="stack stack--3" role="status">
        <p className="eyebrow">Practice test complete</p>
        <h3 className="ai-guide__title">
          {correctCount} of {questions.length} correct
        </h3>
        <div>
          <Button onClick={retake}>Retake this test</Button>
        </div>
      </div>
    );
  }
  // `finished` above already guarantees an in-range index, but TypeScript's
  // array indexing always types the result as possibly `undefined`.
  if (!question) return null;

  const revealed = selected !== null;
  const isCorrect = revealed && selected === question.correctIndex;

  return (
    <div className="stack stack--3" aria-labelledby="practice-test-title">
      <div className="row row--between">
        <h3 id="practice-test-title" className="ai-guide__title">
          Question {index + 1} of {questions.length}
        </h3>
        <Badge tone="study">{question.sourcePage ? `Source p. ${question.sourcePage}` : "Check source"}</Badge>
      </div>

      <p className="small ai-copy">{question.question}</p>

      <div className="stack stack--2" role="radiogroup" aria-label="Answer choices">
        {question.options.map((option, optionIndex) => {
          const isChosen = selected === optionIndex;
          const isTheCorrectAnswer = optionIndex === question.correctIndex;
          let tone: "default" | "correct" | "incorrect" = "default";
          if (revealed && isTheCorrectAnswer) tone = "correct";
          else if (revealed && isChosen) tone = "incorrect";

          return (
            <button
              key={optionIndex}
              type="button"
              role="radio"
              aria-checked={isChosen}
              disabled={revealed}
              className={`practice-option practice-option--${tone}`}
              onClick={() => setSelected(optionIndex)}
            >
              {option}
            </button>
          );
        })}
      </div>

      {revealed ? (
        <div className="stack stack--2">
          <Badge tone={isCorrect ? "complete" : "overdue"}>
            {isCorrect ? "Correct" : "Not quite"}
          </Badge>
          <p className="tiny dim ai-copy">{question.explanation}</p>
          <div>
            <Button
              variant="primary"
              onClick={() => {
                if (isCorrect) setCorrectCount((count) => count + 1);
                setIndex((current) => current + 1);
                setSelected(null);
              }}
            >
              {index + 1 < questions.length ? "Continue" : "See score"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
