// @vitest-environment jsdom
import { createElement as h } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { GeminiJob } from "@/state/GeminiJobs";
import { GeminiProgressView } from "./GeminiJobNotice";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-19T20:00:00Z"));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const job = (): GeminiJob => ({
  key: "synthetic-job", jobId: null, kind: "study-aid", materialId: "synthetic",
  filePath: "documents/synthetic.pdf", phase: "running", progress: null,
  error: null, answer: null, contentSha256: null, baseRevision: null,
  checkpointed: false, stage: "generating", startedAt: Date.now() - 5000,
});

it("updates visible elapsed time without changing the live announcement every second", () => {
  render(h(GeminiProgressView, { job: job(), title: "Creating your study guide", onCancel: vi.fn() }));
  const status = screen.getByRole("status");
  expect(status.textContent).toBe("Waiting for Gemini's answer");
  expect(screen.getByText("5 s so far")).toBeTruthy();
  act(() => { vi.advanceTimersByTime(2000); });
  expect(screen.getByText("7 s so far")).toBeTruthy();
  expect(status.textContent).toBe("Waiting for Gemini's answer");
});

it("announces actual stage and cancellation changes while preserving Cancel behavior", () => {
  const cancel = vi.fn();
  const current = job();
  const { rerender } = render(h(GeminiProgressView, { job: current, title: "Creating your study guide", onCancel: cancel }));
  act(() => { screen.getByRole("button", { name: "Cancel" }).click(); });
  expect(cancel).toHaveBeenCalledOnce();
  rerender(h(GeminiProgressView, { job: { ...current, stage: "validating" }, title: "Creating your study guide", onCancel: cancel }));
  expect(screen.getByRole("status").textContent).toBe("Checking the answer");
  rerender(h(GeminiProgressView, { job: { ...current, cancelRequested: true }, title: "Creating your study guide", onCancel: cancel }));
  expect(screen.getByRole("status").textContent).toBe("Cancelling…");
  expect(screen.getByRole("button", { name: "Cancelling…" }).hasAttribute("disabled")).toBe(true);
});


it("shows exactly one slow-upload line while preserving Cancel and stage text", () => {
  const current = { ...job(), stage: "uploading" as const, startedAt: Date.now() };
  const words = "Your PDF is still uploading. A slower connection can take a little longer.";
  const { rerender } = render(h(GeminiProgressView, { job: current, title: "Creating your study guide", onCancel: vi.fn() }));
  expect(screen.queryByText(words)).toBeNull();
  act(() => { vi.advanceTimersByTime(2000); });
  expect(screen.getAllByText(words)).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  expect(screen.getByRole("status").textContent).toBe("Sending the PDF to Google");
  rerender(h(GeminiProgressView, { job: { ...current, stage: "generating" }, title: "Creating your study guide", onCancel: vi.fn() }));
  expect(screen.queryByText(words)).toBeNull();
});

it.each(["flashcards", "study-aid", "practice-test"] as const)("keeps %s retries calm, with elapsed time and Cancel", (kind) => {
  const cancel = vi.fn();
  const current = { ...job(), kind, attempt: 2, maxAttempts: 9, startedAt: Date.now() - 15000 };
  const { rerender } = render(h(GeminiProgressView, { job: current, title: "Creating your study aid", onCancel: cancel }));
  expect(screen.getByRole("status").textContent).toBe("Gemini is busy — trying again");
  expect(screen.getByText("15 s so far")).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/(?:attempt|request) \d+ of \d+/i);
  act(() => { screen.getByRole("button", { name: "Cancel" }).click(); });
  expect(cancel).toHaveBeenCalledOnce();
  rerender(h(GeminiProgressView, { job: { ...current, cancelRequested: true }, title: "Creating your study aid", onCancel: cancel }));
  expect(screen.getByRole("status").textContent).toBe("Cancelling…");
});

it("shows saving wording once the guide is saving", () => {
  render(h(GeminiProgressView, {job:{...job(),phase:"saving"},title:"Creating your study guide",onCancel:vi.fn()}));
  expect(screen.getByRole("status").textContent).toBe("Saving your guide…");
});
