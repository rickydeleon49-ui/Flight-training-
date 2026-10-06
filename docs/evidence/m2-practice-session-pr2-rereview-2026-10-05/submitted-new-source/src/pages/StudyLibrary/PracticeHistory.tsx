import { useEffect, useRef, useState } from "react";
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
  PracticeAttempt,
  PracticeHistoryGroup,
  PracticeResponse,
  PracticeTestItem,
} from "@/domain/types";
import { formatLongDate } from "@/lib/dates";
import { useAppData } from "@/state/AppDataContext";
import "./studyLibrary.css";

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

  const loadGroups = async () => {
    if (!repositories?.practiceSessions) {
      setGroups([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await repositories.practiceSessions.getCompletedHistoryGroups();
      setGroups(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load practice history groups.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadGroups();
  }, [repositories]);

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
                  eyebrow={
                    hasMaterial
                      ? "Current Material"
                      : "Source material removed"
                  }
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
  const [erasing, setErasing] = useState(false);
  const [eraseError, setEraseError] = useState<string | null>(null);
  const [pendingEraseAction, setPendingEraseAction] = useState<{
    action: "erase_history";
    operationId: string;
    historyKey: string;
  } | null>(null);

  const currentKeyRef = useRef(historyKey);
  useEffect(() => {
    currentKeyRef.current = historyKey;
    setAttempts(null);
    setError(null);
    setConfirmingErase(false);
    setPendingEraseAction(null);
    setEraseError(null);
    setErasing(false);
  }, [historyKey]);

  const loadAttempts = async () => {
    if (!repositories?.practiceSessions) {
      setAttempts([]);
      setLoading(false);
      return;
    }
    const targetKey = historyKey;
    setLoading(true);
    setError(null);
    try {
      const items = await repositories.practiceSessions.getCompletedHistory(targetKey);
      if (currentKeyRef.current !== targetKey) return;
      setAttempts(items);
    } catch (err) {
      if (currentKeyRef.current !== targetKey) return;
      setError(err instanceof Error ? err.message : "Failed to load practice attempts.");
    } finally {
      if (currentKeyRef.current === targetKey) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    void loadAttempts();
  }, [historyKey, repositories]);

  const handleEraseHistory = async () => {
    if (!repositories?.practiceSessions || erasing) return;
    setErasing(true);
    setEraseError(null);
    const actionToRun = pendingEraseAction ?? {
      action: "erase_history" as const,
      operationId: crypto.randomUUID(),
      historyKey,
    };
    setPendingEraseAction(actionToRun);
    try {
      await repositories.practiceSessions.eraseHistory(actionToRun);
      setPendingEraseAction(null);
      setConfirmingErase(false);
      navigate("/study/history");
    } catch (err) {
      setEraseError(err instanceof Error ? err.message : "Failed to erase practice history.");
      setErasing(false);
    }
  };

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

  const title =
    attempts && attempts.length > 0
      ? attempts[0]?.sourceMaterialTitle
      : historyKey;

  const hasSourceMaterial = data.materials.some((m) => m.id === historyKey);

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
          attempts && attempts.length > 0 ? (
            <Button
              variant="danger"
              disabled={erasing}
              onClick={() => setConfirmingErase(true)}
            >
              {erasing ? "Erasing…" : "Erase practice history"}
            </Button>
          ) : undefined
        }
      />

      {eraseError && (
        <div className="ai-disclaimer" role="alert">
          <AlertIcon size={16} />
          <p className="tiny">{eraseError}</p>
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
                      <span className="strong">
                        Score: {attempt.scorePercent}%
                      </span>
                      <Badge
                        tone={attempt.scorePercent >= 80 ? "complete" : "due"}
                      >
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

  const currentAttemptIdRef = useRef(attemptId);
  const currentKeyRef = useRef(historyKey);

  useEffect(() => {
    currentAttemptIdRef.current = attemptId;
    currentKeyRef.current = historyKey;
    setAttempt(null);
    setItems(null);
    setResponses(null);
    setError(null);
  }, [attemptId, historyKey]);

  const loadAttemptData = async () => {
    if (!repositories?.practiceSessions) {
      setLoading(false);
      return;
    }
    const targetAttemptId = attemptId;
    const targetKey = historyKey;
    setLoading(true);
    setError(null);
    try {
      const att = await repositories.practiceSessions.getAttempt(targetAttemptId);
      if (currentAttemptIdRef.current !== targetAttemptId || currentKeyRef.current !== targetKey) return;
      if (!att) {
        setError("Practice attempt not found.");
        setLoading(false);
        return;
      }
      if (att.status !== "completed") {
        setError("Attempt is not completed.");
        setLoading(false);
        return;
      }
      const ver = await repositories.practiceSessions.getVersion(att.versionId);
      if (currentAttemptIdRef.current !== targetAttemptId || currentKeyRef.current !== targetKey) return;
      if (!ver || ver.historyKey !== targetKey) {
        setError("Practice attempt does not belong to this study material.");
        setLoading(false);
        return;
      }
      setAttempt(att);
      const [itms, resps] = await Promise.all([
        repositories.practiceSessions.getItems(att.versionId),
        repositories.practiceSessions.getResponses(targetAttemptId),
      ]);
      if (currentAttemptIdRef.current !== targetAttemptId || currentKeyRef.current !== targetKey) return;
      setItems(itms);
      setResponses(resps);
    } catch (err) {
      if (currentAttemptIdRef.current !== targetAttemptId || currentKeyRef.current !== targetKey) return;
      setError(err instanceof Error ? err.message : "Failed to load attempt review.");
    } finally {
      if (currentAttemptIdRef.current === targetAttemptId && currentKeyRef.current === targetKey) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    void loadAttemptData();
  }, [attemptId, repositories]);

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
                  eyebrow={
                    item.sourcePage ? `Source p. ${item.sourcePage}` : "Check source"
                  }
                  action={<Badge tone={resultTone}>{resultLabel}</Badge>}
                />
                <CardBody>
                  <div className="stack stack--3">
                    <p className="small strong">{item.questionText}</p>

                    <div className="stack stack--2" role="radiogroup" aria-label={`Question ${idx + 1} options`}>
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

                    {item.explanation && (
                      <p className="tiny dim ai-copy">{item.explanation}</p>
                    )}
                  </div>
                </CardBody>
              </Card>
            );
          })}
      </div>
    </div>
  );
}
