// @vitest-environment jsdom
import { createElement as h, type ContextType } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { AppDataContext } from "@/state/AppDataContext";

import { UndoBar } from "./UndoBar";

afterEach(cleanup);

function ui(pendingDelete: { label: string; ids: string[] } | null) {
  const value = { pendingDelete, undoDelete: vi.fn() } as unknown as ContextType<typeof AppDataContext>;
  return h(AppDataContext.Provider, { value }, h(UndoBar));
}

it("keeps the status region mounted and fills it when a delete is pending", () => {
  const view = render(ui(null));
  const region = screen.getByRole("status");
  expect(region.getAttribute("aria-live")).toBe("polite");
  expect(region.textContent).toBe("");
  view.rerender(ui({ label: "Sample card", ids: ["a"] }));
  expect(screen.getByRole("status")).toBe(region);
  expect(region.textContent).toContain("Deleted Sample card");
  expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
});
