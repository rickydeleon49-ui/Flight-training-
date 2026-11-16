// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement as h, type ContextType } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";

import { AppDataContext, EMPTY_DATA } from "@/state/AppDataContext";
import { makeMaterial } from "@/testing/factories";
import { OralScenarioEditor } from "./OralScenarioEditor";

afterEach(cleanup);

it("focuses the new field after Add a follow-up question", () => {
  const value = { repositories: null, data: EMPTY_DATA, visibleData: EMPTY_DATA, status: "ready", error: null, mutate: vi.fn(), deleteWithUndo: vi.fn() } as unknown as ContextType<typeof AppDataContext>;
  render(h(AppDataContext.Provider, { value }, h(MemoryRouter, null, h(OralScenarioEditor, { material: makeMaterial(), scenario: null, open: true, onClose: vi.fn() }))));
  fireEvent.click(screen.getByRole("button", { name: "Add a follow-up question" }));
  expect(document.activeElement).toBe(screen.getByLabelText("Follow-up question 1"));
  fireEvent.click(screen.getByRole("button", { name: "Add a follow-up question" }));
  expect(document.activeElement).toBe(screen.getByLabelText("Follow-up question 2"));
});
