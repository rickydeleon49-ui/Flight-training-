import { useEffect, useRef, useState } from "react";
import { Button, Checkbox, ConfirmDialog, Dialog, Field, TextArea, TextInput } from "@/components/ui";
import { appendPracticeRetirements } from "@/data/practiceAuthoring";
import { bindPdfQuestions, buildPracticeEditOperation, draftFromSnapshot, draftWithPdfQuestions, type PracticeDraftQuestion } from "@/data/practiceAuthoringDraft";
import { PRACTICE_AUTHORING_ERROR_MESSAGES, PracticeAuthoringError } from "@/data/persistenceErrors";
import type { PracticeHistoryEntry, PracticeSaveOperation, PracticeSnapshot, StudyMaterial } from "@/domain/types";
import { formatLocalDay } from "@/lib/dates";
import { useAppData } from "@/state/AppDataContext";
import type { PdfQuestionSeed } from "@/data/pdfStudyKitDraft";
import { PdfItemLabel, PDF_KIT_REMINDER } from "./PdfItemLabel";
import { AuthorBadge } from "./StudySetEditor";

// Mirrors the decoder bounds in practiceAuthoring.ts without changing that contract.
const MAX_QUESTIONS = 200;
const MAX_OPTIONS = 8;
const MIN_OPTIONS = 2;
const length = (text: string) => [...text].length;
type UiQuestion = PracticeDraftQuestion & { pageInput: string };
const emptyQuestion = (): UiQuestion => ({ pageInput: "", identity: null, question: "", options: ["", ""], correctIndex: 0, explanation: "", sourcePage: null, instructor: false });
const problemText = (error: unknown) => error instanceof PracticeAuthoringError
  ? PRACTICE_AUTHORING_ERROR_MESSAGES[error.code] : PRACTICE_AUTHORING_ERROR_MESSAGES.STORAGE_ERROR;

function samePdfQuestion(a: PracticeDraftQuestion, b: PracticeDraftQuestion) {
  return a.question === b.question && JSON.stringify(a.options) === JSON.stringify(b.options) && a.correctIndex === b.correctIndex && a.explanation === b.explanation && a.sourcePage === b.sourcePage;
}

function questionErrors(question: PracticeDraftQuestion) {
  return {
    question: !question.question.trim() ? "Write a question first." : length(question.question) > 10_000 ? "Keep the question within 10,000 characters." : null,
    options: question.options.map((option) => !option.trim() ? "Write an answer option first." : length(option) > 1_000 ? "Keep each option within 1,000 characters." : null),
    count: question.options.length < MIN_OPTIONS || question.options.length > MAX_OPTIONS ? "Use 2 to 8 answer options." : null,
    answer: !Number.isInteger(question.correctIndex) || question.correctIndex < 0 || question.correctIndex >= question.options.length ? "Choose the correct answer." : null,
    explanation: length(question.explanation) > 5_000 ? "Keep the explanation within 5,000 characters." : null,
    page: question.sourcePage !== null && (!Number.isInteger(question.sourcePage) || question.sourcePage < 1 || question.sourcePage > 1_000) ? "Use a page from 1 to 1,000, or leave it empty." : null,
  };
}

