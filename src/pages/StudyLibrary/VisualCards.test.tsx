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
import * as pictureService from "@/services/visualCards";
import * as gemini from "@/services/gemini";
import * as documents from "@/services/documents";
import { MaterialDetail } from "./MaterialDetail";
import { CardReviewPanel } from "./CardReviewPanel";
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
  fireEvent.click(await screen.findByRole("button", { name: "Cover a label" }));
  await screen.findByRole("textbox", { name: "Question" });
  fireEvent.change(screen.getByRole("textbox", { name: "Question" }), { target: { value: "Which centre label?" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Answer" }), { target: { value: "Bravo synthetic answer" } });
}
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
  fireEvent.click(await screen.findByRole("button", { name: "Review cards" }));
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
  fireEvent.click(await screen.findByRole("button", { name: "Review cards" }));
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
