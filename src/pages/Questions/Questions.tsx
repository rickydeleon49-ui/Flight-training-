import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { PageHeader } from "@/components/layout/PageHeader";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  IconButton,
  QuestionIcon,
  Select,
  TextArea,
  TrashIcon,
} from "@/components/ui";
import {
  QUESTION_STATUS_LABELS,
  QUESTION_STATUS_OPTIONS,
  TOPIC_LABELS,
  TOPIC_OPTIONS,
  type JournalEntry,
  type Question,
  type QuestionStatus,
  type ScheduleEvent,
  type StudyMaterial,
  type Topic,
} from "@/domain/types";
import { formatShortDate, todayIso } from "@/lib/dates";
import { nextLesson } from "@/logic/preparation";
import { useAppData } from "@/state/AppDataContext";
import { isOneOf, useRememberedState } from "@/state/useRememberedState";

import "./questions.css";

type Filter = QuestionStatus | "all";

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "Everything" },
  { value: "to_ask", label: "To Ask" },
  { value: "asked", label: "Asked" },
  { value: "answered", label: "Answered" },
  { value: "revisit", label: "Revisit" },
];

const FILTER_VALUES = FILTERS.map((filter) => filter.value);

/**
 * Rows mounted at once. Every question stays reachable through "Show more";
 * the status filters and counts always cover the whole list. Rendering all
 * rows was the slowest measured screen with a long question history
 * (docs/PERFORMANCE_POLISH_2026-09-27.md).
 */
export const QUESTION_PAGE_SIZE = 100;

interface AnswerDraft {
  text: string;
  revision: number;
}

