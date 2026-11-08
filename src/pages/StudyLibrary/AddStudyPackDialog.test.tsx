// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { StudyPackResult } from "@/data/studyPack";

const mocks = vi.hoisted(() => ({
  choose: vi.fn(), inspect: vi.fn(), add: vi.fn(), result: vi.fn(), ack: vi.fn(), refresh: vi.fn(),
}));
vi.mock("@/data/studyPack", async (original) => ({
  ...(await original<typeof import("@/data/studyPack")>()),
  chooseStudyPack: mocks.choose,
  inspectStudyPack: mocks.inspect,
  addStudyPack: mocks.add,
  studyPackResult: mocks.result,
  ackStudyPackResult: mocks.ack,
}));
vi.mock("@/state/AppDataContext", () => ({ useAppData: () => ({ refresh: mocks.refresh }) }));

const { AddStudyPackDialog } = await import("./AddStudyPackDialog");

const preview = { guides: 14, cards: 280, questions: 140, videos: 31, documents: 14, alreadyInLibrary: 3, skippedItems: [], labelledItems: [], nothingNew: false };
const done = (patch: Partial<StudyPackResult> = {}): StudyPackResult => ({
  operationId: "op", packId: "p", added: 14, addedGuides: 11, addedDocuments: 3, addedPictures: 0, addedPractice: 0,
  skipped: 0, newVersions: 0, readded: 0, cardsLeftOut: 0, cardsLeftOutRemoved: 0, committedAt: "x", skippedItems: [], labelledItems: [], ...patch,
});

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.choose.mockResolvedValue("/picked/pack.hfdpack");
  mocks.inspect.mockResolvedValue(preview);
  mocks.ack.mockResolvedValue(undefined);
  mocks.refresh.mockResolvedValue(undefined);
});
afterEach(cleanup);

const open = (onClose = vi.fn()) => { render(<AddStudyPackDialog open onClose={onClose} />); return onClose; };
const addButton = () => screen.findByRole("button", { name: "Add" });

