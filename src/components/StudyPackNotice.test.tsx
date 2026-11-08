// @vitest-environment jsdom
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import type { StudyPackResult } from "@/data/studyPack";

const mocks = vi.hoisted(() => ({ pending: vi.fn(), ack: vi.fn(), status: "ready" }));
vi.mock("@/data/studyPack", async (original) => ({
  ...(await original<typeof import("@/data/studyPack")>()),
  pendingStudyPackResults: mocks.pending,
  ackStudyPackResult: mocks.ack,
}));
vi.mock("@/state/AppDataContext", () => ({ useAppData: () => ({ status: mocks.status }) }));

const { StudyPackNotice } = await import("./StudyPackNotice");

const result: StudyPackResult = {
  operationId: "op1", packId: "p", added: 5, addedGuides: 4, addedDocuments: 1, addedPictures: 0, addedPractice: 0,
  skipped: 0, newVersions: 0, readded: 0, cardsLeftOut: 0, cardsLeftOutRemoved: 0, committedAt: "x",
  skippedItems: [], labelledItems: [],
};

beforeEach(() => {
  mocks.pending.mockReset();
  mocks.ack.mockReset().mockResolvedValue(undefined);
  mocks.status = "ready";
});
afterEach(cleanup);

// A tiny durable store: pending until acknowledged, like the native receipts.
function durable(fail = false) {
  const told = new Set<string>();
  mocks.pending.mockImplementation(async () => (told.has(result.operationId) ? [] : [result]));
  mocks.ack.mockImplementation(async (id: string) => {
    if (fail) throw new Error("disk");
    told.add(id);
  });
}

it("shows a pending result once, acknowledges it exactly once under StrictMode, and never again", async () => {
  durable();
  const first = render(<StrictMode><StudyPackNotice /></StrictMode>);
  expect(await screen.findByText("Your study pack was added.")).toBeTruthy();
  expect(screen.getByText("Added 4 guides and 1 PDF. Your own work wasn't changed.")).toBeTruthy();
  await waitFor(() => expect(mocks.ack).toHaveBeenCalled());
  expect(mocks.ack).toHaveBeenCalledTimes(1);
  expect(mocks.ack).toHaveBeenCalledWith("op1");
  first.unmount();
  render(<StudyPackNotice />);
  await waitFor(() => expect(mocks.pending.mock.calls.length).toBeGreaterThanOrEqual(2));
  expect(screen.queryByText("Your study pack was added.")).toBeNull();
});

it("waits until the library is ready and asks only once", async () => {
  mocks.status = "loading";
  mocks.pending.mockResolvedValue([]);
  const view = render(<StudyPackNotice />);
  expect(mocks.pending).not.toHaveBeenCalled();
  mocks.status = "ready";
  view.rerender(<StudyPackNotice />);
  view.rerender(<StudyPackNotice />);
  await waitFor(() => expect(mocks.pending).toHaveBeenCalledTimes(1));
});

it("stays silent when nothing is pending or the read fails", async () => {
  mocks.pending.mockRejectedValue("nope");
  const { container } = render(<StudyPackNotice />);
  await waitFor(() => expect(mocks.pending).toHaveBeenCalled());
  expect(container.textContent).toBe("");
});

it("leaves a result pending when ack fails, and shows it again on the next mount", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  durable(true);
  const first = render(<StudyPackNotice />);
  await screen.findByText("Your study pack was added.");
  await waitFor(() => expect(warn).toHaveBeenCalled());
  first.unmount();
  render(<StudyPackNotice />);
  expect(await screen.findByText("Your study pack was added.")).toBeTruthy();
  warn.mockRestore();
});

it("does not mark a result told if the page went away before it was shown", async () => {
  let release!: (value: StudyPackResult[]) => void;
  mocks.pending.mockReturnValue(new Promise<StudyPackResult[]>((resolve) => { release = resolve; }));
  const view = render(<StudyPackNotice />);
  await waitFor(() => expect(mocks.pending).toHaveBeenCalled());
  view.unmount();
  release([result]);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(mocks.ack).not.toHaveBeenCalled();
  mocks.pending.mockResolvedValue([result]);
  render(<StudyPackNotice />);
  expect(await screen.findByText("Your study pack was added.")).toBeTruthy();
});