export function Questions() {
  const { data, mutate, deleteWithUndo } = useAppData();
  const today = todayIso();
  // Held for as long as the app is open, like the library's filters.
  const [filter, setFilter] = useRememberedState<Filter>(
    "questions.filter", "all", isOneOf(FILTER_VALUES),
  );
  const [text, setText] = useState("");
  const [topic, setTopic] = useState<Topic>("general");
  const [eventId, setEventId] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState<Question | null>(null);

  const lesson = nextLesson(data.events, today);

  const visible = useMemo(
    () =>
      filter === "all"
        ? data.questions
        : data.questions.filter((question) => question.status === filter),
    [data.questions, filter],
  );

  // Every real filter change starts again from one page. (Deriving the limit
  // from a remembered filter kept an old expansion when switching back.)
  const [visibleLimit, setVisibleLimit] = useState(QUESTION_PAGE_SIZE);
  const chooseFilter = (next: Filter) => {
    if (next === filter) return;
    setFilter(next);
    setVisibleLimit(QUESTION_PAGE_SIZE);
  };

  // Unsaved answers, by question id. They live here rather than in each row,
  // so a row leaving the visible page (a new question, a filter change,
  // paging) does not lose what she typed. Nothing here is saved on its own:
  // only "Save answer" writes, and only for that question. A draft whose
  // question no longer exists has no row, so it cannot write anywhere.
  // Each draft carries a monotonically increasing revision counter so that
  // an in-flight save completion only clears the exact draft revision it
  // submitted; newer edits or newly opened sessions are preserved.
  const [answerDrafts, setAnswerDrafts] = useState<ReadonlyMap<string, AnswerDraft>>(() => new Map());
  const [savingQuestionIds, setSavingQuestionIds] = useState<ReadonlySet<string>>(() => new Set());
  const savingQuestionIdsRef = useRef<Set<string>>(new Set());
  const nextDraftRevisionRef = useRef(1);

  const setAnswerDraft = (id: string, text: string | null) =>
    setAnswerDrafts((current) => {
      const next = new Map(current);
      if (text === null) {
        next.delete(id);
      } else {
        next.set(id, {
          text,
          revision: nextDraftRevisionRef.current++,
        });
      }
      return next;
    });

  const clearAnswerDraftRevision = (id: string, revision: number) => {
    setAnswerDrafts((current) => {
      const existing = current.get(id);
      if (!existing || existing.revision !== revision) {
        return current;
      }
      const next = new Map(current);
      next.delete(id);
      return next;
    });
  };

  const handleSaveAnswer = async (question: Question) => {
    // Synchronous guard prevents duplicate submissions from rapid clicks within the same React render/batch.
    if (savingQuestionIdsRef.current.has(question.id)) return;
    savingQuestionIdsRef.current.add(question.id);

    const draft = answerDrafts.get(question.id);
    const answer = draft !== undefined ? draft.text : question.answer;
    const submittedRevision = draft?.revision;

    setSavingQuestionIds((current) => {
      const next = new Set(current);
      next.add(question.id);
      return next;
    });

    try {
      const result = await mutate((repos) =>
        repos.questions.update(question.id, {
          answer,
          status: answer.trim() ? "answered" : question.status,
        }),
      );

      // A failed save keeps the draft so she can try again.
      // A successful save clears only the revision that was submitted.
      // If newer edits were made while the save was in-flight, they survive.
      if (result !== null && submittedRevision !== undefined) {
        clearAnswerDraftRevision(question.id, submittedRevision);
      }
    } finally {
      savingQuestionIdsRef.current.delete(question.id);
      setSavingQuestionIds((current) => {
        if (!current.has(question.id)) return current;
        const next = new Set(current);
        next.delete(question.id);
        return next;
      });
    }
  };

  // Rows look up their linked material, lesson and debrief by id. Building
  // these maps once per data change replaces a scan of every material,
  // lesson and journal entry for each row (measured in
  // docs/PERFORMANCE_POLISH_2026-09-27.md).
  const links = useMemo<QuestionLinks>(
    () => ({
      materials: new Map(data.materials.map((material) => [material.id, material])),
      events: new Map(data.events.map((event) => [event.id, event])),
      journalEntries: new Map(data.journalEntries.map((entry) => [entry.id, entry])),
    }),
    [data.materials, data.events, data.journalEntries],
  );

  const beforeNextLesson = data.questions.filter(
    (question) => question.status === "to_ask" && (question.eventId === lesson?.id || question.eventId === null),
  );

  const add = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const result = await mutate((repos) =>
      repos.questions.create({ text: trimmed, topic, eventId: eventId || null }),
    );
    if (result === null) return;
    setText("");
    setEventId("");
  };

  return (
    <>
      <PageHeader
        title="Questions"
        subtitle="Things you don't want to forget to ask."
      />

      <div className="detail">
        <div className="detail__column">
          <Card>
            <CardHeader title="Add a question" />
            <CardBody>
              <div className="stack stack--3">
                <TextArea
                  rows={2}
                  value={text}
                  aria-label="Your question"
                  placeholder="How much rudder is normal in a 12-knot crosswind?"
                  onChange={(e) => setText(e.target.value)}
                />
                <div className="row row--wrap">
                  <Select
                    aria-label="Topic"
                    options={TOPIC_OPTIONS}
                    value={topic}
                    onChange={(value) => setTopic(value)}
                    style={{ width: "auto" }}
                  />
                  <Select
                    aria-label="Ask at which lesson"
                    placeholder="Any lesson"
                    options={data.events
                      .filter((event) => event.date >= today)
                      .map((event) => ({ value: event.id, label: `${event.title} · ${event.date}` }))}
                    value={eventId}
                    onChange={(value) => setEventId(value)}
                    style={{ width: "auto" }}
                  />
                  <Button variant="primary" onClick={add} disabled={!text.trim()}>
                    Save question
                  </Button>
                </div>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Your questions"
              action={<span className="tiny dim">{data.questions.length} total</span>}
            />
            <CardBody flush>
              <div className="filter-chips" style={{ padding: "0 var(--space-5) var(--space-4)" }}>
                {FILTERS.map((option) => (
                  <button
                    type="button"
                    key={option.value}
                    className={`filter-chip${filter === option.value ? " is-active" : ""}`}
                    aria-pressed={filter === option.value}
                    onClick={() => chooseFilter(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              {visible.length === 0 ? (
                <EmptyState
                  icon={<QuestionIcon size={26} />}
                  title={
                    data.questions.length === 0
                      ? "Nothing saved yet."
                      : "Nothing with that status."
                  }
                  body={
                    data.questions.length === 0
                      ? "When something puzzles you mid-study, put it here. Unasked questions show up before your next lesson."
                      : undefined
                  }
                />
              ) : (
                <>
                  {visible.length > QUESTION_PAGE_SIZE ? (
                    <p className="small muted" style={{ padding: "0 var(--space-5) var(--space-3)" }}>
                      Showing {Math.min(visibleLimit, visible.length).toLocaleString()} of{" "}
                      {visible.length.toLocaleString()} questions
                    </p>
                  ) : null}
                  {visible.slice(0, visibleLimit).map((question) => (
                    <QuestionRow
                      key={question.id}
                      question={question}
                      links={links}
                      draft={answerDrafts.get(question.id)?.text}
                      isSaving={savingQuestionIds.has(question.id)}
                      onDraftChange={(text) => setAnswerDraft(question.id, text)}
                      onSave={() => handleSaveAnswer(question)}
                      onCancel={() => setAnswerDraft(question.id, null)}
                      onDelete={() => setConfirmingDelete(question)}
                    />
                  ))}
                  {visible.length > visibleLimit ? (
                    <div style={{ padding: "var(--space-4) var(--space-5)" }}>
                      <Button onClick={() => setVisibleLimit(visibleLimit + QUESTION_PAGE_SIZE)}>
                        Show {Math.min(QUESTION_PAGE_SIZE, visible.length - visibleLimit)} more questions
                      </Button>
                    </div>
                  ) : null}
                </>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="detail__column">
          {lesson ? (
            <Card variant="accent">
              <CardHeader title="Before your next lesson" />
              <CardBody>
                <div className="stack stack--3">
                  <p className="small muted">
                    {lesson.title} · {formatShortDate(lesson.date)}
                  </p>
                  {beforeNextLesson.length === 0 ? (
                    <p className="small dim">Nothing waiting to be asked.</p>
                  ) : (
                    beforeNextLesson.map((question) => (
                      <p className="small wrap-anywhere" key={question.id}>
                        · {question.text}
                      </p>
                    ))
                  )}
                  <Link className="button button--secondary button--small" to={`/schedule/${lesson.id}`}>
                    Open the lesson
                  </Link>
                </div>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={confirmingDelete !== null}
        title="Delete this question?"
        message={confirmingDelete?.text ?? ""}
        onConfirm={() => {
          const question = confirmingDelete;
          setConfirmingDelete(null);
          if (question) {
            deleteWithUndo({
              ids: [question.id],
              label: question.text,
              run: (repos) => repos.questions.remove(question.id),
            });
          }
        }}
        onCancel={() => setConfirmingDelete(null)}
      />
    </>
  );
}

interface QuestionLinks {
  materials: ReadonlyMap<string, StudyMaterial>;
  events: ReadonlyMap<string, ScheduleEvent>;
  journalEntries: ReadonlyMap<string, JournalEntry>;
}

function QuestionRow({
  question,
  links,
  draft,
  isSaving,
  onDraftChange,
  onSave,
  onCancel,
  onDelete,
}: {
  question: Question;
  links: QuestionLinks;
  /** The unsaved answer being edited, or undefined when not editing. */
  draft: string | undefined;
  /** True when a save for this question is currently in-flight. */
  isSaving: boolean;
  /** Set the unsaved answer; null discards it and closes the editor. */
  onDraftChange: (text: string | null) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const { mutate } = useAppData();
  const editingAnswer = draft !== undefined;
  const answer = draft ?? question.answer;

  const material = question.materialId ? links.materials.get(question.materialId) : undefined;
  const event = question.eventId ? links.events.get(question.eventId) : undefined;
  const journal = question.journalId ? links.journalEntries.get(question.journalId) ?? null : null;

  const tone =
    question.status === "answered"
      ? "complete"
      : question.status === "revisit"
        ? "berry"
        : "neutral";

  return (
    <div className="question-row">
      <div className="question-row__main">
        <p className="question-row__text wrap-anywhere">{question.text}</p>
        <div className="question-row__meta">
          <Badge tone="study">{TOPIC_LABELS[question.topic]}</Badge>
          <Badge tone={tone}>{QUESTION_STATUS_LABELS[question.status]}</Badge>
          {material ? (
            <Link className="tiny" to={`/study/${material.id}`}>
              {material.title}
            </Link>
          ) : question.materialId || question.sourceMaterialId ? (
            <span className="tiny muted">Source material unavailable</span>
          ) : null}
          {event ? (
            <Link className="tiny" to={`/schedule/${event.id}`}>
              {event.title}
            </Link>
          ) : question.eventId || question.sourceEventId ? (
            <span className="tiny muted">Source lesson unavailable</span>
          ) : null}
          {question.journalId ? (
            journal ? (
              <Link className="tiny" to={`/journal/${journal.id}`}>
                {journal.title || "Debrief"}
              </Link>
            ) : (
              <span className="tiny muted">Source entry unavailable</span>
            )
          ) : question.sourceJournalId ? (
            <span className="tiny muted">Source entry unavailable</span>
          ) : null}
        </div>

        {question.answer && !editingAnswer ? (
          <p className="question-row__answer wrap-anywhere">{question.answer}</p>
        ) : null}

        {editingAnswer ? (
          <div className="stack stack--2" style={{ marginTop: "var(--space-3)" }}>
            <TextArea
              rows={2}
              value={answer}
              aria-label="Answer"
              placeholder="What you were told, in your own words."
              disabled={isSaving}
              onChange={(e) => onDraftChange(e.target.value)}
            />
            <div className="row">
              <Button
                size="small"
                variant="primary"
                disabled={isSaving}
                onClick={onSave}
              >
                {isSaving ? "Saving…" : "Save answer"}
              </Button>
              {/* Cancel discards this question's unsaved answer. Disabled while saving so it cannot be mistaken for an undo of an in-flight write. */}
              <Button
                size="small"
                variant="ghost"
                disabled={isSaving}
                onClick={onCancel}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="question-row__tools">
        <Select
          aria-label={`Status for: ${question.text}`}
          options={QUESTION_STATUS_OPTIONS}
          value={question.status}
          disabled={isSaving}
          onChange={(value) => mutate((repos) => repos.questions.update(question.id, { status: value }))}
          style={{ width: "auto" }}
        />
        {!editingAnswer ? (
          <Button size="small" variant="ghost" disabled={isSaving} onClick={() => onDraftChange(question.answer)}>
            {question.answer ? "Edit answer" : "Add answer"}
          </Button>
        ) : null}
        <IconButton label={`Delete question: ${question.text}`} tone="danger" disabled={isSaving} onClick={onDelete}>
          <TrashIcon size={16} />
        </IconButton>
      </div>
    </div>
  );
}
