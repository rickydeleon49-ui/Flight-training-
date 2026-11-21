import { Button, Card } from "@/components/ui";
import { nextLocalMidnightUtc } from "@/logic/localDay";
import { reviewButtonLabel, reviewStatusLine } from "@/logic/cardReviewStatus";
import { summarizeCards, type CardReviewController } from "./useCardReview";

/** Top of the Study tab: a numbered "Start here" path with one primary button. */
export function StudyActionsList({ review, hasGuide, guideReachable, hasCards, cardsReachable, questionCount, pausedPractice = false, onReview, onJump }: {
  review: CardReviewController; hasGuide: boolean; guideReachable: boolean; hasCards: boolean; cardsReachable: boolean;
  questionCount: number; pausedPractice?: boolean; onReview: () => void; onJump: (id: string) => void;
}) {
  const { read, clock } = review;
  let due = 0;
  let fresh = 0;
  let started = 0;
  if (read.phase === "ready" && read.snapshot.current.status === "ok") {
    const now = clock.now();
    const summary = summarizeCards(read.snapshot, now, nextLocalMidnightUtc(now, clock.timeZone()));
    due = summary.dueNow; fresh = summary.newCount; started = summary.startedCount;
  }
  const ready = due + fresh > 0;
  // The one primary button goes on the first step that has something to open.
  const primary = hasGuide ? "guide" : hasCards ? "cards" : questionCount > 0 ? "test" : "oral";
  const variant = (step: string) => (step === primary ? "primary" : "secondary") as "primary" | "secondary";
  const rows = [
    <div key="guide"><p className="study-actions__title">Read your study guide</p>
      <p className="small muted">{hasGuide ? "Read it a section at a time" : "No study guide yet"}</p></div>,
    <div key="cards"><p className="study-actions__title">Practice the flashcards</p>
      <p className="small muted">{!hasCards ? "No flashcards yet" : ready ? reviewStatusLine(due, fresh) : "Nothing due"}</p></div>,
    <div key="test"><p className="study-actions__title">Try the practice test</p>
      <p className="small muted">{questionCount > 0 ? `${questionCount} question${questionCount === 1 ? "" : "s"}` : "No practice questions yet"}</p></div>,
    <div key="oral"><p className="study-actions__title">Practice an oral question</p>
      <p className="small muted">Say it out loud</p></div>,
  ];
  const buttons = [
    guideReachable
      ? <Button variant={variant("guide")} aria-label={hasGuide ? "Study guide: Start" : "Study guide: Open"} onClick={() => onJump("material-study-guide")}>{hasGuide ? "Start" : "Open"}</Button>
      : null,
    !cardsReachable ? null : hasCards && ready
      ? <Button variant={variant("cards")} aria-label={`Flashcards: ${reviewButtonLabel(due, fresh, started)}`} onClick={onReview}>{reviewButtonLabel(due, fresh, started)}</Button>
      : <Button variant="secondary" aria-label="Flashcards: Open" onClick={() => onJump("material-flashcards")}>Open</Button>,
    questionCount > 0
      ? <Button variant={variant("test")} onClick={() => onJump("material-practice-test")}>{pausedPractice ? "Continue" : "Start"}</Button>
      : <Button variant="secondary" aria-label="Practice test: Open" onClick={() => onJump("material-practice-test")}>Open</Button>,
    <Button variant={variant("oral")} aria-label="Oral questions: Open" onClick={() => onJump("material-oral")}>Open</Button>,
  ];
  return (
    <Card>
      <p className="eyebrow study-actions__eyebrow">Start here</p>
      <ol className="study-actions" aria-label="Next steps">
        {rows.map((text, index) => <li className="study-actions__row" key={index}>
          <span className={`study-actions__num${index === ["guide", "cards", "test", "oral"].indexOf(primary) ? " is-primary" : ""}`} aria-hidden="true">{index + 1}</span>
          <div className="study-actions__text">{text}</div>
          {buttons[index]}
        </li>)}
      </ol>
    </Card>
  );
}
