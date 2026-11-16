// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, configure, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { MyAircraftDialog } from "@/pages/StudyLibrary/MyAircraftDialog";
import { AppDataProvider } from "@/state/AppDataContext";
import * as geminiService from "@/services/gemini";

let db: TestDatabase;
vi.mock("@/data", () => ({ getDatabase: () => Promise.resolve(db), isTauri: () => false }));
configure({ asyncUtilTimeout: 20_000 });
const SLOW = { timeout: 20_000 };

beforeEach(async () => {
  localStorage.clear();
  db = await createNodeSqliteDatabase();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  vi.spyOn(geminiService, "listGeminiJobs").mockResolvedValue([]);
  vi.spyOn(geminiService, "watchGeminiJobs").mockResolvedValue(() => {});
});
afterEach(() => { cleanup(); db.close(); vi.restoreAllMocks(); });

const cardsOf = async () => {
  const rows = await db.select<{ flashcards_json: string }>("SELECT flashcards_json FROM ai_study_sets");
  return rows.flatMap((r) => JSON.parse(r.flashcards_json) as { front: string; back: string; origin?: string }[]);
};

describe("My aircraft dialog", { timeout: 60_000 }, () => {
  it("shows empty fields with unit-only placeholders and the POH note", async () => {
    render(h(AppDataProvider, null, h(MyAircraftDialog)));
    fireEvent.click(await screen.findByRole("button", { name: "My aircraft cards" }, SLOW));
    expect(await screen.findByText(/Your instructor's POH numbers win/)).toBeTruthy();
    const inputs = screen.getAllByRole("textbox") as HTMLInputElement[];
    expect(inputs.every((i) => i.value === "")).toBe(true);
    for (const i of inputs) expect(i.placeholder).toMatch(/^(|KIAS|gal|qt)$/);
  });

  it("saves one set of user cards and updates them on a second save", async () => {
    render(h(AppDataProvider, null, h(MyAircraftDialog)));
    fireEvent.click(await screen.findByRole("button", { name: "My aircraft cards" }, SLOW));
    fireEvent.change(await screen.findByLabelText("Aircraft type"), { target: { value: "Fake-172" } });
    fireEvent.change(screen.getByLabelText("Vy (best rate of climb)"), { target: { value: "70" } });
    fireEvent.click(screen.getByRole("button", { name: "Save 1 card" }));
    await waitFor(async () => expect(await cardsOf()).toHaveLength(1), SLOW);
    expect((await cardsOf())[0]).toMatchObject({ front: "Fake-172: Vy (best rate of climb)?", back: "70 KIAS", origin: "user" });

    fireEvent.click(await screen.findByRole("button", { name: "My aircraft cards" }, SLOW));
    fireEvent.change(await screen.findByLabelText("Aircraft type"), { target: { value: "Fake-172" } });
    fireEvent.change(screen.getByLabelText("Vy (best rate of climb)"), { target: { value: "72" } });
    fireEvent.change(screen.getByLabelText("Vne (never exceed)"), { target: { value: "160" } });
    fireEvent.click(screen.getByRole("button", { name: "Save 2 cards" }));
    await waitFor(async () => expect(await cardsOf()).toHaveLength(2), SLOW);
    const sets = await db.select<{ n: number }>("SELECT COUNT(*) AS n FROM ai_study_sets");
    expect(sets[0]!.n).toBe(1);
    expect((await cardsOf()).find((c) => c.front.includes("Vy"))!.back).toBe("72 KIAS");
  });

  it("reopens with the saved aircraft filled in, and re-saving keeps one card per field", async () => {
    render(h(AppDataProvider, null, h(MyAircraftDialog)));
    fireEvent.click(await screen.findByRole("button", { name: "My aircraft cards" }, SLOW));
    fireEvent.change(await screen.findByLabelText("Aircraft type"), { target: { value: "Fake-172" } });
    fireEvent.change(screen.getByLabelText("Vy (best rate of climb)"), { target: { value: "70" } });
    fireEvent.change(screen.getByLabelText("Memory item 1: prompt"), { target: { value: "Fake step" } });
    fireEvent.change(screen.getByLabelText("Memory item 1: answer"), { target: { value: "Fake answer" } });
    fireEvent.click(screen.getByRole("button", { name: "Save 2 cards" }));
    await waitFor(async () => expect(await cardsOf()).toHaveLength(2), SLOW);

    fireEvent.click(await screen.findByRole("button", { name: "My aircraft cards" }, SLOW));
    await waitFor(() => expect((screen.getByLabelText("Aircraft type") as HTMLInputElement).value).toBe("Fake-172"), SLOW);
    expect((screen.getByLabelText("Vy (best rate of climb)") as HTMLInputElement).value).toBe("70 KIAS");
    expect((screen.getByLabelText("Memory item 1: prompt") as HTMLInputElement).value).toBe("Fake step");
    fireEvent.change(screen.getByLabelText("Memory item 1: prompt"), { target: { value: "Fake step reworded" } });
    fireEvent.click(screen.getByRole("button", { name: "Save 2 cards" }));
    await waitFor(async () => expect((await cardsOf()).some((c) => c.front === "Fake step reworded")).toBe(true), SLOW);
    const cards = await cardsOf();
    expect(cards).toHaveLength(2);
    expect(cards.find((c) => c.front.includes("Vy"))!.back).toBe("70 KIAS");

    fireEvent.click(await screen.findByRole("button", { name: "My aircraft cards" }, SLOW));
    fireEvent.change(await screen.findByLabelText("Aircraft"), { target: { value: "new" } });
    expect((screen.getByLabelText("Aircraft type") as HTMLInputElement).value).toBe("");
  });
});
