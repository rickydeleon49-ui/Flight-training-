import { describe, expect, it } from "vitest";
import { homeworkOfflineSummary, type HomeworkOfflineInput } from "./homeworkOffline";

describe("homeworkOfflineSummary", () => {
  it("handles empty activity list without summary claim", () => {
    const res = homeworkOfflineSummary({
      activities: [],
      sourceState: () => undefined,
      sourceMissing: () => false,
      checked: true,
      canCheckFiles: true,
    });

    expect(res.items).toEqual([]);
    expect(res.summary).toEqual({
      state: "empty",
      text: "",
    });
  });

  it("treats reflection, questions and checklist as always ready", () => {
    const activities = [
      { id: "1", kind: "reflection", title: "Debrief" },
      { id: "2", kind: "questions", title: "Questions for instructor" },
      { id: "3", kind: "checklist", title: "Preflight items" },
    ];

    const res = homeworkOfflineSummary({
      activities,
      sourceState: () => "missing", // Even if sourceState was returned, reflection/questions/checklist ignore it
      sourceMissing: () => true,
      checked: false, // Even when unchecked
      canCheckFiles: false,
    });

    expect(res.items).toEqual([
      { id: "1", state: "ready", text: "Works offline" },
      { id: "2", state: "ready", text: "Works offline" },
      { id: "3", state: "ready", text: "Works offline" },
    ]);
    expect(res.summary).toEqual({
      state: "ready",
      text: "Everything here works without internet.",
    });
  });

  it("checking never yields ready for read, cards, test", () => {
    const activities = [
      { id: "1", kind: "read", title: "PHAK chapter 5" },
      { id: "2", kind: "cards", title: "Airspace flashcards" },
      { id: "3", kind: "test", title: "Weather quiz" },
    ];

    const res = homeworkOfflineSummary({
      activities,
      sourceState: () => undefined,
      sourceMissing: () => false,
      checked: false,
      canCheckFiles: true,
    });

    expect(res.items).toEqual([
      { id: "1", state: "checking", text: "Checking…" },
      { id: "2", state: "checking", text: "Checking…" },
      { id: "3", state: "checking", text: "Checking…" },
    ]);
    expect(res.summary).toEqual({
      state: "checking",
      text: "Checking what works without internet…",
    });
  });

  it("marks read/cards/test with sourceMissing as fix even before checked", () => {
    const activities = [
      { id: "1", kind: "read", title: "Reading" },
      { id: "2", kind: "cards", title: "Flashcards" },
    ];

    const res = homeworkOfflineSummary({
      activities,
      sourceState: () => undefined,
      sourceMissing: (id) => id === "1",
      checked: false,
      canCheckFiles: true,
    });

    expect(res.items[0]).toEqual({ id: "1", state: "fix", text: "Needs a fix" });
    expect(res.items[1]).toEqual({ id: "2", state: "checking", text: "Checking…" });
    expect(res.summary).toEqual({
      state: "fix",
      text: "1 of 2 needs a fix before you study offline.",
    });
  });

  it.each(["cards", "test"])("marks %s with sourceMissing as fix", (kind) => {
    const result = homeworkOfflineSummary({
      activities: [{ id: "missing", kind, title: "Missing source" }],
      sourceState: () => undefined,
      sourceMissing: () => true,
      checked: true,
      canCheckFiles: true,
    });
    expect(result.items).toEqual([{ id: "missing", state: "fix", text: "Needs a fix" }]);
    expect(result.summary.text).toBe("1 of 1 needs a fix before you study offline.");
  });

  it("one unavailable read makes summary fix", () => {
    const activities = [
      { id: "1", kind: "read", title: "AFH Chapter 3" },
      { id: "2", kind: "cards", title: "Traffic pattern cards" },
    ];

    const res = homeworkOfflineSummary({
      activities,
      sourceState: (id) => (id === "1" ? "unavailable" : undefined),
      sourceMissing: () => false,
      checked: true,
      canCheckFiles: true,
    });

    expect(res.items[0]).toEqual({ id: "1", state: "fix", text: "Needs a fix" });
    expect(res.items[1]).toEqual({ id: "2", state: "ready", text: "Works offline" });
    expect(res.summary).toEqual({
      state: "fix",
      text: "1 of 2 needs a fix before you study offline.",
    });
  });

  it("marks changed and missing sourceState as fix", () => {
    const activities = [
      { id: "1", kind: "cards", title: "Cards changed" },
      { id: "2", kind: "test", title: "Quiz missing" },
    ];

    const res = homeworkOfflineSummary({
      activities,
      sourceState: (id) => (id === "1" ? "changed" : "missing"),
      sourceMissing: () => false,
      checked: true,
      canCheckFiles: true,
    });

    expect(res.items[0]).toEqual({ id: "1", state: "fix", text: "Needs a fix" });
    expect(res.items[1]).toEqual({ id: "2", state: "fix", text: "Needs a fix" });
    expect(res.summary).toEqual({
      state: "fix",
      text: "2 of 2 need a fix before you study offline.",
    });
  });

  it("browser-mode read is never ready (cannot-check)", () => {
    const activities = [
      { id: "1", kind: "read", title: "PHAK Chapter 1" },
      { id: "2", kind: "checklist", title: "Cockpit flow" },
    ];

    const res = homeworkOfflineSummary({
      activities,
      sourceState: () => undefined,
      sourceMissing: () => false,
      checked: true,
      canCheckFiles: false,
    });

    expect(res.items[0]).toEqual({ id: "1", state: "cannot-check", text: "Check in the Mac app" });
    expect(res.items[1]).toEqual({ id: "2", state: "ready", text: "Works offline" });
    expect(res.summary).toEqual({
      state: "cannot-check",
      text: "PDF readings can only be checked in the Mac app.",
    });
  });

  it("n=1 singular wording vs n>1 plural wording", () => {
    const inputSingular: HomeworkOfflineInput = {
      activities: [
        { id: "1", kind: "read", title: "R1" },
        { id: "2", kind: "read", title: "R2" },
        { id: "3", kind: "read", title: "R3" },
      ],
      sourceState: (id) => (id === "1" ? "changed" : undefined),
      sourceMissing: () => false,
      checked: true,
      canCheckFiles: true,
    };
    const resSingular = homeworkOfflineSummary(inputSingular);
    expect(resSingular.summary.text).toBe("1 of 3 needs a fix before you study offline.");

    const inputPlural: HomeworkOfflineInput = {
      ...inputSingular,
      sourceState: (id) => (id === "1" || id === "2" ? "changed" : undefined),
    };
    const resPlural = homeworkOfflineSummary(inputPlural);
    expect(resPlural.summary.text).toBe("2 of 3 need a fix before you study offline.");
  });

  it("summary precedence: any fix -> fix, else checking -> checking, else cannot-check -> cannot-check, else ready", () => {
    // fix + checking + cannot-check -> fix
    const res1 = homeworkOfflineSummary({
      activities: [
        { id: "1", kind: "test", title: "Quiz" },
        { id: "2", kind: "cards", title: "Cards" },
      ],
      sourceState: (id) => (id === "1" ? "changed" : undefined),
      sourceMissing: () => false,
      checked: false, // cards is checking
      canCheckFiles: false,
    });
    expect(res1.summary.state).toBe("fix");

    // checking + cannot-check -> checking
    const res2 = homeworkOfflineSummary({
      activities: [
        { id: "1", kind: "cards", title: "Cards" }, // checking
        { id: "2", kind: "checklist", title: "Checklist" }, // ready
      ],
      sourceState: () => undefined,
      sourceMissing: () => false,
      checked: false,
      canCheckFiles: false,
    });
    expect(res2.summary.state).toBe("checking");

    // cannot-check + ready -> cannot-check
    const res3 = homeworkOfflineSummary({
      activities: [
        { id: "1", kind: "read", title: "Read" }, // cannot-check (browser)
        { id: "2", kind: "cards", title: "Cards" }, // ready
      ],
      sourceState: () => undefined,
      sourceMissing: () => false,
      checked: true,
      canCheckFiles: false,
    });
    expect(res3.summary.state).toBe("cannot-check");

    // all healthy -> ready
    const res4 = homeworkOfflineSummary({
      activities: [
        { id: "1", kind: "read", title: "Read" },
        { id: "2", kind: "cards", title: "Cards" },
        { id: "3", kind: "test", title: "Test" },
        { id: "4", kind: "questions", title: "Questions" },
      ],
      sourceState: () => undefined,
      sourceMissing: () => false,
      checked: true,
      canCheckFiles: true,
    });
    expect(res4.summary.state).toBe("ready");
    expect(res4.summary.text).toBe("Everything here works without internet.");
  });
});
