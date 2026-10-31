// @vitest-environment jsdom
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { createRepositories } from "@/data/repositories";
import { AppDataProvider } from "@/state/AppDataContext";
import { StudySetSaveError } from "@/data/persistenceErrors";
import { visualRegionHash } from "@/data/visualCards";
import type { HomeworkOperation } from "@/domain/homework";
import * as pictureService from "@/services/visualCards";
import * as gemini from "@/services/gemini";
import * as documents from "@/services/documents";
import { MaterialDetail } from "./MaterialDetail";
import { CardReviewPanel } from "./CardReviewPanel";
import { HomeworkCardRun } from "./HomeworkCardRun";
let db: TestDatabase;
vi.mock("@/data", () => ({ getDatabase: () => Promise.resolve(db), isTauri: () => false }));
const bytes = readFileSync("src/testing/fixtures/visual/practice-panel.png");
const picture = {
  imageSha256: createHash("sha256").update(bytes).digest("hex"),
  imageWidth: bytes.readUInt32BE(16),
  imageHeight: bytes.readUInt32BE(20),
  url: `data:image/png;base64,${bytes.toString("base64")}`,
};
beforeEach(async () => {
  db = await createNodeSqliteDatabase();
  const r = createRepositories(db);
  await r.app.set("airline_starter_pack", "skipped-for-test");
  await r.documents.create({ id: "visual-ui", title: "Fictional panel", filePath: "panel.png", originalFileName: "panel.png" });
  vi.spyOn(pictureService, "readVisualPicture").mockResolvedValue(picture);
  vi.spyOn(gemini, "getGeminiStatus").mockResolvedValue({ configured: false, model: "", choice: "standard" });
  vi.spyOn(gemini, "watchGeminiProgress").mockResolvedValue(() => {});
  vi.spyOn(documents, "canHandleFiles").mockReturnValue(false);
});
afterEach(async () => {
  cleanup();
  await new Promise((r) => setTimeout(r, 0));
  vi.restoreAllMocks();
  db.close();
});
const mount = () =>
  render(
    h(
      AppDataProvider,
      null,
      h(
        MemoryRouter,
        { initialEntries: ["/study/visual-ui"] },
        h(Routes, null, h(Route, { path: "/study/:materialId", element: h(MaterialDetail) })),
      ),
    ),
  );
