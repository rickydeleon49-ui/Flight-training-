// @vitest-environment jsdom
/** Choosing the Gemini model in Settings, once a key is connected. */
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { Settings } from "@/pages/Settings/Settings";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";
import * as geminiService from "@/services/gemini";

let db: TestDatabase;
vi.mock("@/data", () => ({
  getDatabase: () => Promise.resolve(db),
  isTauri: () => false,
}));

let context: ReturnType<typeof useAppData>;
function Probe() {
  context = useAppData();
  return null;
}
function Ready() {
  return useAppData().status === "ready"
    ? h(Routes, null, h(Route, { path: "/settings", element: h(Settings) }))
    : null;
}
async function open() {
  render(h(AppDataProvider, null, h(MemoryRouter, { initialEntries: ["/settings"] }, h(Probe), h(Ready))));
  await waitFor(() => expect(context.status).toBe("ready"));
}

const STANDARD: geminiService.GeminiStatus = { configured: true, model: "gemini-3.5-flash", choice: "standard" };
const ARGON: geminiService.GeminiStatus = { configured: true, model: "gemini-4-argon", choice: "most-capable" };

describe("Gemini model choice in Settings", () => {
  beforeEach(async () => {
    localStorage.clear();
    db = await createNodeSqliteDatabase();
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute("open");
    };
  });

  afterEach(() => {
    cleanup();
    db.close();
    vi.restoreAllMocks();
  });

  it("shows the choice only once Gemini is connected", async () => {
    vi.spyOn(geminiService, "getGeminiStatus").mockResolvedValue({ ...STANDARD, configured: false });
    await open();
    await screen.findByText("Gemini study assistant");
    expect(screen.queryByText("Model for new study aids")).toBeNull();
  });

  it("switches to Gemini 4 Argon and back, saying what changes and what does not", async () => {
    vi.spyOn(geminiService, "getGeminiStatus").mockResolvedValue(STANDARD);
    const choose = vi
      .spyOn(geminiService, "setGeminiModel")
      .mockImplementation(async (choice) => (choice === "most-capable" ? ARGON : STANDARD));
    await open();

    const standard = await screen.findByRole("radio", { name: /Standard — Gemini Flash/ });
    const argon = screen.getByRole("radio", { name: /Most capable — Gemini 4 Argon/ });
    expect((standard as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/Gemini Flash · key saved on this computer/)).toBeTruthy();

    await act(async () => {
      fireEvent.click(argon);
    });
    expect(choose).toHaveBeenCalledWith("most-capable");
    await screen.findByText(
      "New study aids will use Gemini 4 Argon. Saved study guides and flashcards are unchanged.",
    );
    expect((argon as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/Gemini 4 Argon · key saved on this computer/)).toBeTruthy();
    expect(screen.getByText(/tries Gemini Flash instead and shows which model made each study aid/)).toBeTruthy();

    await act(async () => {
      fireEvent.click(standard);
    });
    expect(choose).toHaveBeenLastCalledWith("standard");
    await screen.findByText(
      "New study aids will use Gemini Flash. Saved study guides and flashcards are unchanged.",
    );
  });

  it("keeps the current choice and reports the problem when saving it fails", async () => {
    vi.spyOn(geminiService, "getGeminiStatus").mockResolvedValue(STANDARD);
    vi.spyOn(geminiService, "setGeminiModel").mockRejectedValue("Could not save the Gemini model choice: disk full");
    await open();
    const argon = await screen.findByRole("radio", { name: /Most capable — Gemini 4 Argon/ });
    await act(async () => {
      fireEvent.click(argon);
    });
    expect((await screen.findByRole("alert")).textContent).toContain("Could not save the Gemini model choice");
    expect((screen.getByRole("radio", { name: /Standard — Gemini Flash/ }) as HTMLInputElement).checked).toBe(true);
  });
});
