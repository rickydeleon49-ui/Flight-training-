// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { AppDataProvider } from "@/state/AppDataContext";
import * as geminiService from "@/services/gemini";
import { SectionalDrill } from "./SectionalDrill";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), tauri: true }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
let db: TestDatabase;
vi.mock("@/data", () => ({ getDatabase: () => Promise.resolve(db), isTauri: () => mocks.tauri }));

let imageFails = false;
beforeEach(async () => {
  mocks.tauri = true; imageFails = false;
  localStorage.clear();
  db = await createNodeSqliteDatabase();
  vi.spyOn(geminiService, "listGeminiJobs").mockResolvedValue([]);
  vi.spyOn(geminiService, "watchGeminiJobs").mockResolvedValue(() => {});
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation(async (cmd: string) => {
    if (cmd === "figure_pack_status") return { installed: true, bytes: 3_000_000 };
    if (cmd === "figure_pack_image") { if (imageFails) throw new Error("x"); return "AAAA"; }
    return undefined;
  });
});
afterEach(() => { cleanup(); db.close(); vi.restoreAllMocks(); });

const view = () => render(h(AppDataProvider, null, h(SectionalDrill)));

describe("SectionalDrill", { timeout: 60_000 }, () => {
  it("renders nothing in browser mode", () => {
    mocks.tauri = false;
    const { container } = view();
    expect(container.querySelector(".figure-pack")).toBeNull();
    expect(screen.queryByText("Sectional chart quiz")).toBeNull();
  });

  it("starts into a question showing a pack figure", async () => {
    view();
    fireEvent.click(await screen.findByRole("button", { name: "Start sectional quiz" }));
    const img = await screen.findByRole("img");
    expect(img.getAttribute("src")?.startsWith("data:image/webp;base64,")).toBe(true);
    expect(screen.getByText(/Question 1 of /)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("button", { name: "Start sectional quiz" })).toBeTruthy();
  });

  it("shows a message when the images cannot be loaded", async () => {
    imageFails = true;
    view();
    fireEvent.click(await screen.findByRole("button", { name: "Start sectional quiz" }));
    expect(await screen.findByText(/The sectional charts could not be opened/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start sectional quiz" })).toBeTruthy();
  });
});
