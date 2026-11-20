import { useState } from "react";
import { Button } from "@/components/ui";
import type { MockTestRun as Run } from "@/domain/types";
import { scoreMock, type MockQuestion } from "@/logic/mockTest";
import { PASS_PERCENT } from "@/logic/practiceWeakAreas";
import { MockTestReview } from "./MockTestReview";
import "./MockTest.css";

/** "1 h 12 min"; under an hour "45 min"; never negative. Rounds up so 20 s reads "1 min". */
export function formatHoursMinutes(ms: number): string {
  const minutes = Math.max(0, Math.ceil((Number.isFinite(ms) ? ms : 0) / 60000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} h ${String(m).padStart(2, "0")} min` : `${m} min`;
}

const dateLabel = (iso: string): string => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "Unknown date";
};

/** Results of a finished mock: score, time, ACS-area bars with the 70% line, recent history. */
export function MockTestResults({ run, questions, history = [], historyQuestions = questions, onClose }: {
  run: Run;
  questions: readonly MockQuestion[];
  /** Earlier finished mocks, newest first (the toolkit's mockTest.last). */
  history?: readonly Run[];
  /** Where to look history questions up; defaults to this run's questions. */
  historyQuestions?: readonly MockQuestion[];
  onClose: () => void;
}) {
  const [reviewing, setReviewing] = useState(false);
  const score = scoreMock(run, questions);
  const started = Date.parse(run.startedAt);
  const allowed = Date.parse(run.deadline) - started;
  const used = Math.min(Math.max(0, Date.parse(run.finishedAt ?? run.deadline) - started), allowed);
  const past = history.flatMap((r) => {
    const s = scoreMock(r, historyQuestions);
    return r.finishedAt && s.total > 0 ? [{ key: r.finishedAt, when: r.finishedAt, percent: s.percent }] : [];
  });
  if (reviewing) return <MockTestReview run={run} questions={questions} onBack={() => setReviewing(false)} />;
  return <div className="stack stack--3 mock-results">
    <h3>Finished</h3>
    <p role="status"><strong>{score.correct} of {score.total} correct ({score.percent}%)</strong></p>
    <p className="small">Time used: {formatHoursMinutes(used)} of {formatHoursMinutes(allowed)}</p>
    <p className="tiny muted">This is a practice score, not a prediction. Practice numbers only. Your instructor decides.</p>
    <section className="stack stack--2" aria-label="Score by ACS area">
      <h4>By ACS area</h4>
      <ul className="mock-results__bars">
        {score.rows.map((row) => <li key={row.key} className="mock-results__row">
          <span className="small">{row.label}: {row.correct} of {row.total} right ({row.percent}%)</span>
          <div className="mock-results__bar" role="img" aria-label={`${row.label}: ${row.correct} of ${row.total} right, ${row.percent}%. The ${PASS_PERCENT}% line is marked.`}>
            <div className="mock-results__fill" style={{ width: `${row.percent}%` }} />
            <div className="mock-results__line" style={{ left: `${PASS_PERCENT}%` }} />
          </div>
        </li>)}
      </ul>
      <p className="tiny muted">The vertical mark on each bar is the {PASS_PERCENT}% line.</p>
    </section>
    {past.length ? <section className="stack stack--2" aria-label="Your last mock tests">
      <h4>Your last mock tests</h4>
      <ul className="mock-results__history">
        {past.map((p) => <li key={p.key} className="small">{dateLabel(p.when)}: {p.percent}%</li>)}
      </ul>
    </section> : null}
    <div className="row row--wrap">
      <Button variant="secondary" onClick={() => setReviewing(true)}>Review questions</Button>
      <Button onClick={onClose}>Close</Button>
    </div>
  </div>;
}
