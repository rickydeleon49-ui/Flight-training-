import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { Button, Card, CardBody, CardHeader } from "@/components/ui";
import type { MockTestRun, OralRating, PracticeQuestion } from "@/domain/types";
import { formatLongDate } from "@/lib/dates";
import { normalizeAcsTask } from "@/logic/acsTaskCatalog";
import {
  acsReadiness,
  type AcsAreaRow,
  type ReadinessAttempt,
  type ReadinessMockRow,
} from "@/logic/acsReadiness";
import { daysToCheckride } from "@/logic/checkride";
import { answerKey } from "@/logic/mockTest";
import { useAppData } from "@/state/AppDataContext";

import { ManeuverSelfCheck } from "./ManeuverSelfCheck";
import { NeedsWorkList } from "./NeedsWorkList";

import "./AcsReadinessList.css";

/** The newest finished practice attempts the list reads. */
export const ATTEMPTS_TO_READ = 20;
export const ACS_LIST_FOOTER = "Practice numbers only. Your instructor decides.";
export const NOT_ENOUGH_PRACTICE = "Not enough practice yet";

/** Same id rule as buildMockTest: the stored logical id, else material plus text. */
const questionId = (materialId: string, q: PracticeQuestion): string =>
  (q as { logicalId?: string }).logicalId ?? `${materialId}:${q.question.trim().toLowerCase()}`;

/** Answered rows of the newest finished mock, looked up in the bank. */
export function mockRowsFor(
  run: MockTestRun | undefined,
  materials: readonly { id: string }[],
  tests: readonly { sourceMaterialId: string; questions: PracticeQuestion[] }[],
): ReadinessMockRow[] {
  if (!run) return [];
  const bank = new Map<string, PracticeQuestion>();
  const known = new Set(materials.map((m) => m.id));
  for (const test of tests) {
    if (!known.has(test.sourceMaterialId)) continue;
    for (const q of test.questions) bank.set(questionId(test.sourceMaterialId, q), q);
  }
  const rows: ReadinessMockRow[] = [];
  for (const id of run.questionIds) {
    const q = bank.get(id);
    if (!q || run.answers[id] === undefined) continue;
    rows.push({ acsTask: normalizeAcsTask(q.acsTask), correct: run.answers[id] === answerKey(q.correctIndex) });
  }
  return rows;
}

export function AcsReadinessRows({ rows }: { rows: readonly AcsAreaRow[] }) {
  return (
    <ul className="acs-list">
      {rows.map((row) => (
        <li className="acs-list__row" key={row.area} data-testid={`acs-row-${row.area}`}>
          <div className="acs-list__head">
            <span className="acs-list__area tiny dim">{row.area}</span>
            <span className="small strong wrap-anywhere">{row.title}</span>
          </div>
          {row.percent === null ? (
            <p className="tiny dim">{NOT_ENOUGH_PRACTICE}</p>
          ) : (
            <div className="acs-list__meter-line">
              <meter
                className="acs-list__meter"
                min={0}
                max={100}
                value={row.percent}
                aria-label={`${row.percent} percent in practice`}
              />
              <span className="small numeric">{row.percent}%</span>
            </div>
          )}
          {row.oralRated > 0 ? (
            <p className="tiny dim">Oral: {row.oralSatisfactory} of {row.oralRated} Satisfactory</p>
          ) : null}
          {row.nextLook ? <p className="tiny">Next look: {row.nextLook}</p> : null}
        </li>
      ))}
    </ul>
  );
}

/** Per-area practice numbers at the top of the Checkride tool. A read error shows nothing. */
export function AcsReadinessList() {
  const { data, dataRevision, repositories } = useAppData();
  const sessions = repositories?.practiceSessions;
  const [attempts, setAttempts] = useState<ReadinessAttempt[] | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!sessions) {
      setAttempts(null);
      return;
    }
    let current = true;
    (async () => {
      const recent = await sessions.getRecentCompletedAttempts(ATTEMPTS_TO_READ);
      const read: ReadinessAttempt[] = [];
      for (const attempt of recent.slice(0, ATTEMPTS_TO_READ)) {
        const [items, responses] = await Promise.all([
          sessions.getItems(attempt.versionId),
          sessions.getResponses(attempt.id),
        ]);
        read.push({ items, responses });
      }
      if (current) setAttempts(read);
    })().catch(() => {
      if (current) setAttempts(null);
    });
    return () => {
      current = false;
    };
  }, [sessions, dataRevision]);

  const toolkit = data.toolkit;
  const rows = useMemo(() => {
    if (attempts === null) return null;
    const run = (toolkit.mockTest?.last ?? []).find((r) => r.finishedAt);
    const oralRatings: OralRating[] = toolkit.oralRatings ?? [];
    return acsReadiness({
      attempts,
      mockRows: mockRowsFor(run, data.materials, data.practiceTests),
      oralRatings,
    });
  }, [attempts, toolkit.mockTest, toolkit.oralRatings, data.materials, data.practiceTests]);

  if (rows === null) return null;
  const days = daysToCheckride(toolkit.checkrideDate);
  return (
    <Card variant="grouped">
      <CardHeader title="Practice by ACS area" eyebrow="From your practice answers" />
      <CardBody>
        <p className="small" data-testid="acs-list-date">
          {toolkit.checkrideDate && days !== null
            ? `Checkride ${formatLongDate(toolkit.checkrideDate)}: ${days} ${days === 1 ? "day" : "days"} to go. `
            : "No checkride date set. "}
          <Link to="/settings">Checkride date</Link>
        </p>
      </CardBody>
      <CardBody flush>
        <AcsReadinessRows rows={rows} />
      </CardBody>
      <CardBody>
        <NeedsWorkList ratings={toolkit.oralRatings ?? []} />
        <Button size="small" variant="secondary" aria-expanded={checking} onClick={() => setChecking((v) => !v)}>
          Maneuver self-check
        </Button>
        {checking ? <ManeuverSelfCheck /> : null}
        <p className="tiny dim">{ACS_LIST_FOOTER}</p>
      </CardBody>
    </Card>
  );
}
