import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listPdfStudyKitJobs } from "./documents";
import { listGeminiJobs } from "./gemini";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/data", () => ({ isTauri: () => true }));
beforeEach(() => { vi.mocked(invoke).mockResolvedValue([{ id: "local", kind: "pdf-kit" }, { id: "remote", kind: "study-aid" }, { id: "practice", kind: "practice-test" }]); });
afterEach(() => vi.clearAllMocks());
it("keeps local PDF journals out of Gemini recovery", async () => { expect((await listGeminiJobs()).map(j => j.id)).toEqual(["remote", "practice"]); expect((await listPdfStudyKitJobs()).map(j => j.id)).toEqual(["local"]); });

it("keeps_the_run_id_for_discarding_only_that_kits_local_mirrors", async () => {
  vi.mocked(invoke).mockResolvedValue([{ id: "local", kind: "pdf-kit", materialId: "mat-a", stage: "ready", createdAt: 1, draft: { runId: "run-a" } }]);
  expect(await listPdfStudyKitJobs()).toEqual([expect.objectContaining({ id: "local", runId: "run-a" })]);
});
