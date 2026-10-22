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
});
