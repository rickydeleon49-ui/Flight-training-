/**
 * The Skills list inside Flight Path (scope §4.3): active skills grouped by
 * the broad topic, each with her status and the evidence sentence; retired
 * skills on request; her own skills can be added, renamed, retired and
 * restored. Built-in names come from the app and stay as they are.
 */
import { useState } from "react";
import { Link } from "react-router-dom";

import { Badge, Button, Card, CardBody, CardHeader, Dialog, Field, Select, TextArea, TextInput } from "@/components/ui";
import { TOPIC_LABELS, TOPIC_OPTIONS, type SkillListEntry, type Topic } from "@/domain/types";
import { evidenceSentence, statusText } from "@/logic/skillEvidence";
import { useSkillList, type CatalogOutcome } from "@/state/useSkillList";

import "./skills.css";

export function SkillsSection() {
  const [showRetired, setShowRetired] = useState(false);
  const catalog = useSkillList({ includeRetired: true, withSummaries: true });
  const [editing, setEditing] = useState<SkillListEntry | "new" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (!catalog.available) return null;
  const visible = catalog.state.skills.filter((s) => showRetired || !s.retired);
  const topics = [...new Set(visible.map((s) => s.topic))].sort((a, b) => TOPIC_LABELS[a].localeCompare(TOPIC_LABELS[b]));
  const retiredCount = catalog.state.skills.filter((s) => s.retired).length;

  const toggleRetired = async (skill: SkillListEntry) => {
    setMessage(null);
    const retire = !skill.retired;
    const outcome = await catalog.act(`retire:${skill.id}`, { skill: skill.id, revision: skill.revision, retire }, (operationId) => ({
      action: retire ? "retire_skill" : "restore_skill", operationId, skillId: skill.id, expectedRevision: skill.revision,
    }));
    if (outcome.kind !== "done") setMessage(outcome.message);
  };

  return (
    <Card>
      <CardHeader
        title="Skills"
        eyebrow="Your own record"
        action={
          <Button size="small" onClick={() => setEditing("new")}>
            Add your own skill
          </Button>
        }
      />
      <CardBody>
        <p className="tiny dim skill-evidence__intro">
          Your status and observations for each skill. It's your own record, not an instructor sign-off or a proficiency rating.
        </p>
        {catalog.state.status === "loading" ? <p role="status" className="small muted">Loading your skills…</p> : null}
        {catalog.state.status === "error" ? (
          <div role="alert" className="small skill-evidence__error">
            <p>We couldn't load your skills right now.</p>
            <Button size="small" onClick={() => void catalog.reload()}>
              Try again
            </Button>
          </div>
        ) : null}
        {message ? (
          <p role="alert" className="small skill-evidence__error">
            {message}
          </p>
        ) : null}
        {topics.map((topic) => (
          <section key={topic} className="skills-topic" aria-label={TOPIC_LABELS[topic]}>
            <h3 className="skills-topic__title">{TOPIC_LABELS[topic]}</h3>
            <ul className="skills-topic__list">
              {visible
                .filter((s) => s.topic === topic)
                .map((skill) => {
                  const summary = catalog.state.summaries[skill.id];
                  return (
                    <li key={skill.id} className="skills-topic__item">
                      <div className="stack stack--1">
                        <Link to={`/flight-path/skills/${encodeURIComponent(skill.id)}`}>{skill.label}</Link>
                        <span className="tiny muted">
                          {summary ? `${statusText(summary.status)} · ${evidenceSentence(summary)}` : ""}
                        </span>
                      </div>
                      <div className="row">
                        {skill.origin === "builtin" ? <Badge>Built-in</Badge> : <Badge tone="berry">Your skill</Badge>}
                        {skill.retired ? <Badge>Retired</Badge> : null}
                        {skill.origin === "custom" && !skill.retired ? (
                          <Button size="small" variant="ghost" onClick={() => setEditing(skill)}>
                            Rename
                          </Button>
                        ) : null}
                        {skill.origin === "custom" ? (
                          <Button size="small" variant="ghost" onClick={() => void toggleRetired(skill)}>
                            {skill.retired ? "Restore" : "Retire"}
                          </Button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
            </ul>
          </section>
        ))}
        {retiredCount > 0 ? (
          <Button size="small" variant="ghost" onClick={() => setShowRetired(!showRetired)}>
            {showRetired ? "Hide retired skills" : "Show retired skills"}
          </Button>
        ) : null}
      </CardBody>
      {editing ? (
        <SkillDialog
          skill={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSave={async (label, description, topic) => {
            const skill = editing === "new" ? null : editing;
            if (!skill) {
              return catalog.act("create-skill", { label, description, topic }, (operationId) => ({
                action: "create_custom_skill", operationId, skillId: `custom.${crypto.randomUUID()}`, label, description, topic,
              }));
            }
            const outcome = await catalog.act(`rename:${skill.id}`, { skill: skill.id, revision: skill.revision, label, description, topic }, (operationId) => ({
              action: "edit_custom_skill", operationId, skillId: skill.id, expectedRevision: skill.revision, label, description, topic,
            }));
            if (outcome.kind === "earlier_done" && "revision" in outcome.outcome.result) setEditing({ ...skill, revision: outcome.outcome.result.revision });
            return outcome;
          }}
        />
      ) : null}
    </Card>
  );
}

function SkillDialog({
  skill,
  onClose,
  onSave,
}: {
  skill: SkillListEntry | null;
  onClose: () => void;
  onSave: (label: string, description: string, topic: Topic) => Promise<CatalogOutcome>;
}) {
  const [label, setLabel] = useState(skill?.label ?? "");
  const [description, setDescription] = useState(skill?.description ?? "");
  const [topic, setTopic] = useState<Topic>(skill?.topic ?? "general");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setPending(true);
    setError(null);
    const outcome = await onSave(label, description, topic);
    setPending(false);
    if (outcome.kind === "done") onClose();
    else setError(outcome.message);
  };
  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!pending}
      title={skill ? "Rename your skill" : "Add your own skill"}
      description="Name it the way you think about it. Two active skills can't share a name."
      footer={
        <>
          <Button onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={pending || label.trim() === "" || Array.from(label).length > 80}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <Field label="Name">
        <TextInput disabled={pending} value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} />
      </Field>
      <Field label="Description (optional)">
        <TextArea disabled={pending} value={description} maxLength={500} rows={2} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field label="Topic">
        <Select disabled={pending} value={topic} options={TOPIC_OPTIONS} onChange={(value) => setTopic(value as Topic)} />
      </Field>
      {error ? (
        <p role="alert" className="small skill-evidence__error">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}
