// @vitest-environment jsdom
import { createElement as h } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EMPTY_DATA, type AppData } from "@/state/AppDataContext";
import type { GeminiJobRecord } from "@/services/gemini";

const gemini = vi.hoisted(() => ({
  generateStudyAid: vi.fn(),
  generateStudyKit: vi.fn(),
  listGeminiJobs: vi.fn(),
  watchGeminiJobs: vi.fn(),
  watchGeminiProgress: vi.fn(),
  acknowledgeGeminiJob: vi.fn(),
}));
const notify = vi.hoisted(() => vi.fn());
vi.mock("@/services/gemini", async (original) => ({ ...(await original<typeof import("@/services/gemini")>()), ...gemini }));
vi.mock("@/services/notify", () => ({ notify }));

import { GeminiJobsProvider, useGeminiJobs } from "./GeminiJobs";

const TITLE = "Secret Airspace Chapter";
const target = { materialId: "mat-a", filePath: "documents/a.txt" };
const AID = { title: TITLE, summary: "s", sections: [], flashcards: [{ front: "Q", back: "A", sourcePage: 1 }], sourceNotes: "", model: "m" };
const READY = "Your study guide is ready";
const PARTIAL = "Your study guide finished, but part of it didn't work. Open the app to see.";
const FAILED = "A study guide couldn't be made. Open the app to see.";

let jobs: ReturnType<typeof useGeminiJobs>;
let focused: boolean;
let onJobChange: () => void;

function Probe() {
  jobs = useGeminiJobs();
  return null;
}

async function mount(notice: boolean | "unset" = true) {
  const data: AppData = { ...EMPTY_DATA, toolkit: { ...EMPTY_DATA.toolkit, ...(notice === "unset" ? {} : { studyGuideNotice: notice }) } };
  render(h(GeminiJobsProvider, { data, ready: true, mutate: (async () => null) as never, repositories: null, children: h(Probe) }));
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
}

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
const part = (id: string, stage: GeminiJobRecord["stage"], kind: GeminiJobRecord["kind"] = "study-aid"): GeminiJobRecord => ({
  id, kind, materialId: "mat-a", relativePath: "documents/a.txt", contentSha256: "", createdAt: 0, updatedAt: 0, stage,
  draft: { kind: "study-kit-part" }, ...(stage === "ready" ? { result: AID } : {}),
} as GeminiJobRecord);

beforeEach(() => {
  focused = false;
  vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
  Object.values(gemini).forEach((fn) => fn.mockReset());
  notify.mockReset().mockResolvedValue(true);
  gemini.listGeminiJobs.mockResolvedValue([]);
  gemini.acknowledgeGeminiJob.mockResolvedValue(true);
  gemini.watchGeminiProgress.mockResolvedValue(() => {});
  gemini.watchGeminiJobs.mockImplementation(async (cb: () => void) => { onJobChange = cb; return () => {}; });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("study guide notice (NOTIFY-01)", () => {
  it("sends one generic notice when a single job is ready in the background", async () => {
    gemini.generateStudyAid.mockResolvedValue({ ...AID, jobId: "j1", checkpointed: true });
    await mount();
    await act(async () => { await jobs.start("study-aid", target); });
    await flush();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith("Your Flight Deck", READY);
    expect(JSON.stringify(notify.mock.calls)).not.toContain(TITLE);
  });

  it("stays quiet while the window is focused", async () => {
    focused = true;
    gemini.generateStudyAid.mockResolvedValue({ ...AID, jobId: "j1", checkpointed: true });
    await mount();
    await act(async () => { await jobs.start("study-aid", target); });
    await flush();
    expect(notify).not.toHaveBeenCalled();
  });

  it("stays quiet when the switch is off or was never set", async () => {
    gemini.generateStudyAid.mockResolvedValue({ ...AID, jobId: "j1", checkpointed: true });
    for (const setting of [false, "unset"] as const) {
      await mount(setting);
      await act(async () => { await jobs.start("study-aid", target); });
      await flush();
      cleanup();
    }
    expect(notify).not.toHaveBeenCalled();
  });

  it("says a single job could not be made", async () => {
    gemini.generateStudyAid.mockRejectedValue(new Error("boom"));
    await mount();
    await act(async () => { await jobs.start("study-aid", target); });
    await flush();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith("Your Flight Deck", FAILED);
  });

  it("sends exactly one notice for a kit of three", async () => {
    const parts = { guide: { answer: AID }, cards: { answer: AID }, questions: { answer: { title: "q", questions: [], model: "m" } } };
    gemini.generateStudyKit.mockResolvedValue({ jobId: "kit-1", checkpointed: true, parts });
    gemini.listGeminiJobs.mockResolvedValue([]);
    await mount();
    gemini.listGeminiJobs.mockResolvedValue([part("kit-1#guide", "ready"), part("kit-1#cards", "ready"), part("kit-1#questions", "ready", "practice-test")]);
    await act(async () => { await jobs.startKitTracked(target); });
    await flush();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith("Your Flight Deck", READY);
  });

  it("says part of a kit did not work", async () => {
    const parts = { guide: { answer: AID }, cards: { error: "no" }, questions: { error: "no" } };
    gemini.generateStudyKit.mockResolvedValue({ jobId: "kit-1", checkpointed: true, parts });
    await mount();
    gemini.listGeminiJobs.mockResolvedValue([part("kit-1#guide", "ready"), part("kit-1#cards", "failed"), part("kit-1#questions", "failed", "practice-test")]);
    await act(async () => { await jobs.startKitTracked(target); });
    await flush();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith("Your Flight Deck", PARTIAL);
  });

  it("sends one notice for a kit that finished while running after a reload", async () => {
    gemini.listGeminiJobs.mockResolvedValue([{ ...part("kit-2", "running", "study-kit"), draft: undefined }]);
    await mount();
    expect(jobs.jobs.some((j) => j.kind === "study-kit" && j.phase === "running")).toBe(true);
    gemini.listGeminiJobs.mockResolvedValue([part("kit-2#guide", "ready"), part("kit-2#cards", "failed"), part("kit-2#questions", "ready", "practice-test")]);
    await act(async () => { onJobChange(); });
    await flush();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith("Your Flight Deck", PARTIAL);
  });

  it("says nothing for jobs that finished before the app started", async () => {
    gemini.listGeminiJobs.mockResolvedValue([
      { ...part("old-1", "ready"), draft: undefined },
      { ...part("old-2", "failed"), draft: undefined },
      part("old-3#guide", "ready"),
    ]);
    await mount();
    await flush();
    expect(jobs.jobs.length).toBeGreaterThan(0);
    expect(notify).not.toHaveBeenCalled();
  });
});
