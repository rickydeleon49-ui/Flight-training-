// @vitest-environment jsdom
/** Choosing the Gemini model in Settings, once a key is connected. */
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { Settings } from "@/pages/Settings/Settings";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";
import * as backupService from "@/services/backups";
import * as appDataApi from "@/data";
import * as providerService from "@/services/provider";
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
const CAPABLE: geminiService.GeminiStatus = { configured: true, model: "gemini-3.8-flash", choice: "most-capable" };

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

  it("shows Connected in the AI provider header for selected Claude without a Gemini key", async () => {
    vi.spyOn(appDataApi, "isTauri").mockReturnValue(true);
    vi.spyOn(backupService, "backupsAvailable").mockReturnValue(false);
    vi.spyOn(providerService, "providerStatus").mockResolvedValue({selected:"claude",providers:[{id:"gemini",connected:false},{id:"claude",connected:true}]});
    vi.spyOn(geminiService, "getGeminiStatus").mockResolvedValue({...STANDARD,configured:false});
    await open();
    await screen.findByText(/Claude Haiku 5.5 · Ready to use/);
    const header = screen.getByRole("heading",{name:"AI provider"}).closest("header")!;
    await waitFor(()=>expect(header.querySelector(".card__eyebrow")!.textContent).toBe("Connected"));
  });

  it("explains busy messages in two plain sentences with useful next steps", async () => {
    vi.spyOn(geminiService, "getGeminiStatus").mockResolvedValue(STANDARD);
    await open();
    const paragraph = (await screen.findByText("If Gemini keeps saying it is busy:")).closest("p")!.textContent!.replace(/\s+/g, " ");
    expect(paragraph).toContain("A “busy” message means Google is overloaded, not that your key is wrong.");
    expect(paragraph).toContain("Her Flight Deck already waits and retries; if it keeps happening, try again later or switch to Standard.");
    expect(paragraph).not.toMatch(/billing|Tier 1|503|Google Cloud/i);
    expect(paragraph.match(/\./g)).toHaveLength(2);
  });

  it("shows the choice only once Gemini is connected", async () => {
    vi.spyOn(geminiService, "getGeminiStatus").mockResolvedValue({ ...STANDARD, configured: false });
    await open();
    await screen.findByText("AI provider");
    expect(screen.queryByText("Model for new study aids")).toBeNull();
  });

  it.each([STANDARD, CAPABLE])("offers only the current pair with $choice selected", async (status) => {
    vi.spyOn(geminiService, "getGeminiStatus").mockResolvedValue(status);
    await open();
    await screen.findByRole("radio", { name: /Most capable — Gemini 3.8 Flash/ });
    expect(screen.getAllByRole("radio", { name: /Standard —|Most capable —/ })).toHaveLength(2);
    expect(document.body.textContent).not.toMatch(/Argon|costs more per document|needs a key with billing turned on/i);
  });

  it("switches to Gemini 3.8 Flash and back, saying what changes and what does not", async () => {
    vi.spyOn(geminiService, "getGeminiStatus").mockResolvedValue(STANDARD);
    const choose = vi
      .spyOn(geminiService, "setGeminiModel")
      .mockImplementation(async (choice) => (choice === "most-capable" ? CAPABLE : STANDARD));
    await open();

    const standard = await screen.findByRole("radio", { name: /Standard — Gemini 3.5 Flash/ });
    const capable = screen.getByRole("radio", { name: /Most capable — Gemini 3.8 Flash/ });
    expect((standard as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/Gemini 3.5 Flash · key saved on this computer/)).toBeTruthy();
    expect(screen.queryByText(/is the default for new study aids/)).toBeNull();

    await act(async () => {
      fireEvent.click(capable);
    });
    expect(choose).toHaveBeenCalledWith("most-capable");
    await screen.findByText(
      "New study aids will use Gemini 3.8 Flash. Saved study guides and flashcards are unchanged.",
    );
    expect((capable as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText("Gemini 3.8 Flash is the default for new study aids.")).toBeTruthy();
    expect(screen.getByText(/Gemini 3.8 Flash · key saved on this computer/)).toBeTruthy();
    expect(
      screen.getByText(
        /If Gemini 3.8 Flash is busy, temporarily rate-limited or unavailable to this key, Her Flight Deck tries Gemini 3.5 Flash instead and shows which model made each study aid/,
      ),
    ).toBeTruthy();
    expect(screen.getByText(/check this key's access in Google AI Studio/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Argon|costs more per document|needs a key with billing turned on/i);

    await act(async () => {
      fireEvent.click(standard);
    });
    expect(choose).toHaveBeenLastCalledWith("standard");
    await screen.findByText(
      "New study aids will use Gemini 3.5 Flash. Saved study guides and flashcards are unchanged.",
    );
  });

  it("keeps the current choice and reports the problem when saving it fails", async () => {
    vi.spyOn(geminiService, "getGeminiStatus").mockResolvedValue(STANDARD);
    vi.spyOn(geminiService, "setGeminiModel").mockRejectedValue("Could not save the Gemini model choice: disk full");
    await open();
    const capable = await screen.findByRole("radio", { name: /Most capable — Gemini 3.8 Flash/ });
    await act(async () => {
      fireEvent.click(capable);
    });
    expect((await screen.findByRole("alert")).textContent).toContain("Could not save the Gemini model choice");
    expect((screen.getByRole("radio", { name: /Standard — Gemini 3.5 Flash/ }) as HTMLInputElement).checked).toBe(true);
  });
});
