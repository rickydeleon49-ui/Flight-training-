import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { resumeStudyGuide, restartStudyGuide, sectionGuideError, SECTION_GUIDE_MESSAGES, GEMINI_CANCELLED_MESSAGE } from "./gemini";
import { invokeStudySetSave } from "@/data/tauriDb";
vi.mock("@/data", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const request = { materialId: "synthetic", relativePath: "documents/synthetic.pdf", chosenPages: [1, 2], baseRevision: null };
beforeEach(() => { vi.mocked(invoke).mockReset(); });
describe("section command and typed-error boundary", () => {
  it("passes only her source request and the same job id to resume", async () => {
    vi.mocked(invoke).mockResolvedValue({ title: "Synthetic" }); await resumeStudyGuide(request, "same-job");
    expect(invoke).toHaveBeenCalledWith("resume_study_guide", { request, jobId: "same-job" });
  });
  it("passes explicit consent to restart", async () => {
    vi.mocked(invoke).mockResolvedValue({}); await restartStudyGuide("old-job", true, request);
    expect(invoke).toHaveBeenCalledWith("restart_study_guide", { jobId: "old-job", consent: true, request });
  });
  it.each(Object.keys(SECTION_GUIDE_MESSAGES).filter(code => code !== "GUIDE_PAUSED"))("maps %s without showing raw provider text", async code => {
    vi.mocked(invoke).mockRejectedValue({ code, message: "files/private https://provider.invalid/private" });
    await expect(resumeStudyGuide(request, "same-job")).rejects.toMatchObject({ code, message: SECTION_GUIDE_MESSAGES[code as keyof typeof SECTION_GUIDE_MESSAGES] });
  });
  it.each(["constructor", "__proto__", "files/private https://provider.invalid/private"])("unknown text stays generic", message => {
    expect(sectionGuideError(message)).toMatchObject({ code: "GUIDE_PAUSED", message: SECTION_GUIDE_MESSAGES.GUIDE_PAUSED });
  });
  it.each(["FUTURE_CODE", "__proto__", "constructor"])("unknown %s stays generic", async code => {
    vi.mocked(invoke).mockRejectedValue({ code, message: "files/private https://provider.invalid/private" });
    await expect(restartStudyGuide("job", true, request)).rejects.toMatchObject({ code: "GUIDE_PAUSED", message: SECTION_GUIDE_MESSAGES.GUIDE_PAUSED });
  });
  it.each([
    [GEMINI_CANCELLED_MESSAGE, "CANCELLED"],
    ["The upload stopped moving. Your saved work is still here.", "UPLOAD_TIMEOUT"],
    ["Google was still preparing this PDF after waiting, so no study aid was made. Try again in a few minutes.", "PROCESSING_TIMEOUT"],
    ["Gemini is taking longer to answer. You can try again.", "GENERATION_TIMEOUT"],
    ["The rest of the answer stopped arriving.", "READING_TIMEOUT"],
  ])("maps the existing native stage sentence safely", (message, code) => {
    expect(sectionGuideError({ code: "GUIDE_PAUSED", message }).code).toBe(code);
  });
  it("uses the native guide save guard and preserves a changed-source refusal", async () => {
    const call = vi.fn<typeof invoke>().mockRejectedValue({ code: "SOURCE_CHANGED", message: "files/private https://provider.invalid/private" });
    await expect(invokeStudySetSave({} as never, call as typeof invoke, "same-job")).rejects.toMatchObject({ code: "SOURCE_CHANGED", message: SECTION_GUIDE_MESSAGES.SOURCE_CHANGED });
    expect(call).toHaveBeenCalledWith("save_study_set_atomically", { operation: {}, guideJobId: "same-job" });
  });
});
