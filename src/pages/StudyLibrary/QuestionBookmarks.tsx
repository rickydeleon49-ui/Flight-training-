import type { PracticeTest, QuestionBookmark, StudyMaterial } from "@/domain/types";
import { Button } from "@/components/ui";
import { buildMockTest } from "@/logic/mockTest";
import "./MockTest.css";

/** Bookmarked questions found in the current bank, with Remove; lost ones can be cleared together. */
export function QuestionBookmarks({ practiceTests, materials, bookmarks, onChange }: {
  practiceTests: readonly PracticeTest[];
  materials: readonly StudyMaterial[];
  bookmarks: readonly QuestionBookmark[];
  onChange: (list: QuestionBookmark[]) => void;
}) {
  const bank = new Map(buildMockTest(practiceTests, materials, () => 0.5, Number.POSITIVE_INFINITY)
    .map((q) => [`${q.materialId}\u0000${q.id}`, q]));
  const found = bookmarks.flatMap((b) => {
    const item = bank.get(`${b.materialId}\u0000${b.questionId}`);
    return item ? [{ b, item }] : [];
  });
  const lost = bookmarks.length - found.length;
  const without = (b: QuestionBookmark) => bookmarks.filter((x) => x !== b);
  if (bookmarks.length === 0) return <p className="small muted">No bookmarked questions yet. Use Bookmark during a mock test to save one.</p>;
  return <div className="stack stack--3 question-bookmarks">
    {found.length ? <ul className="stack stack--3">
      {found.map(({ b, item }) => <li key={`${b.materialId}:${b.questionId}`} className="stack stack--1">
        <p className="small ai-copy">{item.question.question}</p>
        <p className="small">Right answer: {item.question.options[item.question.correctIndex]}</p>
        {item.question.explanation ? <p className="tiny muted">{item.question.explanation}</p> : null}
        <p className="tiny muted">From: {item.materialTitle}</p>
        <div><Button variant="secondary" onClick={() => onChange(without(b))}>Remove</Button></div>
      </li>)}
    </ul> : null}
    {lost > 0 ? <p className="tiny muted">
      {lost} bookmarked {lost === 1 ? "question is" : "questions are"} no longer in your study packs.{" "}
      <Button variant="secondary" onClick={() => onChange(found.map((f) => f.b))}>Remove them</Button>
    </p> : null}
  </div>;
}
