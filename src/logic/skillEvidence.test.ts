import { describe, expect, it } from "vitest";

import type { EvidenceItem } from "@/domain/types";

import {
  ATTRIBUTION_CHOICES,
  COMPLETION_IS_NOT_ADDRESSED,
  EVIDENCE_THRESHOLD,
  SKILL_DISCLAIMER,
  actionText,
  attributionText,
  confidenceText,
  evidenceLevel,
  evidenceSentence,
  refusalText,
  sourceText,
  statusText,
} from "./skillEvidence";

const base: EvidenceItem = {
  id: "o1",
  skillId: "builtin.normal_landing",
  skillLabel: "Normal approach and landing",
  skillLabelAtRecording: "Normal approach and landing",
  skillRetired: false,
  wording: "Flare later.",
  observedOn: "2026-10-01",
  attribution: "instructor_transcribed",
  instructorName: "",
  revision: 1,
  source: { kind: "present", journalId: "j1", currentTitle: "Pattern work", currentDate: "2026-10-01", renamed: false, textChanged: null },
  sourceSnapshot: { title: "Pattern work", date: "2026-10-01", field: "none" },
  action: { kind: "none" },
  addressedAt: null,
  createdAt: "2026-10-10T09:00:00.000Z",
  updatedAt: "2026-10-10T09:00:00.000Z",
};

describe("evidence level (M3-D9)", () => {
  it("is none, limited below 3 observations or 2 lessons, recorded otherwise", () => {
    expect(EVIDENCE_THRESHOLD).toEqual({ observations: 3, debriefs: 2 });
    expect(evidenceLevel(0, 0)).toBe("none");
    expect(evidenceLevel(1, 1)).toBe("limited");
    expect(evidenceLevel(2, 2)).toBe("limited");
    expect(evidenceLevel(3, 1)).toBe("limited");
    expect(evidenceLevel(10, 1)).toBe("limited");
    expect(evidenceLevel(3, 2)).toBe("recorded");
  });

  it("is told in words, never as a score", () => {
    expect(evidenceSentence({ evidence: "none", observationCount: 0, distinctDebriefs: 0 })).toBe("No observations yet.");
    expect(evidenceSentence({ evidence: "limited", observationCount: 2, distinctDebriefs: 2 })).toBe(
      "Only a few observations so far: not enough to show a pattern.",
    );
    expect(evidenceSentence({ evidence: "recorded", observationCount: 5, distinctDebriefs: 3 })).toBe("5 observations from 3 lessons.");
    for (const text of [
      evidenceSentence({ evidence: "recorded", observationCount: 5, distinctDebriefs: 3 }),
      SKILL_DISCLAIMER,
    ]) {
      expect(text).not.toMatch(/%|score|ready|proficient/i);
    }
  });
});

describe("her own labels (M3-D2, D3)", () => {
  it("status and confidence default to not set and not rated", () => {
    expect(statusText(null)).toBe("Not set");
    expect(statusText("needs_review")).toBe("Needs review");
    expect(confidenceText(null)).toBe("Not rated");
    expect(confidenceText(4)).toBe("4 of 5");
  });

  it("attribution is only her own note or instructor feedback as she wrote it down", () => {
    expect(Object.keys(ATTRIBUTION_CHOICES).sort()).toEqual(["instructor_transcribed", "self_report"]);
    expect(attributionText({ attribution: "self_report", instructorName: "" })).toBe("Your note");
    expect(attributionText({ attribution: "instructor_transcribed", instructorName: "" })).toBe("Instructor feedback, as you wrote it down");
    expect(attributionText({ attribution: "instructor_transcribed", instructorName: "Sam" })).toBe(
      "Instructor feedback, as you wrote it down (Sam)",
    );
  });

  it("no wording claims verification, proficiency, readiness or sign-off", () => {
    const all = [
      ...Object.values(ATTRIBUTION_CHOICES),
      attributionText({ attribution: "instructor_transcribed", instructorName: "Sam" }),
      statusText("learning"), statusText("practicing"), statusText("needs_review"),
    ].join(" ");
    expect(all).not.toMatch(/verified|proficient|ready|sign-off|signed off|endorse|certif/i);
    expect(SKILL_DISCLAIMER).toBe("This is your own record. It isn't an instructor sign-off or a proficiency rating.");
  });
});

describe("source and action lines (M3-D6, D8)", () => {
  it("describes a present, renamed, edited or deleted debrief", () => {
    expect(sourceText(base)).toBe("From “Pattern work”, 2026-10-01");
    expect(
      sourceText({ ...base, source: { ...base.source, kind: "present", currentTitle: "Pattern, renamed", renamed: true, textChanged: true } as EvidenceItem["source"] }),
    ).toBe("From “Pattern, renamed”, 2026-10-01 (called “Pattern work” when you recorded this) · The debrief has been edited since you recorded this.");
    expect(sourceText({ ...base, source: { kind: "deleted", sourceJournalId: "j1" } })).toBe(
      "From a debrief that was deleted: “Pattern work”, 2026-10-01",
    );
  });

  it("a completed follow-up says finishing it doesn't mean it was resolved in flight", () => {
    expect(actionText(base)).toBeNull();
    expect(actionText({ ...base, action: { kind: "linked", actionId: "a1", title: "Review flare", actionStatus: "open" } })).toBe(
      "Follow-up: “Review flare” (still to do)",
    );
    expect(actionText({ ...base, action: { kind: "linked", actionId: "a1", title: "Review flare", actionStatus: "completed" } })).toBe(
      `Follow-up “Review flare” is done. ${COMPLETION_IS_NOT_ADDRESSED}`,
    );
    expect(COMPLETION_IS_NOT_ADDRESSED).toBe("Finishing it doesn't mean this was resolved in flight.");
    expect(actionText({ ...base, action: { kind: "deleted", formerActionId: "a1", formerTitle: "Review flare" } })).toBe(
      "Follow-up “Review flare” was deleted.",
    );
  });

  it("refusals are plain words, never engine text", () => {
    expect(refusalText("STALE_REVISION")).toMatch(/Reload/);
    // A lost answer may or may not have landed: the words never claim either.
    expect(refusalText("STORAGE_FAILURE")).toBe("We couldn't confirm that change. Refresh to see what's saved, then try again if you need to.");
    expect(refusalText("SQLITE_BUSY")).not.toMatch(/SQLITE/);
  });
});
