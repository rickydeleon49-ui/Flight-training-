import { useState } from "react";
import { Button } from "@/components/ui";
import { FigureViewer } from "@/components/FigureViewer";
import type { MockTestRun as Run } from "@/domain/types";
import { getFigure } from "@/logic/figures";
import { answerKey, scoreMock, type MockQuestion } from "@/logic/mockTest";
import "./MockTest.css";

type Filter = "missed" | "flagged" | "all";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "missed", label: "Missed" }, { key: "flagged", label: "Flagged" }, { key: "all", label: "All" },
];
const EMPTY: Record<Filter, string> = {
  missed: "No missed questions in this test.",
  flagged: "No flagged questions in this test.",
  all: "No questions to show for this test.",
};

/** Look back over a finished mock: filter to missed, flagged or all questions. */
export function MockTestReview({ run, questions, onBack }: {
  run: Run;
  questions: readonly MockQuestion[];
  onBack: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("missed");
  const byId = new Map(questions.map((q) => [q.id, q]));
  const missed = new Set(scoreMock(run, questions).missedIds);
  const flagged = new Set(run.flags);
  const shown = run.questionIds.flatMap((id, i) => {
    const item = byId.get(id);
    if (!item) return [];
    if (filter === "missed" && !missed.has(id)) return [];
    if (filter === "flagged" && !flagged.has(id)) return [];
    return [{ item, number: i + 1 }];
  });
  return <div className="stack stack--3 mock-review">
    <h3>Review questions</h3>
    <div className="row row--wrap" role="group" aria-label="Show questions">
      {FILTERS.map((f) => <Button key={f.key} variant="secondary" aria-pressed={filter === f.key}
        onClick={() => setFilter(f.key)}>{f.label}</Button>)}
    </div>
    {shown.length === 0 ? <p className="small muted" role="status">{EMPTY[filter]}</p> : <ul className="stack stack--3">
      {shown.map(({ item, number }) => {
        const chosen = run.answers[item.id];
        const index = chosen === undefined ? -1 : Number(chosen);
        const mine = item.question.options[index];
        const right = item.question.options[item.question.correctIndex];
        const figure = item.question.figureId ? getFigure(item.question.figureId) : undefined;
        const hit = chosen === answerKey(item.question.correctIndex);
        return <li key={item.id} className="stack stack--1">
          <p className="small"><strong>Question {number}</strong>{flagged.has(item.id) ? " · Flagged" : ""} · {hit ? "Correct" : chosen === undefined ? "Missed (not answered)" : "Missed"}</p>
          <p className="small ai-copy">{item.question.question}</p>
          {figure ? <FigureViewer figure={figure} /> : null}
          <p className="small">Your answer: {mine ?? "Not answered"}</p>
          <p className="small">Right answer: {right}</p>
          {item.question.explanation ? <p className="tiny muted">{item.question.explanation}</p> : null}
        </li>;
      })}
    </ul>}
    <Button onClick={onBack}>Back to results</Button>
  </div>;
}
