import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { PageHeader } from "@/components/layout/PageHeader";
import {
  AlertIcon,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  Loading,
} from "@/components/ui";
import type {
  CompletedHistoryItem,
  EraseHistoryAction,
  PracticeAttempt,
  PracticeHistoryGroup,
  PracticeResponse,
  PracticeTestItem,
} from "@/domain/types";
import { formatLongDate } from "@/lib/dates";
import { useAppData } from "@/state/AppDataContext";
import "./studyLibrary.css";

/**
 * Route/request generation. Bumped whenever the displayed identity changes or
 * the view unmounts, so an acknowledgement from an earlier route can never
 * update, clear or navigate the current one — including an A→B→A round trip,
 * which a key comparison alone cannot detect.
 */
function useRouteGeneration(key: string) {
  const generationRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    generationRef.current += 1;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
    };
  }, [key]);

  const begin = useCallback(() => generationRef.current, []);
  const isCurrent = useCallback(
    (generation: number) => mountedRef.current && generation === generationRef.current,
    [],
  );

  return { begin, isCurrent };
}

function errorText(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return fallback;
}

export function PracticeHistory() {
  const { historyKey, attemptId } = useParams();

  if (historyKey && attemptId) {
    return <AttemptReviewPage historyKey={historyKey} attemptId={attemptId} />;
  }

  if (historyKey) {
    return <HistoryGroupDetailPage historyKey={historyKey} />;
  }

  return <HistoryGroupsListPage />;
}