async function draft() {
  fireEvent.click(await screen.findByRole("button", { name: "Add a picture card" }));
  await screen.findByRole("textbox", { name: "Question" });
  fireEvent.change(screen.getByRole("textbox", { name: "Question" }), { target: { value: "Which centre label?" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Answer" }), { target: { value: "Bravo synthetic answer" } });
}

async function seedManualSet(
  cards: Array<{ front: string; back: string; picture?: boolean }>,
  { owner = "visual-ui", summary = "", sections = [] }: {
    owner?: string;
    summary?: string;
    sections?: Array<{ heading: string; body: string }>;
  } = {},
) {
  const repositories = createRepositories(db);
  const regions = await Promise.all(cards.map(async (_, index) => {
    const descriptor = {
      ownerMaterialId: owner,
      imageMaterialId: "visual-ui",
      imageSha256: picture.imageSha256,
      imageWidth: picture.imageWidth,
      imageHeight: picture.imageHeight,
      x: index * 10,
      y: 0,
      w: 10,
      h: 10,
      rotation: 0 as const,
    };
    return { ...descriptor, id: await visualRegionHash(descriptor) };
  }));
  await repositories.documents.saveStudySet({
    operationId: crypto.randomUUID(),
    materialId: owner,
    reason: "create",
    expected: null,
    visualRegions: regions.filter((_, index) => cards[index]!.picture),
    next: {
      title: "Fictional study set",
      summary,
      summaryOrigin: summary ? "user" : null,
      sections,
      flashcards: cards.map((card, index) => ({
        front: card.front,
        back: card.back,
        sourcePage: null,
        origin: "user",
        itemId: crypto.randomUUID(),
        ...(card.picture ? { visualRegionId: regions[index]!.id } : {}),
      })),
      provider: "manual",
      model: "",
      sourceNotes: "",
      retired: [],
    },
  });
  return repositories;
}

it("lists saved picture cards beside their creation path and edits the original index in a mixed set", async () => {
  await seedManualSet([
    { front: "Text card", back: "Text answer" },
    { front: "First picture?", back: "Alpha", picture: true },
    { front: "Another text card", back: "Another answer" },
    { front: "Second picture?", back: "Bravo", picture: true },
  ]);
  mount();
  const list = await screen.findByRole("region", { name: "Your picture cards" });
  const rows = within(list).getAllByRole("listitem");
  expect(rows).toHaveLength(2);
  expect(rows[0]!.textContent).toBe("First picture?Edit");
  expect(rows[1]!.textContent).toBe("Second picture?Edit");
  const flashcards = list.closest("#material-flashcards")!;
  expect(within(flashcards as HTMLElement).getByRole("button", { name: "Add a picture card" })).toBeTruthy();
  expect(within(list).queryByRole("button", { name: "Delete" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "Your study guide" })).toBeNull();
  expect(screen.queryByText("A study guide you wrote. Use Edit study guide to change sections.")).toBeNull();
  expect(screen.queryByRole("button", { name: "Edit study guide" })).toBeNull();
  fireEvent.click(within(rows[1]!).getByRole("button", { name: "Edit" }));
  const question = await screen.findByRole("textbox", { name: "Question" }) as HTMLInputElement;
  expect(question.value).toBe("Second picture?");
  expect((screen.getByRole("textbox", { name: "Answer" }) as HTMLInputElement).value).toBe("Bravo");
  expect(screen.getByText(/New or changed cards start fresh reviews for this set; earlier reviews stay saved/)).toBeTruthy();
  fireEvent.change(question, { target: { value: "Updated second picture?" } });
  fireEvent.click(screen.getByRole("button", { name: "Save picture card" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  const saved = await createRepositories(db).documents.readStudySetForEdit("visual-ui");
  expect(saved!.set.flashcards.map((card) => card.front)).toEqual([
    "Text card", "First picture?", "Another text card", "Updated second picture?",
  ]);
  expect(within(list).getByText("Updated second picture?")).toBeTruthy();
  expect(screen.getByText("Picture card saved.").getAttribute("role")).toBe("status");
});

it.each([
  { summary: "A guide summary", sections: [] },
  { summary: "", sections: [{ heading: "A guide section", body: "Fictional section text" }] },
])("keeps a manual guide and its edit button when it has guide content: %j", async (guide) => {
  await seedManualSet([{ front: "Picture?", back: "Alpha", picture: true }], guide);
  mount();
  expect(await screen.findByRole("heading", { name: "Your study guide" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Edit study guide" })).toBeTruthy();
});

it.each([0, 1, 2])("explains removal of %i owned picture cards without counting text cards", async (count) => {
  await seedManualSet([
    { front: "Text card", back: "Text answer" },
    ...Array.from({ length: count }, (_, index) => ({ front: `Picture ${index}?`, back: "Alpha", picture: true })),
  ]);
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
  const dialog = await screen.findByRole("dialog", { name: "Delete this material?" });
  if (count) {
    expect(dialog.textContent).toContain(`Its ${count} picture card${count === 1 ? " is" : "s are"} removed too.`);
  } else {
    expect(dialog.textContent).not.toContain("removed too.");
  }
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(await db.select("SELECT COUNT(*) AS n FROM study_materials")).toEqual([{ n: 1 }]);
});

it("keeps the separate warning for another material's cards that use this picture", async () => {
  await seedManualSet([{ front: "Owned picture?", back: "Alpha", picture: true }]);
  await createRepositories(db).documents.create({ id: "other-owner", title: "Other fictional material" });
  await seedManualSet([{ front: "Other material's picture?", back: "Bravo", picture: true }], { owner: "other-owner" });
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
  const dialog = await screen.findByRole("dialog", { name: "Delete this material?" });
  expect(dialog.textContent).toContain("Its 1 picture card is removed too.");
  expect(dialog.textContent).toContain("These picture cards will become unavailable; their history is kept: Other material's picture?. Earlier exported backups still contain their saved content.");
});

it("starts with a simple cover form, explains disabled actions, and keeps exact and keyboard placement reachable", async () => {
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Add a picture card" }));
  await screen.findByRole("textbox", { name: "Question" });
  const dialog = screen.getByRole("dialog");
  const summary = within(dialog).getByText("Other ways to place the cover (keyboard or exact numbers)");
  const details = summary.closest("details")!;
  expect(details.open).toBe(false);
  expect(within(dialog).queryByRole("spinbutton")).toBeNull();
  expect(within(dialog).queryByRole("combobox", { name: "View rotation" })).toBeNull();
  expect(within(dialog).queryByRole("button", { name: /Cover 1: use arrow keys/ })).toBeNull();
  expect(within(dialog).queryByRole("status")).toBeNull();
  expect((screen.getByRole("button", { name: "Try to remember" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Save picture card" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("Write a question and its answer first.")).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox", { name: "Question" }), { target: { value: "Question?" } });
  expect(screen.getByText("Write a question and its answer first.")).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox", { name: "Answer" }), { target: { value: "   " } });
  expect((screen.getByRole("button", { name: "Try to remember" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByRole("textbox", { name: "Answer" }), { target: { value: "Answer" } });
  expect(screen.queryByText("Write a question and its answer first.")).toBeNull();
  expect((screen.getByRole("button", { name: "Save picture card" }) as HTMLButtonElement).disabled).toBe(false);
  summary.focus();
  expect(document.activeElement).toBe(summary);
  // jsdom does not implement keyboard activation of summary; opening is native HTML behavior.
  fireEvent.click(summary);
  expect(details.open).toBe(true);
  await waitFor(() => expect(within(details).getAllByRole("spinbutton")).toHaveLength(4));
  expect(within(details).getByRole("combobox", { name: "View rotation" })).toBeTruthy();
  const left = within(details).getByRole("spinbutton", { name: "Left" }) as HTMLInputElement;
  fireEvent.change(left, { target: { value: "30" } });
  const arrows = within(details).getByRole("button", { name: "Cover 1: use arrow keys to move" });
  arrows.focus();
  expect(document.activeElement).toBe(arrows);
  fireEvent.keyDown(arrows, { key: "ArrowRight" });
  expect(left.value).toBe("31");
  fireEvent.change(within(details).getByRole("combobox", { name: "Arrow keys" }), { target: { value: "resize" } });
  const width = within(details).getByRole("spinbutton", { name: "Width" }) as HTMLInputElement;
  const previousWidth = Number(width.value);
  fireEvent.keyDown(within(details).getByRole("button", { name: "Cover 1: use arrow keys to resize" }), { key: "ArrowRight" });
  expect(Number(width.value)).toBe(previousWidth + 1);
  expect(within(details).getByRole("status").textContent).toContain("Left 31");
});

it.each([
  ["Which label?", "Which label?"],
  ["Name this label!", "Name this label!"],
  ["Name this label.", "Name this label."],
  ["Name this label", "Name this label."],
])("uses one sentence ending for %s in the editor, card review and homework", async (question, punctuated) => {
  const repositories = await seedManualSet([{ front: question, back: "Synthetic answer", picture: true }]);
  const mounted = mount();
  const list = await screen.findByRole("region", { name: "Your picture cards" });
  fireEvent.click(within(list).getByRole("button", { name: "Edit" }));
  await screen.findByRole("textbox", { name: "Question" });
  fireEvent.click(screen.getByRole("button", { name: "Try to remember" }));
  const revealName = `Covered label 1. ${punctuated} Reveal label`;
  expect(screen.getByRole("button", { name: revealName })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(await screen.findByRole("button", { name: /^(Review \d+ cards?|Start \d+ new cards?)$/ }));
  expect(await screen.findByRole("button", { name: revealName })).toBeTruthy();
  mounted.unmount();

  const fixtures = JSON.parse(readFileSync("src-tauri/fixtures/homework-validation/cases.json", "utf8")) as {
    operations: Record<string, HomeworkOperation>;
  };
  const snapshot = structuredClone(fixtures.operations.card_partial!.next);
  const entry = snapshot.activities[0]!;
  const cards = await repositories.cardReviews.getCardReviewSnapshot("visual-ui");
  if (cards.current.status !== "ok") throw Error("Expected saved picture card");
  entry.record.material_id = "visual-ui";
  const run = snapshot.runs[0]!;
  if (run.kind !== "cards") throw Error("Expected card run fixture");
  run.scope.material_id = "visual-ui";
  run.scope.card_set_id = cards.current.versionId;
  run.scope.generation = cards.generation;
  run.scope.item_ids = cards.current.items.map((card) => card.itemId);
  run.ratings = [];
  render(h(AppDataProvider, null, h(MemoryRouter, null, h(HomeworkCardRun, {
    snapshot, entry, repository: repositories.cardReviews, disabled: false,
    save: vi.fn(), reload: vi.fn(), reopen: vi.fn(),
  }))));
  expect(await screen.findByRole("button", { name: revealName })).toBeTruthy();
  expect(screen.queryByText("Synthetic answer")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: revealName }));
  expect(screen.getByText("Synthetic answer")).toBeTruthy();
});
it("places a modest centre cover, previews without leaking the answer, and cancels without saved rows", async () => {
  mount();
  await draft();
  const dialog = screen.getByRole("dialog");
  const svg = dialog.querySelector("svg[data-cover], .visual-picture svg")!;
  const rect = svg.querySelector("rect")!;
  expect(Number(rect.getAttribute("x"))).toBeGreaterThan(0);
  expect(Number(rect.getAttribute("width"))).toBeLessThan(picture.imageWidth / 2);
  fireEvent.click(screen.getByRole("button", { name: "Try to remember" }));
  expect(dialog.textContent).not.toContain("Bravo synthetic answer");
  expect(dialog.querySelector("input")).toBeNull();
  expect(svg.getAttribute("aria-hidden")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: /Covered label 1.*Reveal label/ }));
  expect(screen.getByRole("status").textContent).toBe("Bravo synthetic answer");
  expect(screen.queryByRole("button", { name: /Covered label 1.*Reveal label/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(await db.select("SELECT * FROM visual_card_regions")).toEqual([]);
  expect(await db.select("SELECT * FROM ai_study_sets")).toEqual([]);
});
it("retries an uncertain save with the exact operation and reviews with the existing reveal/ratings", async () => {
  const real = db.saveStudySetAtomically!.bind(db);
  const ids: string[] = [];
  let first = true;
  vi.spyOn(db, "saveStudySetAtomically").mockImplementation(async (op) => {
    ids.push(op.operationId);
    const result = await real(op);
    if (first) {
      first = false;
      throw new StudySetSaveError("IPC_TRANSPORT_ERROR");
    }
    return result;
  });
  mount();
  await draft();
  fireEvent.click(screen.getByRole("button", { name: "Save picture card" }));
  await screen.findByRole("button", { name: "Try save again" });
  fireEvent.click(screen.getByRole("button", { name: "Try save again" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(ids).toHaveLength(2);
  expect(ids[0]).toBe(ids[1]);
  fireEvent.click(await screen.findByRole("button", { name: /^(Review \d+ cards?|Start \d+ new cards?)$/ }));
  const reveal = await screen.findByRole("button", { name: /Covered label 1.*Reveal label/ });
  const session = screen.getByLabelText(/^Card review session/);
  expect(session.textContent).not.toContain("Bravo synthetic answer");
  expect(session.querySelector('[data-cover="1"]')).not.toBeNull();
  fireEvent.click(reveal);
  expect(within(session).getByRole("status").textContent).toBe("Bravo synthetic answer");
  expect(within(session).queryByRole("button", { name: /Reveal label/ })).toBeNull();
  expect(session.querySelector('[data-cover="1"]')).not.toBeNull();
  fireEvent.click(within(session).getByRole("button", { name: "Show whole picture" }));
  expect(session.querySelector('[data-cover="1"]')).toBeNull();
  expect(await db.select("SELECT * FROM card_review_events")).toEqual([]);
  fireEvent.click(within(session).getByRole("button", { name: /^Good: again in/ }));
  await waitFor(async () => expect(await db.select("SELECT COUNT(*) AS n FROM card_review_events")).toEqual([{ n: 1 }]));
  expect(await db.select("SELECT COUNT(*) AS n FROM card_item_visual_regions")).toEqual([{ n: 1 }]);
});
it("keeps a changed or missing picture unavailable with no answer or rating controls", async () => {
  mount();
  await draft();
  fireEvent.click(screen.getByRole("button", { name: "Save picture card" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  vi.mocked(pictureService.readVisualPicture).mockRejectedValue(Error("This picture has changed."));
  fireEvent.click(await screen.findByRole("button", { name: /^(Review \d+ cards?|Start \d+ new cards?)$/ }));
  await screen.findByText("This picture has changed.");
  const session = screen.getByLabelText(/^Card review session/);
  expect(session.textContent).not.toContain("Bravo synthetic answer");
  expect(within(session).queryByRole("button", { name: /Reveal label|Good: again in/ })).toBeNull();
  fireEvent.keyDown(session, { key: "Enter" });
  fireEvent.keyDown(session, { key: "3" });
  await act(async () => {});
  expect(await db.select("SELECT * FROM card_review_events")).toEqual([]);
});

it("shows only one picture surface when two review sessions are mounted, and switches deliberately", async () => {
  const mounted = mount();
  await draft();
  fireEvent.click(screen.getByRole("button", { name: "Save picture card" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  mounted.unmount();
  const repository = createRepositories(db).cardReviews;
  render(
    h(
      AppDataProvider,
      null,
      h(
        MemoryRouter,
        null,
        h(
          "div",
          null,
          h(CardReviewPanel, { materialId: "visual-ui", materialTitle: "First review", repository, autoStart: true }),
          h(CardReviewPanel, { materialId: "visual-ui", materialTitle: "Second review", repository, autoStart: true }),
        ),
      ),
    ),
  );
  await screen.findByRole("button", { name: "Show this picture" });
  await waitFor(() => expect(document.querySelectorAll(".visual-picture image")).toHaveLength(1));
  fireEvent.click(screen.getByRole("button", { name: "Show this picture" }));
  await waitFor(() => expect(document.querySelectorAll(".visual-picture image")).toHaveLength(1));
  expect(screen.getAllByRole("button", { name: /Reveal label/ })).toHaveLength(1);
  expect(await db.select("SELECT * FROM card_review_events")).toEqual([]);
});

it("keeps the existing cover after a click or a small slip, and draws only on a real drag", async () => {
  const { VisualPicture } = await import("./VisualPicture");
  const onDraw = vi.fn();
  const { container } = render(
    h(VisualPicture, { picture, cover: { x: 10, y: 10, w: 40, h: 20 }, turn: 0, covered: true, onDraw }),
  );
  const svg = container.querySelector("svg") as SVGSVGElement;
  Object.assign(svg, { setPointerCapture: () => {} });
  fireEvent.pointerDown(svg, { clientX: 50, clientY: 50, pointerId: 1 });
  fireEvent.pointerMove(svg, { clientX: 53, clientY: 54, pointerId: 1 });
  fireEvent.pointerUp(svg, { clientX: 53, clientY: 54, pointerId: 1 });
  expect(onDraw).not.toHaveBeenCalled();
  fireEvent.pointerDown(svg, { clientX: 50, clientY: 50, pointerId: 1 });
  fireEvent.pointerUp(svg, { clientX: 90, clientY: 80, pointerId: 1 });
  expect(onDraw).toHaveBeenCalled();
});

it("POLISH-04 says Picture card saved. in Edit study guide after moving a cover, and not before", async () => {
  await seedManualSet([{ front: "Picture?", back: "Alpha", picture: true }], { summary: "A guide summary" });
  mount();
  const edit = await screen.findByRole("button", { name: "Edit study guide" }) as HTMLButtonElement;
  await waitFor(() => expect(edit.disabled).toBe(false));
  fireEvent.click(edit);
  await waitFor(() => expect(edit.getAttribute("aria-pressed")).toBe("true"));
  fireEvent.click(await screen.findByRole("button", { name: "Move or resize cover" }));
  await screen.findByRole("textbox", { name: "Question" });
  expect(screen.queryByText("Picture card saved.")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Save picture card" }));
  const status = await screen.findByText("Picture card saved.");
  expect(status.getAttribute("role")).toBe("status");
  expect(screen.queryByRole("textbox", { name: "Question" })).toBeNull();
});
