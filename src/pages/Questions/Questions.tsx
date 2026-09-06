import { useMemo, useState } from "react";
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
  type Question,
  type QuestionStatus,
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
                    onClick={() => setFilter(option.value)}
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
                visible.map((question) => (
                  <QuestionRow
                    key={question.id}
                    question={question}
                    onDelete={() => setConfirmingDelete(question)}
                  />
                ))
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

function QuestionRow({ question, onDelete }: { question: Question; onDelete: () => void }) {
  const { data, mutate } = useAppData();
  const [answer, setAnswer] = useState(question.answer);
  const [editingAnswer, setEditingAnswer] = useState(false);

  const material = data.materials.find((candidate) => candidate.id === question.materialId);
  const event = data.events.find((candidate) => candidate.id === question.eventId);

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
          ) : null}
          {event ? (
            <Link className="tiny" to={`/schedule/${event.id}`}>
              {event.title}
            </Link>
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
              onChange={(e) => setAnswer(e.target.value)}
            />
            <div className="row">
              <Button
                size="small"
                variant="primary"
                onClick={async () => {
                  const result = await mutate((repos) =>
                    repos.questions.update(question.id, {
                      answer,
                      status: answer.trim() ? "answered" : question.status,
                    }),
                  );
                  if (result === null) return;
                  setEditingAnswer(false);
                }}
              >
                Save answer
              </Button>
              <Button size="small" variant="ghost" onClick={() => setEditingAnswer(false)}>
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
          onChange={(value) => mutate((repos) => repos.questions.update(question.id, { status: value }))}
          style={{ width: "auto" }}
        />
        {!editingAnswer ? (
          <Button size="small" variant="ghost" onClick={() => setEditingAnswer(true)}>
            {question.answer ? "Edit answer" : "Add answer"}
          </Button>
        ) : null}
        <IconButton label={`Delete question: ${question.text}`} tone="danger" onClick={onDelete}>
          <TrashIcon size={16} />
        </IconButton>
      </div>
    </div>
  );
}