/** List all history groups (grouped by history_key). */
function HistoryGroupsListPage() {
  const { repositories } = useAppData();
  const [groups, setGroups] = useState<PracticeHistoryGroup[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { begin, isCurrent } = useRouteGeneration("groups");

  const loadGroups = useCallback(async () => {
    if (!repositories?.practiceSessions) {
      setGroups([]);
      setLoading(false);
      return;
    }
    const generation = begin();
    setLoading(true);
    setError(null);
    try {
      const result = await repositories.practiceSessions.getCompletedHistoryGroups();
      if (!isCurrent(generation)) return;
      setGroups(result);
    } catch (err) {
      if (!isCurrent(generation)) return;
      setError(errorText(err, "Failed to load practice history groups."));
    } finally {
      if (isCurrent(generation)) setLoading(false);
    }
  }, [begin, isCurrent, repositories]);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  if (loading) {
    return <Loading label="Loading practice history…" />;
  }

  if (error) {
    return (
      <Card>
        <EmptyState
          title="Could not load practice history"
          body={error}
          action={<Button onClick={() => void loadGroups()}>Retry</Button>}
        />
      </Card>
    );
  }

  return (
    <div className="stack stack--4">
      <PageHeader
        title="Practice History"
        subtitle="Completed practice test scores and review across your training materials."
        action={
          <Link to="/study" className="button button--secondary">
            Study Library
          </Link>
        }
      />

      {!groups || groups.length === 0 ? (
        <Card>
          <EmptyState
            title="No practice history yet"
            body="Complete a practice test from any study material to see your progress and past attempts here."
            action={
              <Link to="/study" className="button button--primary">
                Open Study Library
              </Link>
            }
          />
        </Card>
      ) : (
        <div className="material-grid">
          {groups.map((group) => {
            const hasMaterial = group.hasActiveMaterial;
            return (
              <Card key={group.historyKey} className="practice-history-card">
                <CardHeader
                  title={group.sourceMaterialTitle}
                  eyebrow={hasMaterial ? "Current Material" : "Source material removed"}
                />
                <CardBody>
                  <div className="stack stack--3">
                    <div className="row row--wrap row--gap-2">
                      <Badge tone={hasMaterial ? "study" : "overdue"}>
                        {group.completedCount}{" "}
                        {group.completedCount === 1 ? "completed test" : "completed tests"}
                      </Badge>
                      {group.latestScorePercent !== null && (
                        <Badge tone={group.latestScorePercent >= 80 ? "complete" : "due"}>
                          Latest: {group.latestScorePercent}%
                        </Badge>
                      )}
                    </div>
                    {group.latestCompletedAt && (
                      <p className="tiny dim">
                        Completed {formatLongDate(group.latestCompletedAt)}
                      </p>
                    )}
                    <div>
                      <Link
                        to={`/study/history/${encodeURIComponent(group.historyKey)}`}
                        className="button button--secondary button--small"
                      >
                        View attempts
                      </Link>
                    </div>
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Detail view for one historyKey group with attempts list and erase action. */
function HistoryGroupDetailPage({ historyKey }: { historyKey: string }) {
  const { repositories, data } = useAppData();
  const navigate = useNavigate();
  const [attempts, setAttempts] = useState<CompletedHistoryItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmingErase, setConfirmingErase] = useState(false);
  const [erasePending, setErasePending] = useState(false);
  const [eraseError, setEraseError] = useState<string | null>(null);
  const [unresolvedErase, setUnresolvedErase] = useState(false);

  const { begin, isCurrent } = useRouteGeneration(historyKey);

  /**
   * One erasure intent per history key. The payload lives in a ref so a second
   * confirmation inside the same render cannot allocate a new identity, and an
   * uncertain outcome keeps replaying the original operation ID. A different
   * displayed key is a different intent and is never reinterpreted as this one.
   */
  const eraseRef = useRef<{
    historyKey: string;
    action: EraseHistoryAction;
    busy: boolean;
  } | null>(null);

  // A different record is a different view: drop everything derived from the
  // previous key. The erasure intent itself stays keyed, so an in-flight call
  // for another key still cannot overlap with this one after a round trip.
  useEffect(() => {
    setAttempts(null);
    setError(null);
    setConfirmingErase(false);
    setEraseError(null);
    setErasePending(false);
    setUnresolvedErase(false);
  }, [historyKey]);

  const loadAttempts = useCallback(async () => {
    if (!repositories?.practiceSessions) {
      setAttempts([]);
      setLoading(false);
      return;
    }
    const generation = begin();
    setLoading(true);
    setError(null);
    try {
      const items = await repositories.practiceSessions.getCompletedHistory(historyKey);
      if (!isCurrent(generation)) return;
      setAttempts(items);
    } catch (err) {
      if (!isCurrent(generation)) return;
      setError(errorText(err, "Failed to load practice attempts."));
    } finally {
      if (isCurrent(generation)) setLoading(false);
    }
  }, [begin, historyKey, isCurrent, repositories]);

  useEffect(() => {
    void loadAttempts();
  }, [loadAttempts]);

  const handleEraseHistory = useCallback(async () => {
    const sessions = repositories?.practiceSessions;
    if (!sessions) return;
    const held = eraseRef.current;
    // Synchronous lock, scoped to the displayed key: two confirmations inside
    // one render issue one request, and an uncertain outcome replays its own
    // identity instead of allocating a fresh destructive operation.
    if (held && held.historyKey === historyKey) {
      if (held.busy) return;
    }
    const generation = begin();

    const actionToRun: EraseHistoryAction =
      held && held.historyKey === historyKey
        ? held.action
        : {
            action: "erase_history",
            operationId: crypto.randomUUID(),
            historyKey,
          };
    eraseRef.current = { historyKey, action: actionToRun, busy: true };
    setErasePending(true);
    setEraseError(null);

    try {
      await sessions.eraseHistory(actionToRun);
    } catch (err) {
      if (eraseRef.current?.action === actionToRun) {
        eraseRef.current = { ...eraseRef.current, busy: false };
      }
      // An obsolete acknowledgement may not touch the current view, but the
      // storage work it reported already happened and is not cancelled here.
      if (!isCurrent(generation)) return;
      setErasePending(false);
      setEraseError(errorText(err, "Failed to erase practice history."));
      setUnresolvedErase(true);
      return;
    }

    if (eraseRef.current?.action === actionToRun) {
      eraseRef.current = null;
    }
    if (!isCurrent(generation)) return;
    setErasePending(false);
    setUnresolvedErase(false);
    setEraseError(null);
    setConfirmingErase(false);
    navigate("/study/history");
  }, [begin, historyKey, isCurrent, navigate, repositories]);

  if (loading) {
    return <Loading label="Loading practice attempts…" />;
  }

  if (error) {
    return (
      <Card>
        <EmptyState
          title="Could not load practice attempts"
          body={error}
          action={<Button onClick={() => void loadAttempts()}>Retry</Button>}
        />
      </Card>
    );
  }

  const title = attempts && attempts.length > 0 ? attempts[0]?.sourceMaterialTitle : historyKey;

  const hasSourceMaterial = data.materials.some((m) => m.id === historyKey);
  // Retry must stay reachable even when a committed erase already emptied the
  // group, as long as that erasure outcome is still unresolved.
  const showEraseAction = (attempts !== null && attempts.length > 0) || unresolvedErase;

  return (
    <div className="stack stack--4">
      <div className="row row--between">
        <Link to="/study/history" className="small dim">
          ← Back to Practice History
        </Link>
        {hasSourceMaterial && (
          <Link
            to={`/study/${encodeURIComponent(historyKey)}`}
            className="button button--ghost button--small"
          >
            Open source material
          </Link>
        )}
      </div>

      <PageHeader
        title={title ?? "Practice History"}
        subtitle={
          hasSourceMaterial
            ? "Completed practice attempts for this study material."
            : "Retained completed attempts from removed study material."
        }
        action={
          showEraseAction ? (
            <Button
              variant="danger"
              disabled={erasePending}
              onClick={() => setConfirmingErase(true)}
            >
              {erasePending ? "Erasing…" : "Erase practice history"}
            </Button>
          ) : undefined
        }
      />

      {eraseError && (
        <div className="stack stack--2">
          <div className="ai-disclaimer" role="alert">
            <AlertIcon size={16} />
            <p className="tiny">{eraseError}</p>
          </div>
          {unresolvedErase && !erasePending ? (
            <div>
              <Button size="small" variant="secondary" onClick={() => void handleEraseHistory()}>
                Retry
              </Button>
            </div>
          ) : null}
        </div>
      )}

      {!attempts || attempts.length === 0 ? (
        <Card>
          <EmptyState
            title="No completed attempts"
            body="No completed practice tests were found for this record."
            action={
              <Link to="/study/history" className="button button--secondary">
                Back to Practice History
              </Link>
            }
          />
        </Card>
      ) : (
        <div className="stack stack--3">
          {attempts.map((attempt) => (
            <Card key={attempt.attemptId}>
              <CardBody>
                <div className="row row--between row--wrap">
                  <div className="stack stack--2">
                    <div className="row row--wrap row--gap-2">
                      <span className="strong">Score: {attempt.scorePercent}%</span>
                      <Badge tone={attempt.scorePercent >= 80 ? "complete" : "due"}>
                        {attempt.correctCount} of {attempt.totalQuestions} correct
                      </Badge>
                      <Badge tone="neutral">Version {attempt.versionNumber}</Badge>
                    </div>
                    <p className="tiny dim">
                      Completed {formatLongDate(attempt.completedAt)} • {attempt.answeredCount} answered
                      {attempt.dontKnowCount > 0 ? ` • ${attempt.dontKnowCount} don’t know` : ""}
                      {attempt.unansweredCount > 0 ? ` • ${attempt.unansweredCount} unanswered` : ""}
                    </p>
                  </div>
                  <div>
                    <Link
                      to={`/study/history/${encodeURIComponent(historyKey)}/${encodeURIComponent(attempt.attemptId)}`}
                      className="button button--secondary button--small"
                    >
                      Review attempt
                    </Link>
                  </div>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirmingErase}
        title="Erase practice history?"
        message={`This will permanently erase all completed and in-progress practice sessions under this history record for “${title}”. The current study material, active practice test, and PDFs are preserved for future practice. Previously exported backups are unaffected.`}
        confirmLabel="Erase history"
        destructive={true}
        pending={erasePending}
        pendingLabel="Erasing…"
        onConfirm={() => void handleEraseHistory()}
        onCancel={() => setConfirmingErase(false)}
      />
    </div>
  );
}

/** Immutable review of a specific completed attempt. */
function AttemptReviewPage({
  historyKey,
  attemptId,
}: {
  historyKey: string;
  attemptId: string;
}) {
  const { repositories } = useAppData();
  const [attempt, setAttempt] = useState<PracticeAttempt | null>(null);
  const [items, setItems] = useState<PracticeTestItem[] | null>(null);
  const [responses, setResponses] = useState<PracticeResponse[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Both route parts are identity: the same attempt under another group must
  // be revalidated, not assumed.
  const { begin, isCurrent } = useRouteGeneration(`${historyKey}|${attemptId}`);

  useEffect(() => {
    setAttempt(null);
    setItems(null);
    setResponses(null);
    setError(null);
  }, [attemptId, historyKey]);

  const loadAttemptData = useCallback(async () => {
    if (!repositories?.practiceSessions) {
      setLoading(false);
      return;
    }
    const generation = begin();
    setLoading(true);
    setError(null);
    try {
      const att = await repositories.practiceSessions.getAttempt(attemptId);
      if (!isCurrent(generation)) return;
      if (!att) {
        setError("Practice attempt not found.");
        return;
      }
      if (att.status !== "completed") {
        setError("Attempt is not completed.");
        return;
      }
      const ver = await repositories.practiceSessions.getVersion(att.versionId);
      if (!isCurrent(generation)) return;
      if (!ver || ver.historyKey !== historyKey) {
        setError("Practice attempt does not belong to this study material.");
        return;
      }
      const [itms, resps] = await Promise.all([
        repositories.practiceSessions.getItems(att.versionId),
        repositories.practiceSessions.getResponses(attemptId),
      ]);
      if (!isCurrent(generation)) return;
      setAttempt(att);
      setItems(itms);
      setResponses(resps);
    } catch (err) {
      if (!isCurrent(generation)) return;
      setError(errorText(err, "Failed to load attempt review."));
    } finally {
      if (isCurrent(generation)) setLoading(false);
    }
  }, [attemptId, begin, historyKey, isCurrent, repositories]);

  useEffect(() => {
    void loadAttemptData();
  }, [loadAttemptData]);

  if (loading) {
    return <Loading label="Loading attempt review…" />;
  }

  if (error || !attempt) {
    return (
      <Card>
        <EmptyState
          title="Could not load attempt review"
          body={error ?? "Attempt not found"}
          action={
            <div className="row row--gap-2">
              <Button onClick={() => void loadAttemptData()}>Retry</Button>
              <Link
                to={`/study/history/${encodeURIComponent(historyKey)}`}
                className="button button--secondary"
              >
                Back to attempts
              </Link>
            </div>
          }
        />
      </Card>
    );
  }

  const responseMap = new Map<string, PracticeResponse>();
  if (responses) {
    for (const r of responses) {
      responseMap.set(r.itemId, r);
    }
  }

  const score = attempt.scorePercent ?? 0;
  const disclaimer = `Practice result from your material (${score}%). Not an official FAA knowledge test score or certification of flight readiness.`;

  return (
    <div className="stack stack--4">
      <div>
        <Link
          to={`/study/history/${encodeURIComponent(historyKey)}`}
          className="small dim"
        >
          ← Back to attempts
        </Link>
      </div>

      <PageHeader
        title={`Review: ${attempt.sourceMaterialTitle}`}
        subtitle={
          attempt.completedAt
            ? `Completed ${formatLongDate(attempt.completedAt)}`
            : "Practice attempt"
        }
      />

      <Card>
        <CardBody>
          <div className="stack stack--3">
            <div className="row row--between row--wrap">
              <div>
                <p className="eyebrow">Overall Score</p>
                <h2 className="ai-guide__title">{score}%</h2>
              </div>
              <div className="row row--wrap row--gap-2" style={{ alignSelf: "center" }}>
                <Badge tone="complete">{attempt.correctCount} correct</Badge>
                <Badge tone="overdue">{attempt.incorrectCount} incorrect</Badge>
                <Badge tone="neutral">{attempt.dontKnowCount} don't know</Badge>
                <Badge tone="due">
                  {attempt.totalQuestions - attempt.answeredCount} unanswered
                </Badge>
              </div>
            </div>

            <div className="ai-disclaimer" role="note">
              <AlertIcon size={16} />
              <p className="tiny">{disclaimer}</p>
            </div>
          </div>
        </CardBody>
      </Card>

      <div className="stack stack--3">
        <h3 className="ai-guide__title">Questions & Answers</h3>
        {items &&
          items.map((item, idx) => {
            const resp = responseMap.get(item.id);
            const userChoice = resp ? resp.selectedIndex : null;
            const isDontKnow = resp ? resp.isDontKnow : false;
            const wasAnswered = resp !== undefined;
            const isCorrect = wasAnswered && !isDontKnow && userChoice === item.correctIndex;

            let resultTone: "complete" | "overdue" | "due" = "overdue";
            let resultLabel = "Incorrect";
            if (!wasAnswered) {
              resultTone = "due";
              resultLabel = "Unanswered";
            } else if (isDontKnow) {
              resultTone = "due";
              resultLabel = "Marked as don't know";
            } else if (isCorrect) {
              resultTone = "complete";
              resultLabel = "Correct";
            }

            return (
              <Card key={item.id}>
                <CardHeader
                  title={`Question ${idx + 1} of ${items.length}`}
                  eyebrow={item.sourcePage ? `Source p. ${item.sourcePage}` : "Check source"}
                  action={<Badge tone={resultTone}>{resultLabel}</Badge>}
                />
                <CardBody>
                  <div className="stack stack--3">
                    <p className="small strong">{item.questionText}</p>

                    <div
                      className="stack stack--2"
                      role="radiogroup"
                      aria-label={`Question ${idx + 1} options`}
                    >
                      {item.options.map((opt, optIdx) => {
                        const isThisCorrect = optIdx === item.correctIndex;
                        const isThisSelected = optIdx === userChoice;

                        let optionClass = "practice-option";
                        if (isThisCorrect) {
                          optionClass += " practice-option--correct";
                        } else if (isThisSelected) {
                          optionClass += " practice-option--incorrect";
                        }

                        return (
                          <div
                            key={optIdx}
                            className={optionClass}
                            style={{ display: "flex", justifyContent: "space-between" }}
                          >
                            <span>{opt}</span>
                            <span>
                              {isThisCorrect && " (Correct answer)"}
                              {isThisSelected && !isThisCorrect && " (Your choice)"}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    {item.explanation && <p className="tiny dim ai-copy">{item.explanation}</p>}
                  </div>
                </CardBody>
              </Card>
            );
          })}
      </div>
    </div>
  );
}
