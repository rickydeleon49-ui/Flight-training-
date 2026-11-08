// @vitest-environment jsdom
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
};

beforeEach(() => {
  mocks.pending.mockReset();
  mocks.ack.mockReset().mockResolvedValue(undefined);
  mocks.status = "ready";
});
afterEach(cleanup);

it("shows a pending result once and marks it told", async () => {
  mocks.pending.mockResolvedValue([result]);
  const first = render(<StudyPackNotice />);
  expect(await screen.findByText("Your study pack was added.")).toBeTruthy();
  expect(screen.getByText("Added 4 guides and 1 PDF. Your own work wasn't changed.")).toBeTruthy();
  await waitFor(() => expect(mocks.ack).toHaveBeenCalledWith("op1"));
  first.unmount();
  // The next start finds nothing pending because the ack was recorded.
  mocks.pending.mockResolvedValue([]);
  render(<StudyPackNotice />);
  await waitFor(() => expect(mocks.pending).toHaveBeenCalledTimes(2));
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

it("leaves a result pending when ack fails, and shows it again on the next start", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.pending.mockResolvedValue([result]);
  mocks.ack.mockRejectedValue(new Error("disk"));
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
