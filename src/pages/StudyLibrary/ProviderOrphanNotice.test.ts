// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { GeminiOrphanNotices, markDeletedOnPurpose } from "@/components/gemini/GeminiOrphanNotices";
const state = vi.hoisted(() => ({ model: "claude-haiku-5-5", pending: null as null | { ids: string[] }, dismiss: vi.fn() }));
vi.mock("@/state/AppDataContext", () => ({ useAppData: () => ({ status: "ready", data: { materials: [] }, pendingDelete: state.pending }) }));
vi.mock("@/state/GeminiJobs", () => ({ useGeminiJobs: () => ({ jobs: [{ key: "synthetic", materialId: "removed", kind: "study-aid", phase: "recovered", answer: { model: state.model } }], dismiss: state.dismiss }) }));
afterEach(cleanup);
it.each(["claude-haiku-5-5", "gemini-3.5-flash"])("names the saved answer's provider %s for a deleted material", model => {
  state.model = model;
  render(h(GeminiOrphanNotices));
  expect(screen.getByRole("region", { name: "AI answers for deleted documents" })).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain(`${model.startsWith("claude-") ? "Claude" : "Gemini"} finished a study guide and cards`);
});
it("shows no notice and clears the answer for a document she deleted on purpose", () => {
  markDeletedOnPurpose("removed");
  // During the Undo window the drafts stay, so Undo brings them back too.
  state.pending = { ids: ["removed"] }; state.dismiss.mockClear();
  render(h(GeminiOrphanNotices));
  expect(screen.queryByRole("region", { name: "AI answers for deleted documents" })).toBeNull();
  expect(state.dismiss).not.toHaveBeenCalled();
  cleanup();
  // Once the delete is final, they are cleared quietly.
  state.pending = null;
  render(h(GeminiOrphanNotices));
  expect(screen.queryByRole("region", { name: "AI answers for deleted documents" })).toBeNull();
  expect(state.dismiss).toHaveBeenCalledWith("synthetic");
});
