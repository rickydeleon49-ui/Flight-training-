// @vitest-environment jsdom
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MaterialReadiness, OfflineReadiness } from "@/services/offlineContent";
import { makeMaterial } from "@/testing/factories";

const service = vi.hoisted(() => ({
  enabled: true,
  readiness: vi.fn<(ids: string[]) => Promise<MaterialReadiness[]>>(),
  prepare: vi.fn<(id: string) => Promise<MaterialReadiness>>(),
}));

vi.mock("@/services/offlineContent", async (original) => ({
  fileIdentity: (await original<typeof import("@/services/offlineContent")>()).fileIdentity,
  offlineStudyEnabled: () => service.enabled,
  offlineContentReadiness: (ids: string[]) => service.readiness(ids),
  prepareOfflineContent: (id: string) => service.prepare(id),
}));

import { OfflineStudyPanel, RECHECK_MS } from "./OfflineStudyPanel";
import { useOfflineBadges } from "./useOfflineBadges";

const pdf = makeMaterial({ id: "m1", title: "Handbook", filePath: "m1-handbook.pdf" });
const row = (readiness: OfflineReadiness, materialId = "m1"): MaterialReadiness => ({ materialId, readiness });

beforeEach(() => {
  service.enabled = true;
  service.readiness.mockReset();
  service.prepare.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Offline study panel", () => {
  it("renders nothing when this build hasn't opted in", async () => {
    service.enabled = false;
    const { container } = render(h(OfflineStudyPanel, { material: pdf }));
    await act(async () => {});
    expect(container.innerHTML).toBe("");
    expect(service.readiness).not.toHaveBeenCalled();
  });

  it("renders nothing for a document that isn't a PDF", async () => {
    service.readiness.mockResolvedValue([row({ state: "unsupported" })]);
    const { container } = render(h(OfflineStudyPanel, { material: pdf }));
    await waitFor(() => expect(service.readiness).toHaveBeenCalled());
    expect(container.innerHTML).toBe("");
  });

  it("offers reading, then shows that it is under way", async () => {
    service.readiness.mockResolvedValue([row({ state: "notPrepared" })]);
    service.prepare.mockResolvedValue(row({ state: "preparing" }));
    render(h(OfflineStudyPanel, { material: pdf }));
    expect(await screen.findByText("Not read yet")).toBeTruthy();
    expect(screen.getByText(/nothing is sent anywhere/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Read this PDF's text" }));
    expect(await screen.findByText("Reading text…")).toBeTruthy();
    expect(service.prepare).toHaveBeenCalledWith("m1");
    expect(screen.queryByRole("button", { name: "Read this PDF's text" })).toBeNull();
  });

  it("looks again while a state is settling, until it settles", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    service.readiness
      .mockResolvedValueOnce([row({ state: "checking" })])
      .mockResolvedValueOnce([row({ state: "preparing" })])
      .mockResolvedValue([row({ state: "searchable", pages: 524 })]);
    render(h(OfflineStudyPanel, { material: pdf }));
    expect(await screen.findByText("Checking…")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RECHECK_MS);
    });
    expect(await screen.findByText("Reading text…")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RECHECK_MS);
    });
    expect(await screen.findByText("Text read on this Mac: all 524 pages.")).toBeTruthy();
    const calls = service.readiness.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RECHECK_MS * 3);
    });
    expect(service.readiness.mock.calls.length).toBe(calls);
  });

  it("says so when a run stops short and the file is back to not prepared", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    service.readiness
      .mockResolvedValueOnce([row({ state: "preparing" })])
      .mockResolvedValue([row({ state: "notPrepared" })]);
    render(h(OfflineStudyPanel, { material: pdf }));
    expect(await screen.findByText("Reading text…")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RECHECK_MS);
    });
    expect(await screen.findByText("Reading didn't finish this time. You can try again.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Read this PDF's text" })).toBeTruthy();
  });

  it("drops the old file's answer when the file is replaced under the same material", async () => {
    let answerOld!: (rows: MaterialReadiness[]) => void;
    service.readiness
      .mockImplementationOnce(() => new Promise((resolve) => (answerOld = resolve)))
      .mockResolvedValue([row({ state: "notPrepared" })]);
    const { rerender } = render(h(OfflineStudyPanel, { material: pdf }));
    await waitFor(() => expect(service.readiness).toHaveBeenCalledTimes(1));
    const replaced = { ...pdf, fileSize: 999, updatedAt: "2026-10-19T12:00:00.000Z" };
    rerender(h(OfflineStudyPanel, { material: replaced }));
    expect(await screen.findByText("Not read yet")).toBeTruthy();
    expect(service.readiness).toHaveBeenCalledTimes(2);
    // The old file's late answer arrives and is ignored.
    await act(async () => answerOld([row({ state: "searchable", pages: 524 })]));
    expect(screen.queryByText("Text read")).toBeNull();
    expect(screen.getByText("Not read yet")).toBeTruthy();
  });

  it("forgets a settled state when the file is replaced", async () => {
    service.readiness
      .mockResolvedValueOnce([row({ state: "searchable", pages: 524 })])
      .mockImplementation(() => new Promise(() => {}));
    const { rerender } = render(h(OfflineStudyPanel, { material: pdf }));
    expect(await screen.findByText("Text read")).toBeTruthy();
    rerender(h(OfflineStudyPanel, { material: { ...pdf, filePath: "m1-restored.pdf" } }));
    await waitFor(() => expect(service.readiness).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Text read")).toBeNull();
  });

  it("uses neutral wording when some pages couldn't be read", async () => {
    service.readiness.mockResolvedValue([
      row({ state: "partial", searchable: 497, pages: 524, imagePages: 1, reason: "someUnreadable" }),
    ]);
    render(h(OfflineStudyPanel, { material: pdf }));
    expect(await screen.findByText("Text read on 497 of 524 pages. Some pages couldn't be read.")).toBeTruthy();
    expect(screen.getByText("Partly read")).toBeTruthy();
  });

  it("says so plainly if preparation can't start", async () => {
    service.readiness.mockResolvedValue([row({ state: "notPrepared" })]);
    service.prepare.mockRejectedValue("offline_extraction_disabled");
    render(h(OfflineStudyPanel, { material: pdf }));
    fireEvent.click(await screen.findByRole("button", { name: "Read this PDF's text" }));
    expect(await screen.findByText("Reading this PDF's text couldn't start. Please try again.")).toBeTruthy();
    expect(screen.queryByText(/offline_extraction_disabled/)).toBeNull();
  });

  it("shows the too-large line and no button for a 204.7 MB PDF, and shows the button for a 20 MB PDF", async () => {
    service.readiness.mockResolvedValue([row({ state: "notPrepared" })]);
    const largePdf = makeMaterial({
      id: "large",
      title: "AMT Powerplant Handbook",
      filePath: "amt_powerplant_handbook.pdf",
      fileSize: Math.round(204.7 * 1024 * 1024),
    });
    const { rerender } = render(h(OfflineStudyPanel, { material: largePdf }));
    expect(await screen.findByText("Read this PDF's text")).toBeTruthy();
    expect(
      screen.getByText(
        "This PDF is too large to read in one piece on this Mac. Split it into parts at the top of this page, then use a part.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Read this PDF's text" })).toBeNull();

    const normalPdf = makeMaterial({
      id: "normal",
      title: "Handbook",
      filePath: "handbook.pdf",
      fileSize: 20 * 1024 * 1024,
    });
    rerender(h(OfflineStudyPanel, { material: normalPdf }));
    expect(await screen.findByRole("button", { name: "Read this PDF's text" })).toBeTruthy();
    expect(
      screen.queryByText(
        "This PDF is too large to read in one piece on this Mac. Split it into parts at the top of this page, then use a part.",
      ),
    ).toBeNull();
  });

  it("does not render any old phrases (Offline study, Prepare for offline study, Not prepared, Searchable, etc.)", async () => {
    service.readiness.mockResolvedValue([row({ state: "notPrepared" })]);
    render(h(OfflineStudyPanel, { material: pdf }));
    await screen.findByRole("heading", { name: "Read this PDF's text" });
    expect(screen.queryByRole("heading", { name: "Offline study" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Prepare for offline study" })).toBeNull();
    expect(screen.queryByText("Not prepared")).toBeNull();
    expect(screen.queryByText("Searchable")).toBeNull();
    expect(screen.queryByText("Preparing search")).toBeNull();
    expect(screen.queryByText("Partly searchable")).toBeNull();
    expect(screen.queryByText("Could not prepare")).toBeNull();
  });
});

function BadgeProbe({ materials }: { materials: ReturnType<typeof makeMaterial>[] }) {
  const badges = useOfflineBadges(materials);
  return h(
    "ul",
    null,
    [...badges.entries()].map(([id, b]) => h("li", { key: id }, `${id}:${b.label}`)),
  );
}

describe("Library offline badges", () => {
  it("asks once for the PDFs on screen and hides quiet states", async () => {
    service.readiness.mockResolvedValue([
      row({ state: "searchable", pages: 3 }, "a"),
      row({ state: "checking" }, "b"),
    ]);
    const shown = [
      makeMaterial({ id: "a", filePath: "a.pdf" }),
      makeMaterial({ id: "b", filePath: "b.PDF" }),
      makeMaterial({ id: "c", filePath: "notes.txt" }),
      makeMaterial({ id: "d", filePath: null }),
    ];
    render(h(BadgeProbe, { materials: shown }));
    expect(await screen.findByText("a:Text read")).toBeTruthy();
    expect(service.readiness).toHaveBeenCalledTimes(1);
    expect(service.readiness).toHaveBeenCalledWith(["a", "b"]);
    expect(screen.queryByText(/^b:/)).toBeNull();
  });

  it("asks again, and drops the old answer, when a shown file is replaced", async () => {
    let answerOld!: (rows: MaterialReadiness[]) => void;
    service.readiness
      .mockImplementationOnce(() => new Promise((resolve) => (answerOld = resolve)))
      .mockResolvedValue([row({ state: "notPrepared" }, "a")]);
    const a = makeMaterial({ id: "a", filePath: "a.pdf", fileSize: 10 });
    const { rerender } = render(h(BadgeProbe, { materials: [a] }));
    await waitFor(() => expect(service.readiness).toHaveBeenCalledTimes(1));
    rerender(h(BadgeProbe, { materials: [{ ...a, fileSize: 20 }] }));
    expect(await screen.findByText("a:Not read yet")).toBeTruthy();
    await act(async () => answerOld([row({ state: "searchable", pages: 3 }, "a")]));
    expect(screen.queryByText("a:Text read")).toBeNull();
    expect(service.readiness).toHaveBeenCalledTimes(2);
  });

  it("shows nothing when this build hasn't opted in", async () => {
    service.enabled = false;
    render(h(BadgeProbe, { materials: [makeMaterial({ id: "a", filePath: "a.pdf" })] }));
    await act(async () => {});
    expect(service.readiness).not.toHaveBeenCalled();
    expect(screen.queryByText(/a:/)).toBeNull();
  });
});
