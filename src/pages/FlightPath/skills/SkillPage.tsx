/**
 * One skill's page (scope §4.2): her status and confidence (hers alone;
 * nothing derives them), the evidence sentence in words, the fixed
 * disclaimer, and the paged evidence history with its item menu.
 */
import { Link, useParams } from "react-router-dom";

import { PageHeader } from "@/components/layout/PageHeader";
import { Badge, Card, CardBody, CardHeader, EmptyState, Field, Select } from "@/components/ui";
import { TOPIC_LABELS, type SkillStatusLabel } from "@/domain/types";
import { SKILL_DISCLAIMER, STATUS_WORDS, confidenceText, evidenceSentence, statusText } from "@/logic/skillEvidence";
import { useAppData } from "@/state/AppDataContext";
import { useSkillEvidence } from "@/state/useSkillEvidence";
import { useSkillList } from "@/state/useSkillList";

import { EvidenceList } from "./EvidenceList";
import "./skills.css";

export function SkillPage() {
  const { skillId = "" } = useParams();
  const { data } = useAppData();
  const { state, controller, available } = useSkillEvidence(skillId ? { kind: "skill", skillId } : null);
  const catalog = useSkillList({ includeRetired: true });
  const skill = catalog.state.skills.find((s) => s.id === skillId) ?? null;
  const summary = state.summary;

  if (!available || (catalog.state.status === "ready" && !skill)) {
    return (
      <>
        <PageHeader title="Skill not found" />
        <Card>
          <EmptyState
            title="That skill isn't here."
            action={
              <Link className="button button--secondary" to="/flight-path">
                Back to Flight Path
              </Link>
            }
          />
        </Card>
      </>
    );
  }

  const setStatus = (value: string) => {
    if (!summary) return;
    const status = value === "" ? null : (value as SkillStatusLabel);
    void controller.runAction(`status:${skillId}`, { status, sequence: summary.statusSequence }, (operationId) => ({
      action: "set_status", operationId, skillId, expectedSequence: summary.statusSequence, status,
    }));
  };
  const setConfidence = (value: string) => {
    if (!summary) return;
    const confidence = value === "" ? null : Number(value);
    void controller.runAction(`confidence:${skillId}`, { confidence, sequence: summary.confidenceSequence }, (operationId) => ({
      action: "set_confidence", operationId, skillId, expectedSequence: summary.confidenceSequence, confidence,
    }));
  };

  return (
    <>
      <PageHeader
        title={skill?.label ?? summary?.label ?? "Skill"}
        subtitle={skill ? `${TOPIC_LABELS[skill.topic]}${skill.origin === "builtin" ? " · Built-in" : " · Your skill"}` : undefined}
        action={
          <Link className="button button--ghost" to="/flight-path">
            Back
          </Link>
        }
      />
      <div className="detail">
        <div className="detail__column">
          <Card>
            <CardHeader title="Your record" action={skill?.retired ? <Badge>Retired</Badge> : undefined} />
            <CardBody>
              {summary ? (
                <div className="stack stack--2" aria-label="Summary">
                  <p className="small">Your status: {statusText(summary.status)}</p>
                  <Field label="Change your status">
                    <Select
                      value={summary.status ?? ""}
                      disabled={state.saving}
                      options={[
                        { value: "", label: "Not set" },
                        ...(Object.keys(STATUS_WORDS) as SkillStatusLabel[]).map((s) => ({ value: s, label: STATUS_WORDS[s] })),
                      ]}
                      onChange={setStatus}
                    />
                  </Field>
                  <p className="small">Your confidence: {confidenceText(summary.confidence)}</p>
                  <Field label="Change your confidence">
                    <Select
                      value={summary.confidence == null ? "" : String(summary.confidence)}
                      disabled={state.saving}
                      options={[{ value: "", label: "Not rated" }, ...[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} of 5` }))]}
                      onChange={setConfidence}
                    />
                  </Field>
                  <p className="small">{evidenceSentence(summary)}</p>
                </div>
              ) : state.status === "loading" ? null : (
                <p className="small muted">Your status and confidence will show here.</p>
              )}
              <p className="tiny dim skill-evidence__disclaimer">{SKILL_DISCLAIMER}</p>
            </CardBody>
          </Card>
        </div>
        <div className="detail__column">
          <Card>
            <CardHeader title="Evidence" />
            <CardBody>
              <EvidenceList
                key={skillId}
                state={state}
                controller={controller}
                actions={data.actions}
                emptyText="No observations for this skill yet. Add one from a lesson debrief."
              />
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
