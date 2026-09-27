import { useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";

import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ClockIcon,
  EmptyState,
  ErrorNote,
  type BadgeTone,
} from "@/components/ui";
import {
  BUDGET_OPTIONS,
  getStartTarget,
} from "@/logic/dailyPlan";
import type { Recommendation, RecommendationPrecedence } from "@/logic/recommendations";
import { useDailyPlan } from "@/state/useDailyPlan";
import { useLocalToday } from "@/state/useLocalToday";

import { focusRenderedAction } from "./startAction";
import "./dailyPlan.css";

interface DailyPlanCardProps {
  /** Fixed local date for tests; the live card follows the local clock. */
  customToday?: string;
  /**
   * Called for Start on an action that lives on Flight Deck. When omitted, the
   * card focuses the action's control if it is rendered on the page.
   */
  onStartAction?: (actionId: string) => void;
}

function precedenceTone(precedence: RecommendationPrecedence): BadgeTone {
  switch (precedence) {
    case "due_action":
      return "due";
    default:
      return "neutral";
  }
}

function precedenceLabel(precedence: RecommendationPrecedence): string {
  switch (precedence) {
    case "pinned":
      return "Pinned";
    case "due_action":
      return "Due";
    case "lesson_prep":
      return "Next lesson";
    case "study":
      return "Study";
    case "open_action":
      return "Next up";
    default:
      return "Action";
  }
}

