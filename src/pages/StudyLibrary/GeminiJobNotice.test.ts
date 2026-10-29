// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GeminiJobNotice } from "./GeminiJobNotice";
import { isNewerJob, type GeminiJob, type useGeminiJobs } from "@/state/GeminiJobs";
import {
  sectionGuideError,
  SectionGuideError,
  SECTION_GUIDE_MESSAGES,
  type GeneratedPracticeTest,
  type GeneratedStudyAid,
  type SectionGuideRequest,
} from "@/services/gemini";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function createMockJobs(jobList: GeminiJob[]): ReturnType<typeof useGeminiJobs> {
  return {
    jobs: jobList,
    busy: false,
    recovery: "ready",
    locked: () => false,
    activeKey: () => null,
    findJob: (kind: GeminiJob["kind"], materialId: string) =>
      jobList.find((j) => j.kind === kind && j.materialId === materialId),
    jobForMaterial: (materialId: string) => jobList.find((j) => j.materialId === materialId),
    start: vi.fn().mockResolvedValue(undefined),
    saveAgain: vi.fn().mockResolvedValue(undefined),
    dismiss: vi.fn().mockResolvedValue(undefined),
    retryLast: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
    clearFailed: vi.fn().mockResolvedValue(undefined),
    recoverFailedSave: vi.fn().mockResolvedValue(undefined),
    continueGuide: vi.fn().mockResolvedValue(undefined),
    checkAgain: vi.fn().mockResolvedValue(undefined),
    enqueue: vi.fn().mockResolvedValue(undefined),
    cancelQueued: vi.fn().mockResolvedValue(undefined),
    startQueued: vi.fn().mockResolvedValue(undefined),
  } as unknown as ReturnType<typeof useGeminiJobs>;
}

const defaultRequest: SectionGuideRequest = {
  materialId: "m1",
  relativePath: "documents/m1.pdf",
  chosenPages: [1, 2, 3, 4, 5],
  baseRevision: null,
};

function draft(ready: number, total: number) {
  return { ready, total, request: defaultRequest };
}

function baseJob(overrides: Partial<GeminiJob> = {}): GeminiJob {
  return {
    key: "job-1",
    jobId: "section-job-1",
    materialId: "m1",
    filePath: "documents/m1.pdf",
    kind: "study-aid",
    sectionGuide: true,
    phase: "failed",
    sectionError: "SOURCE_CHANGED",
    sections: draft(2, 5),
    local: true,
    createdAt: 1000,
    startedAt: 1000,
    progress: null,
    error: null,
    answer: null,
    contentSha256: null,
    baseRevision: null,
    checkpointed: false,
    cancelRequested: false,
    cancelAttempted: false,
    cancelError: null,
    ...overrides,
  };
}

