import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, ConfirmDialog, Dialog } from "@/components/ui";
import type { MockTestRun as Run, PracticeTest, QuestionBookmark, StudyMaterial } from "@/domain/types";
import {
  answerKey, buildMockTest, formatLongClock, mockSeconds, type MockQuestion,
} from "@/logic/mockTest";
import { MOCK_LAST_CAP, toggleBookmark } from "@/logic/mockTestState";
import { timeAnnouncement } from "@/logic/timedAttempts";
import { useOptionalAppData } from "@/state/AppDataContext";
import { useLeaveGuard } from "@/state/leaveGuard";
import { updateToolkit } from "@/state/toolkitUpdate";
import { MockTestNavigator } from "./MockTestNavigator";
import "./MockTest.css";

/** Saved on every Nth answer (each save reloads all app data), on page hide and at the end. */
const SAVE_EVERY = 5;

/** The whole bank in a fixed order; used only to look questions up by id. */
const bankById = (tests: readonly PracticeTest[], materials: readonly StudyMaterial[]) =>
  new Map(buildMockTest(tests, materials, () => 0.5, Number.POSITIVE_INFINITY).map((q) => [q.id, q]));

/** The frozen run for a fresh test: ids in order, deadline = start + 150 s per question. */
export function startMockRun(questions: readonly MockQuestion[], now = Date.now()): Run {
  return {
    questionIds: questions.map((q) => q.id), answers: {}, flags: [], index: 0,
    startedAt: new Date(now).toISOString(),
    deadline: new Date(now + mockSeconds(questions.length) * 1000).toISOString(),
  };
}

