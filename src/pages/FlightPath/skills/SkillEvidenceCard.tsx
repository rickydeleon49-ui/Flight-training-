/**
 * The debrief's "Skill evidence" card (scope §4.1): this debrief's
 * observations, paged, and "Add an observation" in a <dialog> through the
 * shared Dialog (useModalDialog, with its pre-12.3 fallback).
 */
import { useState } from "react";

import { Button, Card, CardBody, CardHeader, Dialog } from "@/components/ui";
import type { JournalEntry, SkillSourceField } from "@/domain/types";
import { useAppData } from "@/state/AppDataContext";
import { useSkillEvidence } from "@/state/useSkillEvidence";
import { useSkillList } from "@/state/useSkillList";

import { EvidenceList } from "./EvidenceList";
import { ObservationForm, type DebriefSource } from "./ObservationForm";
import "./skills.css";

const FIELDS: [Exclude<SkillSourceField, "none">, keyof JournalEntry][] = [
  ["instructor_feedback", "instructorFeedback"],
  ["went_well", "wentWell"],
  ["was_difficult", "wasDifficult"],
  ["practiced", "practiced"],
];

export function SkillEvidenceCard({ entry, title }: { entry: JournalEntry; title: string }) {
  const { data } = useAppData();
  const { state, controller, available } = useSkillEvidence({ kind: "journal", journalId: entry.id });
  const skills = useSkillList();
  const [adding, setAdding] = useState(false);

  if (!available) return null;
  const debrief: DebriefSource = {
    journalId: entry.id,
    date: entry.date,
    title,
    fields: FIELDS.filter(([, key]) => String(entry[key] ?? "").trim() !== "").map(([field]) => field),
  };

  return (
    <Card>
      <CardHeader
        title="Skill evidence"
        action={
          <Button size="small" onClick={() => setAdding(true)} disabled={skills.state.skills.length === 0}>
            Add an observation
          </Button>
        }
      />
      <CardBody>
        <p className="tiny dim skill-evidence__intro">
          Note what you or your instructor said about a skill, one observation at a time. Nothing is added unless you add it.
        </p>
        <EvidenceList
          state={state}
          controller={controller}
          actions={data.actions}
          showSkill
          emptyText="No observations from this debrief yet."
        />
      </CardBody>
      <Dialog
        open={adding}
        onClose={() => {
          controller.clearNotices();
          setAdding(false);
        }}
        title="Add an observation"
        description="Write it the way it was said or the way you noticed it. You can edit it later; earlier wording stays in its history."
        footer={
          <Button
            onClick={() => {
              controller.clearNotices();
              setAdding(false);
            }}
          >
            Done
          </Button>
        }
      >
        {state.notice === "saved" ? (
          <p role="status" className="small">
            Saved.
          </p>
        ) : null}
        {state.writeError ? (
          <p role="alert" className="small skill-evidence__error">
            {state.writeError.message}
          </p>
        ) : null}
        {adding ? <ObservationForm controller={controller} debrief={debrief} skills={skills.state.skills} saving={state.saving} /> : null}
      </Dialog>
    </Card>
  );
}