/** One dialog for a first manual test and for editing an existing test. */
function PracticeEditing({ material, creating, activeAttempt, seed, onClose, onSourceChanged, onSaved, onLeaveOut }: { material: StudyMaterial; creating: boolean; activeAttempt?: boolean | null; seed?: PdfQuestionSeed; onClose?: () => void; onSourceChanged?: () => void; onSaved?: () => void; onLeaveOut?: () => void }) {
  const { repositories, mutate, dataRevision, data } = useAppData();
  const [open, setOpen] = useState(Boolean(seed));
  const [expected, setExpected] = useState<PracticeSnapshot | null | undefined>();
  const [title, setTitle] = useState(material.title);
  const [draft, setDraft] = useState<UiQuestion[]>([]);
  const [attempt, setAttempt] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [validate, setValidate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [reloading, setReloading] = useState(false);
  const busyRef = useRef(false);
  const readRef = useRef(0);
  const pending = useRef<{ key: string; operation: PracticeSaveOperation } | null>(null);
  const mirrorKey = seed ? `hfd:pdf-kit-questions:${seed.journal.runId}` : null;
  const remember = () => {
    if (!mirrorKey || expected === undefined) return;
    try { localStorage.setItem(mirrorKey, JSON.stringify({ title, draft, expected, pending: pending.current })); }
    catch { setError("Draft recovery is unavailable. Keep this window open until your questions are saved."); }
  };
  useEffect(() => { if (open && mirrorKey) remember(); }, [title, draft, expected, busy, open, mirrorKey]);
  const titleRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (open && expected !== undefined) titleRef.current?.focus();
  }, [open, expected]);

  useEffect(() => {
    let live = true;
    repositories?.practiceSessions.getCurrentAttempt(material.id).then((current) => {
      if (live) setAttempt(current !== null);
    }).catch(() => { if (live) setAttempt(null); });
    return () => { live = false; };
  }, [repositories, material.id, dataRevision, activeAttempt]);

  const close = () => {
    if (busyRef.current) return;
    readRef.current++;
    setOpen(false);
    setDeleting(null);
    setReloading(false);
    remember();
    if (!seed) pending.current = null;
    onClose?.();
  };
  const load = async (useMirror = true) => {
    if (!repositories || busyRef.current) return;
    const request = ++readRef.current;
    setExpected(undefined);
    setError(null);
    try {
      const current = await repositories.documents.readPracticeSnapshot(material.id);
      if (readRef.current !== request) return;
      if (mirrorKey && useMirror) {
        try {
          const mirror = JSON.parse(localStorage.getItem(mirrorKey) ?? "null");
          if (mirror && typeof mirror.title === "string" && Array.isArray(mirror.draft) && mirror.draft.length <= MAX_QUESTIONS && mirror.draft.every((q: UiQuestion) => typeof q.question === "string" && Array.isArray(q.options) && q.options.every(o => typeof o === "string") && typeof q.explanation === "string" && typeof q.pageInput === "string")) {
            setExpected(mirror.expected); setTitle(mirror.title); setDraft(mirror.draft); pending.current = mirror.pending; setValidate(false); setStale(false); return;
          }
        } catch { /* Reopen the authoritative journal when the typing mirror is unavailable. */ }
      }
      setExpected(current);
      setTitle(current?.title ?? material.title);
      setDraft(seed ? draftWithPdfQuestions(current, seed).map(item => ({ ...item, pageInput: item.sourcePage === null ? "" : String(item.sourcePage) })) : current ? draftFromSnapshot(current).map((item) => ({ ...item, pageInput: item.sourcePage === null ? "" : String(item.sourcePage) })) : [emptyQuestion()]);
      pending.current = null;
      setValidate(false);
      setStale(false);
    } catch (failure) {
      if (readRef.current === request) setError(problemText(failure));
    }
  };
  useEffect(() => { if (seed) void load(); }, [seed, repositories]);
  const change = (index: number, update: Partial<UiQuestion>) => {
    pending.current = null;
    setDraft((items) => items.map((item, at) => at === index ? { ...item, ...update } : item));
  };
  const errors = draft.map(questionErrors);
  const titleError = length(title) > 500 ? "Keep the title within 500 characters." : null;
  const countError = draft.length === 0 ? "Add at least one question." : draft.length > MAX_QUESTIONS ? "Keep this test within 200 questions." : null;
  const invalid = Boolean(titleError || countError || errors.some((item) => item.question || item.options.some(Boolean) || item.count || item.answer || item.explanation || item.page));
  const save = async () => {
    if (busyRef.current || expected === undefined) return;
    setValidate(true);
    if (invalid) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const key = JSON.stringify([title, draft, expected]);
    try {
      const result = await mutate(async (repos) => {
        try {
          let operation = pending.current?.key === key ? pending.current.operation : await buildPracticeEditOperation({
            operationId: crypto.randomUUID(), materialId: material.id, expected, title, draft,
          });
          if (seed && pending.current?.key !== key) operation = await bindPdfQuestions(operation, draft, seed);
          pending.current = { key, operation };
          remember();
          await repos.documents.savePracticeAuthoring(operation);
          return { ok: true as const };
        } catch (failure) {
          return { ok: false as const, sourceChanged: failure instanceof PracticeAuthoringError && failure.code === "SOURCE_CHANGED", message: problemText(failure), stale: failure instanceof PracticeAuthoringError && failure.code === "STALE_CONTENT" };
        }
      });
      if (result?.ok) {
        setOpen(false);
        if (!seed) pending.current = null;
        remember();
        onSaved?.();
        onClose?.();
      } else {
        if (result?.sourceChanged) onSourceChanged?.();
        setError(result?.message ?? PRACTICE_AUTHORING_ERROR_MESSAGES.STORAGE_ERROR);
        setStale(result?.stale ?? false);
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const blocked = activeAttempt === true || attempt === true;
  const label = seed ? "Review draft questions" : creating ? "Write your own practice questions" : "Edit questions";
  const hasTest = data.practiceTests.some((test) => test.sourceMaterialId === material.id);
  const applicable = !seed && (creating ? !hasTest : hasTest);
  const wasOpen = useRef(false);
  useEffect(() => {
    // A successful first save replaces its opener with Edit questions.
    if (wasOpen.current && !open && creating && hasTest) {
      document.getElementById("practice-edit-questions")?.focus();
    }
    wasOpen.current = open;
  }, [open, creating, hasTest]);
  // Keep an uncertain first save open even when refreshing reveals its commit.
  if (!applicable && !open) return null;
  return <div className="stack stack--2">
    {applicable ? <div><Button id={creating ? undefined : "practice-edit-questions"} size="small" variant="secondary" style={{ whiteSpace: "normal", maxWidth: "100%", overflowWrap: "anywhere" }} disabled={!creating && (blocked || attempt === null)} onClick={() => { setOpen(true); void load(); }}>{label}</Button></div> : null}
    {!creating && blocked ? <p className="tiny muted">Finish your current attempt, or use Abandon attempt below, before editing questions.</p> : null}
    <Dialog open={open} onClose={close} title={label} dismissible={!busy} initialFocus={() => titleRef.current} footer={<>
      <Button onClick={close} disabled={busy}>Cancel</Button>
      {seed ? <Button disabled={busy} onClick={() => { onLeaveOut?.(); close(); }}>Leave questions out</Button> : null}
      <Button variant="primary" disabled={busy || expected === undefined || Boolean(seed && (blocked || attempt === null))} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</Button>
    </>}>
      <div className="stack stack--3" style={{ minWidth: 0, overflowWrap: "anywhere" }}>
        {seed ? <p className="tiny muted">{PDF_KIT_REMINDER} Your saved questions stay here; these drafts are added only when you save.</p> : null}
        {seed && blocked ? <p role="alert">Finish or abandon your current attempt before saving these questions.</p> : null}
        {expected === undefined ? <p role="status">Opening…</p> : <fieldset disabled={busy} className="stack stack--3" style={{ minWidth: 0, border: 0, padding: 0 }}>
          <Field label="Practice test title" error={validate ? titleError : null}><input className="input" ref={titleRef} value={title} onChange={(event) => { pending.current = null; setTitle(event.target.value); }} /></Field>
          {draft.map((question, index) => {
            const messages = errors[index]!;
            const instructor = expected?.questions.find((item) => item.identity === question.identity)?.origin === "instructor";
            const origin = instructor || question.instructor ? "instructor" : expected?.questions.find((item) => item.identity === question.identity)?.origin ?? (question.identity === null ? "user" : undefined);
            const savedIndex = expected?.questions.findIndex(q => q.identity === question.identity) ?? -1;
            const savedPdf = data.practiceTests.find(test => test.sourceMaterialId === material.id)?.questions[savedIndex]?.pdfProvenance;
            return <fieldset key={index} className="stack stack--2" style={{ minWidth: 0 }}>
              <legend>Question {index + 1}</legend>{seed?.questions.some(q => q.identity === question.identity) ? <PdfItemLabel provenance={{ status: "valid", label: "Pulled from your PDF on this Mac", sources: [] }} origin={question.instructor ? "instructor" : !samePdfQuestion(question, seed.questions.find(q => q.identity === question.identity)!) ? "user" : undefined} /> : savedPdf ? <PdfItemLabel provenance={savedPdf} origin={question.instructor ? "instructor" : expected?.questions[savedIndex] && !samePdfQuestion(question, draftFromSnapshot(expected)[savedIndex]!) ? "user" : origin} /> : <AuthorBadge origin={origin} />}
              <Field label={`Question ${index + 1} wording`} error={validate ? messages.question : null}><TextArea rows={3} value={question.question} onChange={(event) => change(index, { question: event.target.value })} /></Field>
              <div role="group" aria-label={`Question ${index + 1} answer options`} className="stack stack--2">
                {question.options.map((option, at) => <div key={at} className="stack stack--2" style={{ minWidth: 0 }}>
                  <Field label={`Question ${index + 1}, option ${at + 1}`} error={validate ? messages.options[at] : null}><TextArea rows={2} value={option} onChange={(event) => change(index, { options: question.options.map((value, position) => position === at ? event.target.value : value) })} /></Field>
                  <div className="row row--wrap"><label><input type="radio" name={`correct-${index}`} checked={question.correctIndex === at} onChange={() => change(index, { correctIndex: at })} /> Correct answer: option {at + 1}</label>
                    <Button size="small" variant="danger" className="destructive-action" disabled={question.options.length <= MIN_OPTIONS} aria-label={`Remove question ${index + 1} option ${at + 1}`} onClick={() => change(index, {
                      options: question.options.filter((_, position) => position !== at),
                      correctIndex: question.correctIndex === at ? -1 : question.correctIndex > at ? question.correctIndex - 1 : question.correctIndex,
                    })}>Remove option</Button></div>
                </div>)}
                <div><Button size="small" disabled={question.options.length >= MAX_OPTIONS} onClick={() => change(index, { options: [...question.options, ""] })}>Add answer option</Button></div>
                {validate && (messages.answer || messages.count) ? <p role="alert" className="field__error">{messages.answer || messages.count}</p> : null}
              </div>
              <Field label={`Question ${index + 1} explanation (optional)`} error={validate ? messages.explanation : null} hint={length(question.explanation) >= 4_500 ? `${length(question.explanation).toLocaleString()} / 5,000 characters` : undefined}><TextArea rows={3} value={question.explanation} onChange={(event) => change(index, { explanation: event.target.value })} /></Field>
              <Field label={`Question ${index + 1} page (optional)`} error={validate ? messages.page : null}><TextInput type="text" inputMode="numeric" value={question.pageInput} onChange={(event) => change(index, { pageInput: event.target.value, sourcePage: event.target.value.trim() === "" ? null : Number(event.target.value) })} /></Field>
              <Checkbox label="My instructor corrected this" checked={instructor || question.instructor} disabled={instructor} onChange={(checked) => change(index, { instructor: checked })} />
              <div><Button size="small" variant="danger" aria-label={`Delete question ${index + 1}`} onClick={() => setDeleting(index)}>Delete question</Button></div>
            </fieldset>;
          })}
          <div><Button size="small" disabled={draft.length >= MAX_QUESTIONS} onClick={() => { pending.current = null; setDraft((items) => [...items, emptyQuestion()]); }}>Add a question</Button></div>
          {validate && countError ? <p role="alert" className="field__error">{countError}</p> : null}
        </fieldset>}
        {error ? <p className="field__error" role="alert">{error}</p> : null}
        {stale ? <Button onClick={() => setReloading(true)}>Load the latest version</Button> : null}
      </div>
    </Dialog>
    <ConfirmDialog open={deleting !== null} title="Delete this question?" message="The question is removed when you save. Its earlier wording stays in Previous versions." onCancel={() => setDeleting(null)} onConfirm={() => {
      pending.current = null;
      setDraft((items) => items.filter((_, index) => index !== deleting));
      setDeleting(null);
    }} />
    <ConfirmDialog open={reloading} title="Load the latest version?" message="This replaces your unsaved draft with the latest saved questions." confirmLabel="Load latest" destructive={false} onCancel={() => setReloading(false)} onConfirm={() => { setReloading(false); void load(false); }} />
  </div>;
}

export function PdfPracticeQuestions({ material, seed, onClose, onSourceChanged, onSaved, onLeaveOut }: { material: StudyMaterial; seed: PdfQuestionSeed; onClose: () => void; onSourceChanged: () => void; onSaved?: () => void; onLeaveOut?: () => void }) {
  return <PracticeEditing material={material} creating seed={seed} onClose={onClose} onSourceChanged={onSourceChanged} onSaved={onSaved} onLeaveOut={onLeaveOut} />;
}

export function StartManualPracticeTest({ material }: { material: StudyMaterial }) {
  return <PracticeEditing material={material} creating />;
}
export function PracticeTestEditor({ material, activeAttempt }: { material: StudyMaterial; activeAttempt?: boolean | null }) {
  return <PracticeEditing material={material} creating={false} activeAttempt={activeAttempt} />;
}

const REASON_LABELS: Record<PracticeHistoryEntry["reason"], string> = {
  edit: "Before an edit", correct: "Before a correction", delete: "Before a deletion", regenerate: "Before regenerating", import: "Before an import", restore: "Before restoring an earlier version",
};

/** Restores exact earlier identities and origins while retaining every required ledger. */
export function PracticeTestHistory({ material }: { material: StudyMaterial }) {
  const { repositories, mutate, dataRevision } = useAppData();
  const [entries, setEntries] = useState<PracticeHistoryEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<PracticeHistoryEntry | null>(null);
  const [prepared, setPrepared] = useState<PracticeSaveOperation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const readRef = useRef(0);
  useEffect(() => {
    let live = true;
    repositories?.documents.listPracticeHistory(material.id).then((list) => { if (live) { setEntries(list); setLoadError(null); } }).catch(() => { if (live) setLoadError("Previous versions couldn't be read. Try again later."); });
    return () => { live = false; };
  }, [repositories, material.id, dataRevision]);
  const choose = async (entry: PracticeHistoryEntry) => {
    if (!repositories || !entry.snapshot || busyRef.current) return;
    const request = ++readRef.current;
    setChosen(entry);
    setPrepared(null);
    setError(null);
    try {
      const current = await repositories.documents.readPracticeSnapshot(material.id);
      const history = current ? [] : await repositories.documents.listPracticeHistory(material.id);
      const snapshot = entry.snapshot;
      const retired = appendPracticeRetirements(current?.retired ?? [], [
        ...snapshot.retired, ...history.flatMap((version) => version.snapshot?.retired ?? []),
      ]);
      if (request !== readRef.current) return;
      setPrepared({ operationId: crypto.randomUUID(), sourceMaterialId: material.id, reason: "restore", expected: current,
        next: { title: snapshot.title, provider: snapshot.provider, model: snapshot.model, questions: snapshot.questions, retired } });
    } catch (failure) { if (request === readRef.current) setError(problemText(failure)); }
  };
  const restore = async () => {
    if (busyRef.current || !prepared) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const outcome = await mutate(async (repos) => {
        try { await repos.documents.savePracticeAuthoring(prepared); return { ok: true as const }; }
        catch (failure) { return { ok: false as const, message: problemText(failure) }; }
      });
      if (outcome?.ok) setChosen(null);
      else setError(outcome?.message ?? PRACTICE_AUTHORING_ERROR_MESSAGES.STORAGE_ERROR);
    } finally { busyRef.current = false; setBusy(false); }
  };
  if (loadError) return <p role="alert" className="field__error">{loadError}</p>;
  if (!entries.length) return null;
  return <section aria-label="Previous practice versions" className="stack stack--2" style={{ minWidth: 0, overflowWrap: "anywhere" }}>
    <h3>Previous versions</h3>
    <ul aria-label="Previous practice versions" className="stack stack--2">{entries.map((entry) => <li key={entry.id} className="row row--between row--wrap">
      <div style={{ minWidth: 0 }}><p>{REASON_LABELS[entry.reason]}</p><p className="tiny muted">{formatLocalDay(entry.createdAt) ?? "Unknown date"} · {entry.snapshot ? `${entry.snapshot.questions.length} question${entry.snapshot.questions.length === 1 ? "" : "s"}` : "This version is damaged"}</p></div>
      <Button size="small" variant="secondary" disabled={!entry.snapshot || busy} onClick={() => void choose(entry)}>Bring this version back</Button>
    </li>)}</ul>
    <Dialog open={chosen !== null} title="Bring this version back?" onClose={() => { if (!busyRef.current) { readRef.current++; setChosen(null); } }} dismissible={!busy} footer={<>
      <Button disabled={busy} onClick={() => { if (!busyRef.current) { readRef.current++; setChosen(null); } }}>Cancel</Button>
      <Button variant="primary" disabled={busy || !prepared} onClick={() => void restore()}>{busy ? "Restoring…" : "Bring this version back"}</Button>
    </>}><p>Your current questions are kept in Previous versions before this version comes back.</p>{error ? <p role="alert" className="field__error">{error}</p> : null}</Dialog>
  </section>;
}