export function DailyPlanCard({ customToday, onStartAction }: DailyPlanCardProps) {
  const liveToday = useLocalToday();
  const today = customToday ?? liveToday;
  const {
    plan,
    state,
    timeBudget,
    isSaving,
    saveError,
    sessionUnsaved,
    sources,
    setTimeBudget,
    skipItem,
    deferItem,
    resetToday,
    refreshPlan,
    retrySave,
    clearSaveError,
  } = useDailyPlan(today);

  const [openWhyId, setOpenWhyId] = useState<string | null>(null);
  const [showRemaining, setShowRemaining] = useState<boolean>(false);
  const [startNote, setStartNote] = useState<string | null>(null);
  /** The budget she just chose, shown as selected while it saves. */
  const [pendingBudget, setPendingBudget] = useState<{ value: number | null } | null>(null);
  const budgetRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const shownBudget = pendingBudget ? pendingBudget.value : timeBudget;
  const selectedIndex = Math.max(
    0,
    BUDGET_OPTIONS.findIndex((opt) => opt.value === shownBudget),
  );

  const chooseBudget = async (value: number | null) => {
    setPendingBudget({ value });
    await setTimeBudget(value);
    // Success shows the saved budget; failure falls back to it, with the error.
    setPendingBudget((current) => (current && current.value === value ? null : current));
  };

  const onBudgetKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = BUDGET_OPTIONS.length - 1;
    let next: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = index === last ? 0 : index + 1;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = index === 0 ? last : index - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    if (next === null) return;
    event.preventDefault();
    budgetRefs.current[next]?.focus();
    const option = BUDGET_OPTIONS[next];
    if (option) void chooseBudget(option.value);
  };

  const handleStart = (item: Recommendation) => {
    const target = getStartTarget(item, sources);
    if (!target.isLocalAction || !target.elementId) return;
    const actionId = target.elementId.replace(/^action-/, "");
    setStartNote(null);
    if (onStartAction) {
      onStartAction(actionId);
    } else if (!focusRenderedAction(actionId)) {
      setStartNote(`"${item.title}" isn't shown on this page. Find it in your action list.`);
    }
  };

  const hasDecisionsToday = Object.values(state.decisions).some((d) => d.date === today);
  const overBudget = timeBudget !== null && plan.allocatedMinutes > timeBudget;

  return (
    <Card className="daily-plan-card">
      <CardHeader
        title="Recommended for today"
        eyebrow="Daily Flight Plan"
        action={
          <div className="row" style={{ gap: "var(--space-2)", alignItems: "center" }}>
            {isSaving ? <span className="tiny muted" aria-live="polite">Saving…</span> : null}
            <button
              type="button"
              className="button button--ghost button--small"
              onClick={() => void refreshPlan()}
              aria-label="Refresh daily plan recommendations"
              title="Refresh suggestions from current work"
            >
              Refresh
            </button>
          </div>
        }
      />
      <CardBody>
        <div className="daily-plan-header">
          {/* Available minutes control */}
          <div className="daily-plan-controls">
            <span className="small strong" id="daily-plan-budget-label">
              Available minutes
            </span>
            <div
              className="daily-plan-budget-group"
              role="radiogroup"
              aria-labelledby="daily-plan-budget-label"
            >
              {BUDGET_OPTIONS.map((opt, index) => {
                const isSelected = index === selectedIndex;
                return (
                  <button
                    key={String(opt.value)}
                    type="button"
                    className="daily-plan-budget-btn"
                    role="radio"
                    aria-checked={isSelected}
                    ref={(el) => {
                      budgetRefs.current[index] = el;
                    }}
                    tabIndex={index === selectedIndex ? 0 : -1}
                    onClick={() => void chooseBudget(opt.value)}
                    onKeyDown={(e) => onBudgetKeyDown(e, index)}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Session fit summary disclosure */}
          <div className="daily-plan-summary">
            <div className="daily-plan-summary__status">
              {timeBudget !== null ? (
                plan.fitsBudgetCompletely ? (
                  <span>
                    <strong>Fits {timeBudget}-min session:</strong> {plan.allocatedMinutes} min allocated
                    {timeBudget - plan.allocatedMinutes > 0
                      ? `, ${timeBudget - plan.allocatedMinutes} min left`
                      : ""}
                  </span>
                ) : (
                  <span>
                    <strong>Timed estimate:</strong> {plan.allocatedMinutes} min of {timeBudget} min allocated
                    {overBudget ? " (over budget)" : ""}
                    {plan.suggestedUnestimatedCount > 0 ? " (total duration indeterminate)" : ""}
                  </span>
                )
              ) : (
                <span>
                  <strong>Top priority recommendations:</strong> {plan.suggested.length} items suggested
                </span>
              )}
            </div>
            {hasDecisionsToday ? (
              <button
                type="button"
                className="button button--ghost button--small"
                onClick={() => void resetToday()}
                style={{ fontSize: "var(--text-xs)" }}
              >
                Reset today's skips
              </button>
            ) : null}
          </div>

          {saveError ? (
            <ErrorNote>
              <div className="row row--between" style={{ width: "100%" }}>
                <span>{saveError}</span>
                <span className="row" style={{ gap: "var(--space-1)" }}>
                  {sessionUnsaved ? (
                    <button
                      type="button"
                      className="button button--ghost button--small"
                      onClick={() => void retrySave()}
                    >
                      Retry
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="button button--ghost button--small"
                    onClick={clearSaveError}
                  >
                    Dismiss
                  </button>
                </span>
              </div>
            </ErrorNote>
          ) : null}

          {startNote ? (
            <p className="tiny muted" role="status">
              {startNote}
            </p>
          ) : null}
        </div>

        {/* Suggested short list (3-5 items) */}
        {plan.suggested.length === 0 ? (
          plan.remaining.length > 0 ? (
            <EmptyState
              title={
                shownBudget !== null
                  ? `No suggestions fit your ${shownBudget}-minute budget.`
                  : "No suggestions fit your selected budget."
              }
              body={
                hasDecisionsToday
                  ? "Unfinished work exceeds the selected budget, and other tasks were postponed. Choose a larger budget, review remaining work below, or reset today's skips."
                  : "Unfinished work exceeds your selected time budget. Choose a larger budget, select All / Untimed, or review and start remaining work below."
              }
              action={
                <div className="row" style={{ gap: "var(--space-2)", flexWrap: "wrap", justifyContent: "center" }}>
                  {!showRemaining ? (
                    <Button size="small" onClick={() => setShowRemaining(true)}>
                      View remaining work ({plan.remaining.length})
                    </Button>
                  ) : null}
                  {hasDecisionsToday ? (
                    <Button size="small" onClick={() => void resetToday()}>
                      Reset today's skips & postponements
                    </Button>
                  ) : null}
                </div>
              }
            />
          ) : hasDecisionsToday ? (
            <EmptyState
              title="All recommended work completed or postponed for today."
              body="You've skipped or moved tasks for today. You can reset skips to restore them."
              action={
                <Button size="small" onClick={() => void resetToday()}>
                  Reset today's skips & postponements
                </Button>
              }
            />
          ) : (
            <EmptyState
              title="All recommended work completed for today."
              body="No pending actions, lesson preparations, or study materials need attention today."
            />
          )
        ) : (
          <div className="daily-plan-list" style={{ marginTop: "var(--space-4)" }}>
            {plan.suggested.map((item) => {
              const target = getStartTarget(item, sources);
              const isWhyOpen = openWhyId === item.id;

              return (
                <article className="daily-plan-item" key={item.id}>
                  <div className="daily-plan-item__main">
                    <div className="daily-plan-item__content">
                      <div className="daily-plan-item__header">
                        <Badge tone={precedenceTone(item.precedence)}>
                          {precedenceLabel(item.precedence)}
                        </Badge>
                        {item.estimatedMinutes !== null ? (
                          <span className="tiny muted row" style={{ gap: 3 }}>
                            <ClockIcon size={12} />
                            {item.estimatedMinutes} min
                          </span>
                        ) : (
                          <span className="tiny muted">Estimate unknown</span>
                        )}
                      </div>
                      <h4 className="daily-plan-item__title">{item.title}</h4>
                      <p className="daily-plan-item__explanation">{item.explanation}</p>
                    </div>

                    <div className="daily-plan-item__actions">
                      {target.isLocalAction ? (
                        <button
                          type="button"
                          className="button button--primary button--small"
                          onClick={() => handleStart(item)}
                          aria-label={target.label}
                        >
                          Start
                        </button>
                      ) : (
                        <Link
                          to={target.path}
                          className="button button--primary button--small"
                          aria-label={target.label}
                        >
                          Start
                        </Link>
                      )}

                      <button
                        type="button"
                        className="button button--ghost button--small"
                        onClick={() => setOpenWhyId(isWhyOpen ? null : item.id)}
                        aria-expanded={isWhyOpen}
                        aria-label={`Why recommend ${item.title}?`}
                      >
                        Why this
                      </button>

                      <button
                        type="button"
                        className="button button--ghost button--small"
                        onClick={() => void skipItem(item.id)}
                        aria-label={`Skip ${item.title} for today`}
                        title="Exclude from today's suggestions; eligible again tomorrow"
                      >
                        Skip today
                      </button>

                      <div className="stack" style={{ gap: 2, alignItems: "center" }}>
                        <button
                          type="button"
                          className="button button--ghost button--small"
                          onClick={() => void deferItem(item.id)}
                          aria-label={`Move ${item.title} to tomorrow`}
                          title="Postpone to tomorrow's daily plan without changing source due date"
                        >
                          Move to tomorrow
                        </button>
                        <span className="daily-plan-defer-note">Due date stays the same</span>
                      </div>
                    </div>
                  </div>

                  {/* Why this disclosure panel */}
                  {isWhyOpen ? (
                    <div className="daily-plan-why-panel">
                      <dl>
                        <dt>Reason</dt>
                        <dd>{item.reason.summary}</dd>
                        <dt>Source entity</dt>
                        <dd>
                          {item.reason.sourceType} ({item.reason.sourceId})
                        </dd>
                        <dt>Plan placement</dt>
                        <dd>{item.explanation}</dd>
                      </dl>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}

        {/* Remaining unfinished work section */}
        {plan.remaining.length > 0 ? (
          <section className="daily-plan-remaining">
            <button
              type="button"
              className="daily-plan-remaining__toggle"
              onClick={() => setShowRemaining(!showRemaining)}
              aria-expanded={showRemaining}
              aria-controls="daily-plan-remaining-list"
            >
              <span>Remaining unfinished work ({plan.remaining.length})</span>
              <span className="tiny muted">{showRemaining ? "Hide ▲" : "Show ▼"}</span>
            </button>

            {showRemaining ? (
              <div className="daily-plan-remaining__list" id="daily-plan-remaining-list">
                {plan.remaining.map((item) => {
                  const target = getStartTarget(item, sources);
                  return (
                    <div className="daily-plan-remaining-row" key={item.id}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="row" style={{ gap: "var(--space-2)", alignItems: "center" }}>
                          <Badge tone={precedenceTone(item.precedence)}>
                            {precedenceLabel(item.precedence)}
                          </Badge>
                          <span className="strong truncate">{item.title}</span>
                          {item.estimatedMinutes !== null ? (
                            <span className="tiny dim">({item.estimatedMinutes} min)</span>
                          ) : null}
                        </div>
                        <p className="tiny muted truncate" style={{ marginTop: 2 }}>
                          {item.explanation}
                        </p>
                      </div>

                      <div className="row" style={{ gap: "var(--space-1)" }}>
                        {target.isLocalAction ? (
                          <button
                            type="button"
                            className="button button--ghost button--small"
                            onClick={() => handleStart(item)}
                            aria-label={target.label}
                          >
                            Start
                          </button>
                        ) : (
                          <Link
                            to={target.path}
                            className="button button--ghost button--small"
                            aria-label={target.label}
                          >
                            Start
                          </Link>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </section>
        ) : null}
      </CardBody>
    </Card>
  );
}
