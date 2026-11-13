// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { GeminiOrphanNotices, markDeletedOnPurpose } from "@/components/gemini/GeminiOrphanNotices";
const state = vi.hoisted(() => ({ model: "claude-haiku-5-5" }));
vi.mock("@/state/AppDataContext", () => ({ useAppData: () => ({ status: "ready", data: { materials: [] } }) }));
vi.mock("@/state/GeminiJobs", () => ({ useGeminiJobs: () => ({ jobs: [{ key: "synthetic", materialId: "removed", kind: "study-aid", phase: "recovered", answer: { model: state.model } }], dismiss: vi.fn() }) }));
afterEach(cleanup);
it.each(["claude-haiku-5-5", "gemini-3.5-flash"])("names the saved answer's provider %s for a deleted material", model => {
  state.model = model;
  render(h(GeminiOrphanNotices));
  expect(screen.getByRole("region", { name: "AI answers for deleted documents" })).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain(`${model.startsWith("claude-") ? "Claude" : "Gemini"} finished a study guide and cards`);
});
it("shows no notice and clears the answer for a document she deleted on purpose", () => {
  markDeletedOnPurpose("removed");
  render(h(GeminiOrphanNotices));
  expect(screen.queryByRole("region", { name: "AI answers for deleted documents" })).toBeNull();
});
