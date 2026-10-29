// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { EMPTY_DATA, type AppData } from "@/state/AppDataContext";

let mutateResult: unknown = { id: "n1" };
vi.mock("@/state/AppDataContext", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useAppData: () => ({
    data: EMPTY_DATA as AppData,
    mutate: vi.fn(async () => mutateResult),
    deleteWithUndo: vi.fn(),
  }),
}));

import { Notes } from "./Notes";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  mutateResult = { id: "n1" };
});
afterEach(cleanup);

it("POLISH-04 says Saved. after Save note, and clears it when she starts the next note", async () => {
  render(h(MemoryRouter, null, h(Notes)));
  const note = screen.getByRole("textbox", { name: "Note" });
  fireEvent.change(note, { target: { value: "Call the school after four." } });
  expect(screen.queryByText("Saved.")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));
  const status = await screen.findByText("Saved.");
  expect(status.getAttribute("role")).toBe("status");
  expect((note as HTMLTextAreaElement).value).toBe("");
  fireEvent.change(note, { target: { value: "Next thought" } });
  expect(screen.queryByText("Saved.")).toBeNull();
});

it("POLISH-04 says nothing when the save did not happen", async () => {
  mutateResult = null;
  render(h(MemoryRouter, null, h(Notes)));
  fireEvent.change(screen.getByRole("textbox", { name: "Note" }), { target: { value: "Kept draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));
  await waitFor(() => expect((screen.getByRole("button", { name: "Save note" }) as HTMLButtonElement).disabled).toBe(false));
  expect(screen.queryByText("Saved.")).toBeNull();
  expect((screen.getByRole("textbox", { name: "Note" }) as HTMLTextAreaElement).value).toBe("Kept draft");
});
