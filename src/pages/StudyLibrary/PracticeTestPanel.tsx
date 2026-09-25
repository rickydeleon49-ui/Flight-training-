import { useEffect, useRef, useState } from "react";

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
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const actionButtonRef = useRef<HTMLButtonElement | null>(null);

  const { questions } = practiceTest;
  const finished = index >= questions.length;
  const question = questions[index];

  useEffect(() => {
    if (selected !== null && !finished) {
      actionButtonRef.current?.focus();
    }
  }, [selected, finished]);

  useEffect(() => {
    if (index > 0 && !finished) {
      optionRefs.current[0]?.focus();
    }
  }, [index, finished]);

  const retake = () => {
    setIndex(0);
    setSelected(null);
    setFocusedIndex(0);
    setCorrectCount(0);
    setTimeout(() => optionRefs.current[0]?.focus(), 0);
  };

  const handleContinue = () => {
    if (isCorrect) setCorrectCount((count) => count + 1);
    setIndex((current) => current + 1);
    setSelected(null);
    setFocusedIndex(0);
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

  const handleKeyDown = (e: React.KeyboardEvent, optionIndex: number) => {
    if (revealed) return;
    const optionCount = question.options.length;
    let nextIndex: number | null = null;

    switch (e.key) {
      case "ArrowDown":
      case "ArrowRight":
        e.preventDefault();
        nextIndex = (optionIndex + 1) % optionCount;
        break;
      case "ArrowUp":
      case "ArrowLeft":
        e.preventDefault();
        nextIndex = (optionIndex - 1 + optionCount) % optionCount;
        break;
      case "Home":
        e.preventDefault();
        nextIndex = 0;
        break;
      case "End":
        e.preventDefault();
        nextIndex = optionCount - 1;
        break;
      case "Enter":
      case " ":
      case "Spacebar":
        e.preventDefault();
        setFocusedIndex(optionIndex);
        setSelected(optionIndex);
        return;
    }

    if (nextIndex !== null) {
      setFocusedIndex(nextIndex);
      optionRefs.current[nextIndex]?.focus();
    }
  };

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
          let ariaLabel = option;
          if (revealed) {
            if (isTheCorrectAnswer) {
              tone = "correct";
              ariaLabel = `${option} (Correct answer)`;
            } else if (isChosen) {
              tone = "incorrect";
              ariaLabel = `${option} (Your answer, incorrect)`;
            }
          }

          const tabIndex = revealed ? -1 : optionIndex === focusedIndex ? 0 : -1;

          return (
            <button
              key={optionIndex}
              ref={(el) => {
                optionRefs.current[optionIndex] = el;
              }}
              type="button"
              role="radio"
              aria-checked={isChosen}
              aria-label={ariaLabel}
              tabIndex={tabIndex}
              disabled={revealed}
              className={`practice-option practice-option--${tone}`}
              onClick={() => {
                setFocusedIndex(optionIndex);
                setSelected(optionIndex);
              }}
              onFocus={() => setFocusedIndex(optionIndex)}
              onKeyDown={(e) => handleKeyDown(e, optionIndex)}
            >
              {option}
            </button>
          );
        })}
      </div>

      {revealed ? (
        <div className="stack stack--2" role="region" aria-live="polite" aria-label="Question result">
          <Badge tone={isCorrect ? "complete" : "overdue"}>
            {isCorrect ? "Correct" : "Not quite"}
          </Badge>
          <p className="tiny dim ai-copy">{question.explanation}</p>
          <div>
            <Button ref={actionButtonRef} variant="primary" onClick={handleContinue}>
              {index + 1 < questions.length ? "Continue" : "See score"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
