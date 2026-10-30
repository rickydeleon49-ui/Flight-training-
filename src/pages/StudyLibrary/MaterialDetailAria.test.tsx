// @vitest-environment jsdom
import { I18nProvider } from "react-aria";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { createRepositories } from "@/data/repositories";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";
import * as documents from "@/services/documents";
import * as gemini from "@/services/gemini";
import * as pdf from "@/services/pdf";
import * as offline from "@/services/offlineContent";
import { MaterialDetail } from "./MaterialDetail";
import { expectNoA11yViolations } from "@/testing/a11y";

let db: TestDatabase;
vi.mock("@/data", () => ({ getDatabase: () => Promise.resolve(db), isTauri: () => false }));
function Address() { const location = useLocation(); const navigate = useNavigate(); return h("div", null,
  h("output", { "data-testid": "address" }, location.search + location.hash),
  h("button", { onClick: () => navigate(-1) }, "History back")); }
function Ready() {
  const context = useAppData();
  return context.status === "ready" ? h(Routes, null, h(Route, { path: "/study/:materialId", element: h(MaterialDetail) })) : null;
}
beforeEach(async () => {
  localStorage.clear(); db = await createNodeSqliteDatabase();
  await createRepositories(db).documents.create({ id: "tips", title: "Synthetic PDF", filePath: "documents/synthetic.pdf", originalFileName: "synthetic.pdf", fileSize: 2048 });
  vi.spyOn(documents, "canHandleFiles").mockReturnValue(true);
  vi.spyOn(documents, "documentExists").mockResolvedValue(true);
  vi.spyOn(pdf, "canSplitPdfs").mockReturnValue(true);
  vi.spyOn(offline, "offlineStudyEnabled").mockReturnValue(true);
  vi.spyOn(offline, "offlineContentReadiness").mockResolvedValue([{ materialId: "tips", readiness: { state: "notPrepared" } }]);
  vi.spyOn(gemini, "getGeminiStatus").mockResolvedValue({ configured: false, model: "gemini-3.5-flash", choice: "standard" });
  vi.spyOn(gemini, "watchGeminiProgress").mockResolvedValue(() => {});
});
afterEach(() => { cleanup(); db.close(); vi.restoreAllMocks(); });

async function open(search = "", locale = "en-US") {
  render(<I18nProvider locale={locale}>{h(AppDataProvider, null, h(MemoryRouter, { initialEntries: ["/before", `/study/tips${search}`], initialIndex: 1 }, h(Address), h(Ready)))}</I18nProvider>);
  await screen.findByRole("tab", { name: "Study" });
}

const values = ["study", "notes", "more"];
function selected(index: number, focused = false) {
  const tabs = screen.getAllByRole("tab");
  expect(tabs.map((tab) => tab.tabIndex)).toEqual(values.map((_, i) => i === index ? 0 : -1));
  tabs.forEach((tab, i) => {
    expect(tab.id).toBe(`material-tab-${values[i]}`);
    expect(tab.className).toBe(`library-tab tab${i === index ? " is-active" : ""}`);
    expect(tab.getAttribute("aria-selected")).toBe(String(i === index));
    const panel = document.getElementById(`material-panel-${values[i]}`)!;
    expect(tab.getAttribute("aria-controls")).toBe(panel.id);
    expect(panel.getAttribute("aria-labelledby")).toBe(tab.id);
    expect(panel.hidden).toBe(i !== index);
    const heading = document.getElementById(`material-panel-heading-${values[i]}`)!;
    expect(heading.tagName).toBe("H2");
    expect(heading.className).toBe("visually-hidden material-panel-heading");
  });
  if (focused) expect(document.activeElement).toBe(tabs[index]);
}

it("automatically selects with arrows/Home/End, wraps and keeps one tab stop and URL state", async () => {
  await open("?keep=yes");
  selected(0);
  act(() => screen.getAllByRole("tab")[0]!.focus());
  for (const [key, index] of [["ArrowRight", 1], ["ArrowRight", 2], ["ArrowRight", 0], ["ArrowLeft", 2], ["Home", 0], ["End", 2]] as const) {
    fireEvent.keyDown(document.activeElement!, { key });
    selected(index, true);
    const params = new URLSearchParams(screen.getByTestId("address").textContent!);
    expect(params.get("keep")).toBe("yes");
    expect(params.get("tab")).toBe(index === 0 ? null : values[index]);
  }
});

it.each(["Enter", " "])("%j still focuses the selected panel heading on every tab", async (key) => {
  await open();
  for (const [index, value] of values.entries()) {
    const tab = screen.getAllByRole("tab")[index]!;
    fireEvent.click(tab);
    act(() => tab.focus());
    fireEvent.keyDown(tab, { key, code: key === " " ? "Space" : "Enter" });
    selected(index);
    expect(document.activeElement?.id).toBe(`material-panel-heading-${value}`);
    fireEvent.keyUp(tab, { key, code: key === " " ? "Space" : "Enter" });
    expect(document.activeElement?.id).toBe(`material-panel-heading-${value}`);
  }
});

it.each(values)("?tab=%s opens the existing panel and passes axe", async (value) => {
  // File-free material exercises all three panels without the separate PDF page widget.
  await createRepositories(db).documents.update("tips", { filePath: null, originalFileName: null });
  await open(`?tab=${value}`);
  selected(values.indexOf(value));
  await expectNoA11yViolations(document.body);
});

it.each([
  ["?tab=notes#material-study-guide", 0, "material-study-guide"],
  ["?tab=study#material-mac-backup", 2, "material-mac-backup"],
])("%s opens and focuses its anchor", async (path, index, target) => {
  await createRepositories(db).documents.saveAiStudySet({ sourceMaterialId: "tips", title: "Synthetic guide", summary: "Synthetic summary", sections: [], flashcards: [], sourceNotes: "", model: "test" });
  await open(path);
  await waitFor(() => expect(document.activeElement?.id).toBe(target));
  selected(index);
  expect(screen.getByTestId("address").textContent).toContain(`#${target}`);
});

it("#read-pdf-text opens More and focuses its reading control", async () => {
  await open("?tab=notes#read-pdf-text");
  await waitFor(() => selected(2));
  await waitFor(() => {
    const target = document.getElementById("read-pdf-text")!;
    expect(target).toBeTruthy();
    expect(target.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(target.querySelector("button"));
  });
  expect(screen.getByTestId("address").textContent).toBe("?tab=more#read-pdf-text");
});

it("follows right-to-left arrow direction through the tab hook", async () => {
  await open("", "ar-AE");
  act(() => screen.getAllByRole("tab")[0]!.focus());
  fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
  selected(1, true);
  fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
  selected(0, true);
});
