import { describe, expect, it } from "vitest";

import {
  makeEvent,
  makeGoal,
  makeMilestone,
  makeProfile,
} from "@/testing/factories";
import { buildDashboard, greetingFor, type DashboardSources } from "./dashboard";

const sources = (overrides: Partial<DashboardSources> = {}): DashboardSources => ({
  profile: makeProfile(),
  actions: [],
  events: [],
  prepItems: [],
  materials: [],
  milestones: [],
  goals: [],
  checklistItems: [],
  journalEntries: [],
  questions: [],
  transactions: [],
  today: "2026-09-05",
  ...overrides,
});

describe("greetingFor", () => {
  it("greets by name, by time of day", () => {
    expect(greetingFor("Ava", new Date("2026-09-05T08:00:00"))).toBe("Good morning, Ava.");
    expect(greetingFor("Ava", new Date("2026-09-05T14:00:00"))).toBe("Good afternoon, Ava.");
    expect(greetingFor("Ava", new Date("2026-09-05T20:00:00"))).toBe("Good evening, Ava.");
  });

  it("stays warm when she has not given a name", () => {
    expect(greetingFor("", new Date("2026-09-05T08:00:00"))).toBe("Good morning.");
    expect(greetingFor("   ", new Date("2026-09-05T08:00:00"))).toBe("Good morning.");
  });
});

describe("the personal card", () => {
  it("shows nothing until she has written or added something", () => {
    expect(buildDashboard(sources()).personal).toBeNull();
  });

  it("appears once she has written her why", () => {
    const model = buildDashboard(
      sources({ profile: makeProfile({ whyNote: "My grandfather flew." }) }),
    );
    expect(model.personal).toEqual({ photo: null, whyNote: "My grandfather flew." });
  });

  it("appears for a photo alone, with no note", () => {
    const model = buildDashboard(
      sources({ profile: makeProfile({ photo: "data:image/jpeg;base64,AAAA" }) }),
    );
    expect(model.personal?.photo).toBe("data:image/jpeg;base64,AAAA");
    expect(model.personal?.whyNote).toBe("");
  });

  it("treats a whitespace-only note as nothing", () => {
    expect(buildDashboard(sources({ profile: makeProfile({ whyNote: "   " }) })).personal).toBeNull();
  });
});

describe("the dashboard as a whole", () => {
  it("reports an empty application rather than pretending otherwise", () => {
    const model = buildDashboard(sources());
    expect(model.isEmpty).toBe(true);
    expect(model.topAction).toBeNull();
    expect(model.nextFlight).toBeNull();
    expect(model.encouragement).toBeNull();
  });

  it("builds the subtitle from the certificate and current focus", () => {
    const model = buildDashboard(
      sources({ profile: makeProfile({ certificateGoal: "Private Pilot", currentFocus: "Landings" }) }),
    );
    expect(model.subtitle).toBe("Private Pilot • Current focus: Landings");
  });

  it("falls back to the milestone name when no focus is set", () => {
    const milestone = makeMilestone({ id: "m1", title: "Build Landing Confidence" });
    const model = buildDashboard(
      sources({
        profile: makeProfile({ currentFocus: "", currentMilestoneId: "m1" }),
        milestones: [milestone],
        goals: [makeGoal({ milestoneId: "m1" })],
        events: [makeEvent()],
      }),
    );
    expect(model.subtitle).toBe("Private Pilot • Current focus: Build Landing Confidence");
  });
});
