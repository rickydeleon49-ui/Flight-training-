import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listPdfStudyKitJobs } from "./documents";
import { listGeminiJobs } from "./gemini";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/data", () => ({ isTauri: () => true }));
beforeEach(() => { vi.mocked(invoke).mockResolvedValue([{ id: "local", kind: "pdf-kit" }, { id: "remote", kind: "study-aid" }, { id: "practice", kind: "practice-test" }]); });
afterEach(() => vi.clearAllMocks());
it("keeps local PDF journals out of Gemini recovery", async () => { expect((await listGeminiJobs()).map(j => j.id)).toEqual(["remote", "practice"]); expect((await listPdfStudyKitJobs()).map(j => j.id)).toEqual(["local"]); });
