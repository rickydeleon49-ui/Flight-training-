// @vitest-environment jsdom
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FigurePackDescriptor } from "@/logic/figurePacks";
import { FigurePackCard } from "./FigurePackCard";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listeners: [] as Array<(e: { payload: unknown }) => void>,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_name: string, cb: (e: { payload: unknown }) => void) => {
    mocks.listeners.push(cb);
    return () => { mocks.listeners = mocks.listeners.filter((x) => x !== cb); };
  }),
}));

const MB = 1024 * 1024;
const pack: FigurePackDescriptor = {
  id: "sectionals-test", url: "https://github.com/rickydeleon49-ui/x/p.zip", sha256: "0".repeat(64), bytes: 8 * MB,
  figures: [1, 2, 3].map((n) => ({ id: `faa-${n}`, faaNumber: n, title: "S", alt: "S", file: `faa-${n}.webp`, edition: "FAA-CT-8080-2H (2018)" as const, width: 1, height: 1 })),
};

let installed = false;
let downloadResult: "ok" | "fail" = "ok";
let finishDownload: (() => void) | null = null;
beforeEach(() => {
  installed = false; downloadResult = "ok"; mocks.listeners = []; finishDownload = null;
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation(async (cmd: string) => {
    if (cmd === "figure_pack_status") return { installed, bytes: installed ? 8 * MB : 0 };
    if (cmd === "figure_pack_download") {
      await new Promise<void>((resolve) => { finishDownload = resolve; });
      if (downloadResult === "fail") throw new Error("x");
      installed = true;
      return undefined;
    }
    if (cmd === "figure_pack_remove") { installed = false; return undefined; }
    return undefined;
  });
});
afterEach(cleanup);

const view = (onStart = vi.fn()) => render(h(FigurePackCard, { pack, questionCount: 20, onStart }));

describe("FigurePackCard", () => {
  it("shows the not-downloaded state", async () => {
    view();
    expect(await screen.findByText("Not downloaded yet")).toBeTruthy();
    expect(screen.getByText(/Adds 3 sectional excerpts and 20 questions \(each quiz asks up to 10\)/)).toBeTruthy();
    expect(screen.getByText(/About 8.0 MB/)).toBeTruthy();
    expect(screen.getByText("Offline? The rest of the figure drill still works.")).toBeTruthy();
  });

  it("downloads with progress, then shows available and removes", async () => {
    const onStart = vi.fn();
    view(onStart);
    fireEvent.click(await screen.findByRole("button", { name: "Download sectionals" }));
    expect(await screen.findByText("Downloading")).toBeTruthy();
    await waitFor(() => expect(mocks.listeners.length).toBeGreaterThan(0));
    act(() => { mocks.listeners[0]!({ payload: { id: pack.id, received: 4 * MB, total: 8 * MB } }); });
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("50");
    expect(screen.getByText("4.0 of 8.0 MB")).toBeTruthy();
    await act(async () => { finishDownload!(); });
    expect(await screen.findByText("Available offline")).toBeTruthy();
    expect(screen.getByText("3 sectional excerpts are on this device.")).toBeTruthy();
    expect(screen.getByText(/Practice, not for flight/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start sectional quiz" }));
    expect(onStart).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Remove download (8.0 MB)" }));
    expect(await screen.findByText("Not downloaded yet")).toBeTruthy();
    expect(mocks.invoke).toHaveBeenCalledWith("figure_pack_remove", { id: pack.id });
  });

  it("shows an error with Try again", async () => {
    downloadResult = "fail";
    view();
    fireEvent.click(await screen.findByRole("button", { name: "Download sectionals" }));
    await act(async () => { await waitFor(() => expect(finishDownload).not.toBeNull()); finishDownload!(); });
    expect(await screen.findByText("Download didn't finish. Check your internet and try again.")).toBeTruthy();
    downloadResult = "ok";
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await act(async () => { await waitFor(() => expect(finishDownload).not.toBeNull()); finishDownload!(); });
    expect(await screen.findByText("Available offline")).toBeTruthy();
  });

  it("cancel returns to not downloaded without an error", async () => {
    view();
    fireEvent.click(await screen.findByRole("button", { name: "Download sectionals" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("figure_pack_cancel", { id: pack.id }));
    downloadResult = "fail";
    await act(async () => { finishDownload!(); });
    expect(await screen.findByText("Not downloaded yet")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the download running across an unmount and remount", async () => {
    const first = view();
    fireEvent.click(await screen.findByRole("button", { name: "Download sectionals" }));
    expect(await screen.findByText("Downloading")).toBeTruthy();
    first.unmount();
    view();
    expect(await screen.findByText("Downloading")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Download sectionals" })).toBeNull();
    const calls = () => mocks.invoke.mock.calls.filter((c) => c[0] === "figure_pack_download").length;
    expect(calls()).toBe(1);
    await act(async () => { finishDownload!(); });
    expect(await screen.findByText("Available offline")).toBeTruthy();
    expect(calls()).toBe(1);
  });
});