/** The runner keeps its own copy of the run; `onSave` is called with it, never read back. */
export function MockTestRunner({ questions, initial, onSave, onClose, bookmarks = [], onBookmarks }: {
  questions: readonly MockQuestion[];
  initial: Run;
  onSave: (run: Run) => void;
  onClose: () => void;
  bookmarks?: readonly QuestionBookmark[];
  /** Called with the new bookmark list; omit to hide the bookmark button. */
  onBookmarks?: (list: QuestionBookmark[]) => void;
}) {
  const [run, setRun] = useState(initial);
  const [now, setNow] = useState(() => Date.now());
  const [ending, setEnding] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [bookFull, setBookFull] = useState(false);
  const runRef = useRef(run);
  runRef.current = run;
  const sinceSave = useRef(0);
  const byId = useMemo(() => new Map(questions.map((q) => [q.id, q])), [questions]);
  const finished = Boolean(run.finishedAt);
  const left = Date.parse(run.deadline) - now;

  const update = useCallback((next: Run, save: boolean) => {
    runRef.current = next;
    setRun(next);
    if (save) { sinceSave.current = 0; onSave(next); }
  }, [onSave]);
  const finish = useCallback(() => {
    if (runRef.current.finishedAt) return;
    update({ ...runRef.current, finishedAt: new Date().toISOString() }, true);
  }, [update]);

  useEffect(() => {
    if (finished) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [finished]);
  useEffect(() => { if (!finished && left <= 0) finish(); }, [finished, left, finish]);
  useEffect(() => {
    if (finished) return undefined;
    const flush = () => { sinceSave.current = 0; onSave(runRef.current); };
    const onHide = () => { if (document.visibilityState === "hidden") flush(); };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    return () => { document.removeEventListener("visibilitychange", onHide); window.removeEventListener("pagehide", flush); };
  }, [finished, onSave]);
  useLeaveGuard(!finished, "Leave your mock test?", "The clock keeps running. You can resume from the Practice tests list.");

  const id = run.questionIds[run.index];
  const item = id ? byId.get(id) : undefined;
  const go = (index: number) => update({ ...run, index }, false);
  const pick = (option: number) => {
    if (!id) return;
    sinceSave.current += 1;
    update({ ...run, answers: { ...run.answers, [id]: answerKey(option) } }, sinceSave.current >= SAVE_EVERY);
  };
  const flagged = id ? run.flags.includes(id) : false;
  const toggleFlag = () => {
    if (!id) return;
    const flags = flagged ? run.flags.filter((f) => f !== id) : [...run.flags, id];
    update({ ...run, flags }, true);
  };
  const bookmarked = item ? bookmarks.some((b) => b.questionId === item.id && b.materialId === item.materialId) : false;
  const toggleMark = () => {
    if (!item || !onBookmarks) return;
    const r = toggleBookmark(bookmarks, { questionId: item.id, materialId: item.materialId });
    setBookFull(r.full);
    if (!r.full) onBookmarks(r.list);
  };
  const close = () => { if (!finished) onSave(runRef.current); onClose(); };
  const total = run.questionIds.length;
  const answered = Object.keys(run.answers).length;

  return <Dialog open title="Mock FAA test" onClose={() => (finished ? close() : setLeaving(true))}
    className="dialog--mock" dismissible
    headerActions={finished ? null : <p className="mock-test__clock" aria-label="Time left">{formatLongClock(left)}</p>}>
    <div className="stack stack--3">
      <span className="visually-hidden" role="status" aria-live="polite">{finished ? "" : timeAnnouncement(left)}</span>
      {finished ? <div className="stack stack--2" role="status">
        <p><strong>Finished</strong></p>
        <p className="small">{answered} of {total} answered. This was practice, not a prediction.</p>
        <Button onClick={close}>Close</Button>
      </div> : item ? <>
        <p className="tiny muted" role="status" aria-label="Mock test progress">Question {run.index + 1} of {total} · {answered} answered</p>
        <p className="small ai-copy">{item.question.question}</p>
        <div className="stack stack--2" role="group" aria-label="Answer choices">
          {item.question.options.map((option, i) => <button key={i} type="button"
            className="practice-option practice-option--default mock-test__option"
            aria-pressed={run.answers[item.id] === answerKey(i)} onClick={() => pick(i)}>{i + 1}. {option}</button>)}
        </div>
        <div className="row row--wrap">
          <Button variant="secondary" aria-pressed={flagged} onClick={toggleFlag}>{flagged ? "Remove flag" : "Flag for later"}</Button>
          {onBookmarks ? <Button variant="secondary" aria-pressed={bookmarked} onClick={toggleMark}>{bookmarked ? "Remove bookmark" : "Bookmark"}</Button> : null}
          <Button variant="secondary" aria-expanded={navOpen} onClick={() => setNavOpen((o) => !o)}>Questions</Button>
        </div>
        {bookFull ? <p className="tiny muted" role="status">Your bookmark list is full (100). Remove one to add another.</p> : null}
        {navOpen ? <MockTestNavigator ids={run.questionIds} answers={run.answers} flags={run.flags} index={run.index}
          onJump={(i) => { setBookFull(false); go(i); }} onClose={() => setNavOpen(false)} /> : null}
        <div className="row row--wrap">
          <Button variant="secondary" disabled={run.index === 0} onClick={() => go(run.index - 1)}>Back</Button>
          <Button variant="secondary" disabled={run.index >= total - 1} onClick={() => go(run.index + 1)}>Next</Button>
          <Button variant="secondary" onClick={() => setEnding(true)}>End test</Button>
        </div>
      </> : <p>This question is no longer in your materials.</p>}
    </div>
    <ConfirmDialog open={ending} title="End the test now?" message={`You have answered ${answered} of ${total}. Unanswered questions count as missed.`}
      confirmLabel="End test" destructive={false} onCancel={() => setEnding(false)} onConfirm={() => { setEnding(false); finish(); }} />
    <ConfirmDialog open={leaving} title="Leave your mock test?" message="The clock keeps running. You can resume from the Practice tests list."
      confirmLabel="Leave" destructive={false} onCancel={() => setLeaving(false)} onConfirm={() => { setLeaving(false); close(); }} />
  </Dialog>;
}

/** Picker row: start a mock, or resume the unfinished one. Hidden outside the app data provider. */
export function MockTestEntry({ practiceTests, materials, onStarted }: {
  practiceTests: readonly PracticeTest[];
  materials: readonly StudyMaterial[];
  onStarted?: () => void;
}) {
  const app = useOptionalAppData();
  const [session, setSession] = useState<{ run: Run; questions: MockQuestion[] } | null>(null);
  const saved = app?.data.toolkit?.mockTest?.current;
  const resumable = useMemo(() => {
    if (!saved || saved.finishedAt) return null;
    const bank = bankById(practiceTests, materials);
    const questions = saved.questionIds.flatMap((qid) => bank.get(qid) ?? []);
    return questions.length ? { run: saved, questions } : null;
  }, [saved, practiceTests, materials]);
  const mutate = app?.mutate;
  const bookmarks = app?.data.toolkit?.questionBookmarks;
  const saveBookmarks = useCallback((list: QuestionBookmark[]) => {
    if (mutate) void updateToolkit(mutate, (t) => ({ ...t, questionBookmarks: list }));
  }, [mutate]);
  const save = useCallback((run: Run) => {
    if (!mutate) return;
    void updateToolkit(mutate, (t) => {
      const last = t.mockTest?.last ?? [];
      return { ...t, mockTest: run.finishedAt
        ? { last: [run, ...last].slice(0, MOCK_LAST_CAP) } : { ...t.mockTest, last, current: run } };
    });
  }, [mutate]);
  if (!app) return null;
  const begin = (next: { run: Run; questions: MockQuestion[] }, store: boolean) => {
    if (store) save(next.run);
    setSession(next); onStarted?.();
  };
  const hasQuestions = practiceTests.some((t) => t.questions.length > 0);
  return <>
    <Button variant="secondary" aria-haspopup="dialog" disabled={!hasQuestions} onClick={() => {
      const questions = buildMockTest(practiceTests, materials);
      if (questions.length) begin({ run: startMockRun(questions), questions }, true);
    }}>Mock FAA test</Button>
    {resumable ? <p className="small">
      <Button variant="secondary" onClick={() => begin(resumable, false)}>Resume your mock test</Button>
    </p> : null}
    {session ? <MockTestRunner questions={session.questions} initial={session.run} onSave={save}
      bookmarks={bookmarks} onBookmarks={saveBookmarks} onClose={() => setSession(null)} /> : null}
  </>;
}