describe("GeminiJobNotice frontend tests", () => {
  describe("1. Stale notice suppression with isNewerJob", () => {
    it("with two section-guide study-aid jobs for the same material, only the newer job's notice renders", () => {
      const olderJob = baseJob({
        key: "job-older",
        materialId: "m1",
        createdAt: 1000,
        startedAt: 1000,
        sectionError: "SOURCE_CHANGED",
        sections: draft(1, 5),
        jobId: "old-id",
      });
      const newerJob = baseJob({
        key: "job-newer",
        materialId: "m1",
        createdAt: 2000,
        startedAt: 2000,
        sectionError: "SOURCE_CHANGED",
        sections: draft(3, 5),
        jobId: "new-id",
      });

      expect(isNewerJob(newerJob, olderJob)).toBe(true);
      expect(isNewerJob(olderJob, newerJob)).toBe(false);

      const jobs = createMockJobs([olderJob, newerJob]);

      // The older job's notice does not render (Keep / Start buttons not shown)
      const { container: olderContainer } = render(h(GeminiJobNotice, { job: olderJob, jobs }));
      expect(olderContainer.firstChild).toBeNull();
      expect(screen.queryByRole("button", { name: "Keep my earlier work" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Start a new guide" })).toBeNull();
      cleanup();

      // The newer job's notice renders
      const { container: newerContainer } = render(h(GeminiJobNotice, { job: newerJob, jobs }));
      expect(newerContainer.firstChild).not.toBeNull();
      expect(screen.getByRole("button", { name: "Keep my earlier work" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Start a new guide" })).toBeTruthy();
      cleanup();

      // When both are mounted in a container, only the newer job's notice renders
      render(
        h(
          "div",
          null,
          h(GeminiJobNotice, { job: olderJob, jobs }),
          h(GeminiJobNotice, { job: newerJob, jobs }),
        ),
      );
      expect(screen.getAllByRole("button", { name: "Keep my earlier work" })).toHaveLength(1);
      expect(screen.getAllByRole("button", { name: "Start a new guide" })).toHaveLength(1);
    });

    it("with one job, its notice renders as before", () => {
      const singleJob = baseJob({
        key: "job-single",
        materialId: "m1",
        createdAt: 1000,
        sectionError: "SOURCE_CHANGED",
      });
      const jobs = createMockJobs([singleJob]);

      const { container } = render(h(GeminiJobNotice, { job: singleJob, jobs }));
      expect(container.firstChild).not.toBeNull();
      expect(screen.getByRole("button", { name: "Keep my earlier work" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Start a new guide" })).toBeTruthy();
    });
  });

  describe("2. PLAN_CHANGED error notice and choices", () => {
    it("shows app update wording and the same Keep/Start choices as SOURCE_CHANGED", () => {
      const planJob = baseJob({
        key: "job-plan",
        sectionError: "PLAN_CHANGED",
        sections: draft(2, 5),
      });
      const jobs = createMockJobs([planJob]);

      render(h(GeminiJobNotice, { job: planJob, jobs }));

      expect(
        screen.getByText(
          "Her Flight Deck was updated since this guide started. Keep your earlier sections, or start a new guide?",
        ),
      ).toBeTruthy();
      const keepBtn = screen.getByRole("button", { name: "Keep my earlier work" });
      const startBtn = screen.getByRole("button", { name: "Start a new guide" });
      expect(keepBtn).toBeTruthy();
      expect(startBtn).toBeTruthy();

      fireEvent.click(startBtn);
      expect(jobs.continueGuide).toHaveBeenCalledWith("job-plan", true);
    });

    it("Keep my earlier work preserves earlier sections and updates notice text", () => {
      const planJob = baseJob({
        key: "job-plan-keep",
        sectionError: "PLAN_CHANGED",
        sections: draft(2, 5),
      });
      const jobs = createMockJobs([planJob]);

      render(h(GeminiJobNotice, { job: planJob, jobs }));
      fireEvent.click(screen.getByRole("button", { name: "Keep my earlier work" }));

      expect(
        screen.getByText("Your finished sections are here. Continue when you're ready."),
      ).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Keep my earlier work" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Start a new guide" })).toBeNull();
    });

    it("a real SOURCE_CHANGED still shows 'This PDF or your chosen pages changed…'", () => {
      const sourceJob = baseJob({
        key: "job-source",
        sectionError: "SOURCE_CHANGED",
        sections: draft(2, 5),
      });
      const jobs = createMockJobs([sourceJob]);

      render(h(GeminiJobNotice, { job: sourceJob, jobs }));

      expect(
        screen.getByText(
          "This PDF or your chosen pages changed. Keep your earlier work, or start a new guide?",
        ),
      ).toBeTruthy();
      expect(screen.getByRole("button", { name: "Keep my earlier work" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Start a new guide" })).toBeTruthy();
    });
  });

  describe("3. Time limit mapping and notice", () => {
    const timeLimitMsg =
      "This took longer than 15 minutes, so Her Flight Deck paused. Your finished sections are kept — Try again to continue.";

    it("the native 15-minute message maps to STAGE_TIMEOUT (sectionGuideError)", () => {
      const err = sectionGuideError({ code: "GUIDE_PAUSED", message: timeLimitMsg });
      expect(err).toBeInstanceOf(SectionGuideError);
      expect(err.code).toBe("STAGE_TIMEOUT");
      expect(SECTION_GUIDE_MESSAGES[err.code]).toBe(
        "This step took longer than expected. Your finished sections are kept.",
      );
      expect(sectionGuideError(timeLimitMsg).code).toBe("STAGE_TIMEOUT");
    });

    it("the notice says the finished sections are kept", () => {
      const err = sectionGuideError({ code: "GUIDE_PAUSED", message: timeLimitMsg });
      const timeoutJob = baseJob({
        key: "job-timeout",
        sectionError: err.code,
        sections: draft(3, 7),
        jobId: "timeout-job-id",
      });
      const jobs = createMockJobs([timeoutJob]);

      render(h(GeminiJobNotice, { job: timeoutJob, jobs }));

      const alert = screen.getByRole("alert");
      expect(alert.textContent).toContain("Your finished sections are kept.");
      expect(
        screen.getByText("This step took longer than expected. Your finished sections are kept."),
      ).toBeTruthy();
      expect(
        screen.getByText("Your 3 finished sections are saved. Try again to continue with section 4."),
      ).toBeTruthy();
      expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(jobs.continueGuide).toHaveBeenCalledWith("job-timeout", false);
    });
  });

  describe("4. An answer waiting to be saved says what is ready", () => {
    const provenance =
      `Source SHA-256: ${"b".repeat(64)} sections: [{"id":"section-01","heading":"Airspace classes","pageStart":12,"pageEnd":18},` +
      `{"id":"section-02","heading":"Clouds and visibility","pageStart":19,"pageEnd":24}]`;

    const guideAnswer: GeneratedStudyAid = {
      title: "Airspace and weather",
      summary: "Synthetic summary.",
      sections: [
        { heading: "Airspace classes", body: "Synthetic body." },
        { heading: "Clouds", body: "Synthetic body." },
        { heading: "Wind", body: "Synthetic body." },
      ],
      flashcards: [
        { front: "Class B?", back: "Synthetic.", sourcePage: 3 },
        { front: "Cumulus?", back: "Synthetic.", sourcePage: null },
      ],
      sourceNotes: provenance,
      model: "gemini-3.5-flash",
    };

    /** A finished answer she has not saved yet — the "ready to save" notice. */
    function ready(overrides: Partial<GeminiJob> = {}): GeminiJob {
      return baseJob({
        phase: "recovered",
        local: true,
        sectionError: undefined,
        answer: guideAnswer,
        ...overrides,
      });
    }

    it("a section guide says how many sections are ready, names no hashes or JSON, and keeps Save under it", () => {
      const job = ready({ key: "job-ready-guide", sections: draft(3, 3) });
      const jobs = createMockJobs([job]);
      render(h(GeminiJobNotice, { job, jobs }));

      const summary = screen.getByText("3 sections, ready to review and save.");
      expect(summary).toBeTruthy();
      expect(screen.getByText(/Your new study guide is ready\./)).toBeTruthy();
      expect(screen.getByText(/It has not been saved yet\./)).toBeTruthy();
      expect(document.body.textContent).not.toContain("SHA-256");
      expect(document.body.textContent).not.toContain("section-01");
      expect(document.body.textContent).not.toContain(provenance);

      const save = screen.getByRole("button", { name: "Save the new study guide" });
      expect(save.closest(".stack")?.textContent).toContain("3 sections, ready to review and save.");
      expect(summary.nextElementSibling?.querySelector("button")).toBe(save);
      fireEvent.click(save);
      expect(jobs.saveAgain).toHaveBeenCalledWith("job-ready-guide");
    });

    it.each([
      ["gemini-3.8-flash", "Gemini 3.8 Flash"],
      ["gemini-3.5-flash", "Gemini 3.5 Flash"],
    ])("names the produced-by model %s on the unsaved draft", (model, name) => {
      const job = ready({ answer: { ...guideAnswer, model }, sections: draft(3, 3) });
      render(h(GeminiJobNotice, { job, jobs: createMockJobs([job]) }));
      expect(screen.getByText(`Made with ${name}.`)).toBeTruthy();
      expect(screen.getByText("3 sections, ready to review and save.")).toBeTruthy();
    });

    it("uses the existing neutral notice for a ready draft, without a warning icon", () => {
      const job = ready();
      render(h(GeminiJobNotice, { job, jobs: createMockJobs([job]) }));
      const notice = screen.getByRole("status");
      expect(notice.classList.contains("file-row")).toBe(true);
      expect(notice.classList.contains("ai-disclaimer")).toBe(false);
      expect(notice.querySelector("svg")).toBeNull();
    });

    it("a finished flashcard set counts the cards and says flashcards", () => {
      const answer: GeneratedStudyAid = {
        ...guideAnswer,
        flashcards: Array.from({ length: 12 }, (_, index) => ({
          front: `Front ${index}`,
          back: "Synthetic.",
          sourcePage: null,
        })),
      };
      const job = ready({
        key: "job-ready-cards",
        kind: "flashcards",
        sectionGuide: false,
        sections: undefined,
        answer,
      });
      const jobs = createMockJobs([job]);
      render(h(GeminiJobNotice, { job, jobs }));

      expect(screen.getByText("12 flashcards ready.")).toBeTruthy();
      expect(screen.getByText(/Your new flashcards are ready\./)).toBeTruthy();
      expect(document.body.textContent).not.toContain("SHA-256");
      const save = screen.getByRole("button", { name: "Save the new flashcards" });
      expect(save.closest(".stack")?.textContent).toContain("12 flashcards ready.");
      fireEvent.click(save);
      expect(jobs.saveAgain).toHaveBeenCalledWith("job-ready-cards");
    });

    it("a finished practice test counts the questions and says practice test", () => {
      const answer: GeneratedPracticeTest = {
        title: "Airspace practice test",
        questions: Array.from({ length: 8 }, (_, index) => ({
          question: `Question ${index}?`,
          options: ["Synthetic", "Also synthetic"],
          correctIndex: 0,
          explanation: "Synthetic.",
          sourcePage: null,
        })),
        model: "gemini-3.5-flash",
      };
      const job = ready({
        key: "job-ready-test",
        kind: "practice-test",
        sectionGuide: false,
        sections: undefined,
        answer,
      });
      const jobs = createMockJobs([job]);
      render(h(GeminiJobNotice, { job, jobs }));

      expect(screen.getByText("8 questions ready.")).toBeTruthy();
      expect(screen.getByText(/Your new practice test is ready\./)).toBeTruthy();
      expect(screen.getByText(/completed practice history is kept\./)).toBeTruthy();
      const save = screen.getByRole("button", { name: "Save the new practice test" });
      expect(save.closest(".stack")?.textContent).toContain("8 questions ready.");
      fireEvent.click(save);
      expect(jobs.saveAgain).toHaveBeenCalledWith("job-ready-test");
    });

    it("one finished section reads in the singular", () => {
      const answer: GeneratedStudyAid = { ...guideAnswer, sections: guideAnswer.sections.slice(0, 1) };
      const job = ready({ key: "job-ready-one", sections: draft(1, 1), answer });
      render(h(GeminiJobNotice, { job, jobs: createMockJobs([job]) }));
      expect(screen.getByText("1 section, ready to review and save.")).toBeTruthy();
    });
  });
});
