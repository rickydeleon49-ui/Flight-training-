/**
 * Test-only composition of the production skill-evidence pieces (the
 * `useSkillEvidence` hook, `EvidenceList` and `ObservationForm`) with an
 * injected client, so rendered regressions control timing exactly. It has
 * the same shape as the accepted prototype specimen: a skill selector that
 * switches the list and remounts the form, the summary and the disclaimer.
 * Never imported by the app.
 */
import { createElement as h, useId, useState } from "react";

import type { SkillListEntry } from "@/domain/types";
import { SKILL_DISCLAIMER, confidenceText, evidenceSentence, statusText } from "@/logic/skillEvidence";
import { useSkillEvidence, type EvidenceClient } from "@/state/useSkillEvidence";

import { EvidenceList } from "../EvidenceList";
import { ObservationForm } from "../ObservationForm";

export interface HarnessProps {
  client: EvidenceClient;
  skills: SkillListEntry[];
  /** The debrief the form records against, or null for a skill page without a form. */
  debrief: { journalId: string; date: string; title: string } | null;
  initialSkillId: string;
}

export function SkillEvidenceHarness({ client, skills, debrief, initialSkillId }: HarnessProps) {
  const [skillId, setSkillId] = useState(initialSkillId);
  const { state, controller } = useSkillEvidence({ kind: "skill", skillId }, client);
  const ids = useId();
  return h(
    "section",
    null,
    h("label", { htmlFor: `${ids}-skill` }, "Showing skill"),
    h(
      "select",
      { id: `${ids}-skill`, value: skillId, onChange: (e: { target: { value: string } }) => setSkillId(e.target.value) },
      skills.map((s) => h("option", { key: s.id, value: s.id }, s.label)),
    ),
    state.summary
      ? h(
          "div",
          { "aria-label": "Summary" },
          h("p", null, `Your status: ${statusText(state.summary.status)}`),
          h("p", null, `Your confidence: ${confidenceText(state.summary.confidence)}`),
          h("p", null, evidenceSentence(state.summary)),
        )
      : null,
    h("p", null, SKILL_DISCLAIMER),
    debrief
      ? h(ObservationForm, {
          key: `${debrief.journalId}:${skillId}`,
          controller,
          debrief: { ...debrief, fields: ["instructor_feedback", "was_difficult"] },
          skills,
          initialSkillId: skillId,
          saving: state.saving,
        })
      : null,
    h(EvidenceList, {
      state,
      controller,
      actions: [],
      emptyText: "No observations for this skill yet. Add one from a lesson debrief.",
    }),
  );
}