describe("Add study pack dialog", () => {
  it("previews only counts and the already-in-library line, with one Add button and no file names", async () => {
    open();
    await addButton();
    expect(screen.getByText("14 guides · 280 cards · 140 practice questions · 31 videos · 14 PDFs")).toBeTruthy();
    expect(screen.getByText("3 are already in your library.")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/hfdpack|pack\.|\/picked/);
  });

  it("leaves the already-in-library line out when it is zero", async () => {
    mocks.inspect.mockResolvedValue({ ...preview, alreadyInLibrary: 0 });
    open();
    await addButton();
    expect(screen.queryByText(/already in your library/)).toBeNull();
  });

  it("closes quietly when she cancels the picker", async () => {
    mocks.choose.mockResolvedValue(null);
    const onClose = open();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mocks.inspect).not.toHaveBeenCalled();
  });

  it.each([
    "This file isn't a study pack.",
    "This study pack is damaged.",
    "Finish the restore first.",
  ])("shows the refusal sentence '%s' and offers no Add", async (sentence) => {
    mocks.inspect.mockRejectedValue(sentence);
    open();
    expect((await screen.findByRole("alert")).textContent).toBe(sentence);
    expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
  });

  it("shows the app-update refusal, the only sentence allowed to say 'newer'", async () => {
    const sentence = "This study pack needs a newer Her Flight Deck. Update the app, then try again.";
    mocks.inspect.mockRejectedValue(sentence);
    open();
    expect((await screen.findByRole("alert")).textContent).toBe(sentence);
  });

  it("adds, acknowledges, refreshes and shows the summary", async () => {
    mocks.add.mockResolvedValue(done());
    open();
    fireEvent.click(await addButton());
    expect(await screen.findByText("Added 11 guides and 3 PDFs. Your own work wasn't changed.")).toBeTruthy();
    expect(mocks.add).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f-]{36}$/), "/picked/pack.hfdpack");
    await waitFor(() => expect(mocks.ack).toHaveBeenCalledWith("op"));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    expect(screen.queryByText(/another version|added back|left out/)).toBeNull();
  });

  it("shows added-back, another-version and left-out lines when non-zero, and never 'newer'", async () => {
    mocks.add.mockResolvedValue(done({ newVersions: 2, readded: 1, cardsLeftOut: 5, cardsLeftOutRemoved: 4 }));
    open();
    fireEvent.click(await addButton());
    await screen.findByText("1 you had removed was added back.");
    expect(screen.getByText(/2 are other versions of things you have/)).toBeTruthy();
    expect(screen.getByText("4 picture cards were left out because you removed their picture.")).toBeTruthy();
    expect(screen.getByText("1 picture card was left out because its picture couldn't be used.")).toBeTruthy();
    expect(screen.getByRole("status").textContent!.toLowerCase()).not.toContain("newer");
  });

  it("names each skipped item in the preview and in the summary", async () => {
    const skippedItems = [{ title: "Handbook", reason: "already in your library" }];
    mocks.inspect.mockResolvedValue({ ...preview, skippedItems });
    mocks.add.mockResolvedValue(done({ skipped: 1, skippedItems }));
    open();
    await addButton();
    expect(screen.getByRole("heading", { name: "Add study pack" })).toBeTruthy();
    expect(screen.getByText("Handbook — already in your library")).toBeTruthy();
    fireEvent.click(await addButton());
    await screen.findByText("Added 11 guides and 3 PDFs. Your own work wasn't changed.");
    expect(screen.getByRole("heading", { name: "Study pack added" })).toBeTruthy();
    expect(screen.getByText("Handbook — already in your library")).toBeTruthy();
  });

  it("with nothing new there is no Add button, only Close, and the items are named", async () => {
    const skippedItems = [{ title: "Handbook", reason: "already in your library" }];
    mocks.inspect.mockResolvedValue({ ...preview, alreadyInLibrary: 1, skippedItems, nothingNew: true });
    open();
    await screen.findByRole("heading", { name: "Already in your library" });
    expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
    expect(screen.getByText("Handbook — already in your library")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Close" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it("names each labelled item in the preview and in the summary", async () => {
    const labelledItems = [{ title: "AC 90-66C", reason: 'added as "AC 90-66C (from study pack)" next to yours' }];
    const line = 'AC 90-66C — added as "AC 90-66C (from study pack)" next to yours';
    mocks.inspect.mockResolvedValue({ ...preview, labelledItems });
    mocks.add.mockResolvedValue(done({ newVersions: 1, labelledItems }));
    open();
    await addButton();
    expect(screen.getByText(line)).toBeTruthy();
    fireEvent.click(await addButton());
    await screen.findByText("Added 11 guides and 3 PDFs. Your own work wasn't changed.");
    expect(screen.getByText(line)).toBeTruthy();
  });

  it("shows the waiting line while previewing and while adding", async () => {
    const wait = "This can take a minute or two. Keep the app open.";
    let release: (p: typeof preview) => void = () => {};
    mocks.inspect.mockReturnValue(new Promise((r) => { release = r; }));
    let finish: (r: ReturnType<typeof done>) => void = () => {};
    mocks.add.mockReturnValue(new Promise((r) => { finish = r; }));
    open();
    expect(await screen.findByText(wait)).toBeTruthy();
    release(preview);
    expect(await screen.findByRole("button", { name: "Add" })).toBeTruthy();
    expect(screen.queryByText(wait)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText(wait)).toBeTruthy();
    finish(done());
    await screen.findByText("Study pack added");
    expect(screen.queryByText(wait)).toBeNull();
  });

  it("shows the busy sentence, changes nothing, and Try again reuses the same operation id", async () => {
    const busy = "Your library is busy. Try again in a moment.";
    mocks.add.mockRejectedValueOnce(`refused: ${busy}`).mockResolvedValueOnce(done());
    mocks.result.mockResolvedValue(null);
    open();
    fireEvent.click(await addButton());
    expect((await screen.findByRole("alert")).textContent).toBe(busy);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText(/^Added 11 guides/);
    const [first, second] = mocks.add.mock.calls.map((call) => call[0]);
    expect(first).toBe(second);
  });

  it("on an unknown outcome asks for the receipt instead of guessing", async () => {
    mocks.add.mockRejectedValue(new Error("transport closed"));
    mocks.result.mockResolvedValue(done({ addedGuides: 2, addedDocuments: 0 }));
    open();
    fireEvent.click(await addButton());
    expect(await screen.findByText("Added 2 guides. Your own work wasn't changed.")).toBeTruthy();
    expect(mocks.result).toHaveBeenCalledWith(mocks.add.mock.calls[0]![0]);
    expect(mocks.ack).toHaveBeenCalledWith("op");
  });

  it("with a transport failure and no receipt, says the outcome is unknown, not 'nothing changed'", async () => {
    mocks.add.mockRejectedValue(new Error("transport closed"));
    mocks.result.mockResolvedValue(null);
    open();
    fireEvent.click(await addButton());
    const message = (await screen.findByRole("alert")).textContent!;
    expect(message).toMatch(/couldn't tell/);
    expect(message).not.toMatch(/Nothing was changed/);
  });

  it("treats a bare string from the IPC layer as unknown, not a refusal", async () => {
    mocks.add.mockRejectedValue("failed to acquire webview reference");
    mocks.result.mockResolvedValue(null);
    open();
    fireEvent.click(await addButton());
    const message = (await screen.findByRole("alert")).textContent!;
    expect(message).toMatch(/couldn't tell/);
    expect(message).not.toMatch(/webview|Nothing was changed/);
  });

  it.each([
    "Study packs can't be added to this library's storage yet.",
    "Finish the restore first.",
    "There isn't enough free space to add this study pack.",
    "Your library changed while adding. Press Add again.",
    "That study pack can't be opened.",
  ])("shows the known refusal '%s' as it is", async (sentence) => {
    mocks.add.mockRejectedValue(`refused: ${sentence}`);
    mocks.result.mockResolvedValue(null);
    open();
    fireEvent.click(await addButton());
    expect((await screen.findByRole("alert")).textContent).toBe(sentence);
  });

  it("keeps a definite refusal when the receipt lookup also fails", async () => {
    const busy = "Your library is busy. Try again in a moment.";
    mocks.add.mockRejectedValue(`refused: ${busy}`);
    mocks.result.mockRejectedValue(new Error("lookup failed"));
    open();
    fireEvent.click(await addButton());
    expect((await screen.findByRole("alert")).textContent).toBe(busy);
  });

  it("when the receipt lookup also fails, says it is unknown (not 'nothing changed') and retries with the same operation id", async () => {
    mocks.add.mockRejectedValueOnce(new Error("transport closed")).mockResolvedValueOnce(done());
    mocks.result.mockRejectedValue(new Error("lookup failed"));
    open();
    fireEvent.click(await addButton());
    const message = (await screen.findByRole("alert")).textContent!;
    expect(message).toMatch(/couldn't tell/);
    expect(message).not.toMatch(/Nothing was changed/);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText(/^Added 11 guides/);
    expect(mocks.add.mock.calls[0]![0]).toBe(mocks.add.mock.calls[1]![0]);
  });

  it("acknowledges only after the summary is shown, and leaves it pending if closed during refresh", async () => {
    mocks.add.mockResolvedValue(done());
    let release!: () => void;
    mocks.refresh.mockReturnValue(new Promise<void>((resolve) => { release = resolve; }));
    const view = render(<AddStudyPackDialog open onClose={vi.fn()} />);
    fireEvent.click(await addButton());
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    expect(mocks.ack).not.toHaveBeenCalled();
    view.unmount();
    release();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mocks.ack).not.toHaveBeenCalled();
  });

  it("acknowledges only once the summary is in the document", async () => {
    mocks.add.mockResolvedValue(done());
    let shownAtAck: boolean | null = null;
    mocks.ack.mockImplementation(async () => {
      shownAtAck = document.body.textContent!.includes("Added 11 guides and 3 PDFs.");
    });
    open();
    fireEvent.click(await addButton());
    await screen.findByText(/^Added 11 guides/);
    await waitFor(() => expect(mocks.ack).toHaveBeenCalledWith("op"));
    expect(shownAtAck).toBe(true);
    expect(mocks.ack).toHaveBeenCalledTimes(1);
  });
});
