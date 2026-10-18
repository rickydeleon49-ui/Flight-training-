// @vitest-environment jsdom
/**
 * Rendered integration regressions for saved study content provenance (ROADMAP §7.C).
 *
 * Verifies that MaterialDetail:
 * 1. Renders distinct provenance for saved study guides/flashcards and saved practice tests,
 *    without borrowing each other's model/timestamp or the active Gemini setting.
 * 2. Displays imported packet provenance as "Imported study packet" and "Imported <date>"
 *    without suggesting a model, original generation date, or instructor verification.
 * 3. Handles empty models, invalid timestamps, and missing titles with clear unavailable wording.
 * 4. Remains fully readable and functional when Gemini is disconnected/failed and the source file is missing.
 * 5. Refreshes correctly on content replacement and material navigation while preserving attempt history.
 * 6. Demonstrates that omitting provenance integration causes relevant assertions to fail.
 */
import { createElement as h } from "react";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRepositories, type Repositories } from "@/data/repositories";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { MaterialDetail } from "@/pages/StudyLibrary/MaterialDetail";
import { IMPORTED_CONTENT_DISCLAIMER } from "@/pages/StudyLibrary/ImportStudyPacketDialog";
import * as documentService from "@/services/documents";
import * as geminiService from "@/services/gemini";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";

let db: TestDatabase;
vi.mock("@/data", () => ({
  getDatabase: () => Promise.resolve(db),
  isTauri: () => false,
}));

let context: ReturnType<typeof useAppData>;
let navigate: ReturnType<typeof useNavigate>;

function Probe() {
  context = useAppData();
  navigate = useNavigate();
  return null;
}

function Ready() {
  const { status } = useAppData();
  return status === "ready"
    ? h(
        Routes,
        null,
        h(Route, { path: "/study/:materialId", element: h(MaterialDetail) }),
        h(Route, { path: "*", element: h("p", null, "Other") }),
      )
    : null;
}

async function openMaterial(materialId: string) {
  render(
    h(
      AppDataProvider,
      null,
      h(MemoryRouter, { initialEntries: [`/study/${materialId}`] }, h(Probe), h(Ready)),
    ),
  );
  await waitFor(() => expect(context.status).toBe("ready"));
}

let repos: Repositories;
let originalTZ: string | undefined;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-13T12:00:00Z"));
  originalTZ = process.env.TZ;
  process.env.TZ = "UTC";
  try {
    localStorage?.clear?.();
  } catch {}
  db = await createNodeSqliteDatabase();
  repos = createRepositories(db);

  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };

  // Configured Gemini model in settings is deliberately distinct from saved content models.
  vi.spyOn(geminiService, "getGeminiStatus").mockResolvedValue({
    configured: true,
    model: "gemini-3.5-flash-configured-in-settings",
    choice: "standard",
  });
  vi.spyOn(geminiService, "watchGeminiProgress").mockResolvedValue(() => {});
  vi.spyOn(documentService, "canHandleFiles").mockReturnValue(true);
  vi.spyOn(documentService, "documentExists").mockResolvedValue(true);
});

afterEach(() => {
  cleanup();
  db.close();
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (originalTZ === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = originalTZ;
  }
});

describe("MaterialDetail saved content provenance integration", () => {
  it("renders distinct provenance for study guide and practice test without cross-borrowing or using configured model", async () => {
    const mat = await repos.documents.create({
      id: "mat-cross-test",
      title: "Instrument Flying Handbook",
      filePath: "documents/ifh.pdf",
      originalFileName: "ifh.pdf",
      fileSize: 4096,
    });

    vi.setSystemTime(new Date("2026-10-01T12:00:00.000Z"));
    await repos.documents.saveAiStudySet({
      sourceMaterialId: mat.id,
      title: "Attitude Instrument Flying",
      summary: "Pitch, bank, and power control concepts.",
      sections: [{ heading: "Pitch Control", body: "Altimeter and VSI usage." }],
      flashcards: [{ front: "Primary pitch instrument?", back: "Altimeter.", sourcePage: 12 }],
      sourceNotes: "FAA-H-8083-15B",
      model: "gemini-1.5-flash-guide-model",
    });

    vi.setSystemTime(new Date("2026-10-02T16:00:00.000Z"));
    await repos.documents.savePracticeTest({
      sourceMaterialId: mat.id,
      title: "Instrument Crosscheck Practice",
      questions: [
        {
          question: "Which instrument is primary for bank in a level standard-rate turn?",
          options: ["Turn coordinator", "Attitude indicator"],
          correctIndex: 0,
          explanation: "The turn coordinator indicates rate of turn.",
          sourcePage: 15,
        },
      ],
      model: "gemini-1.5-pro-test-model",
    });

    await openMaterial(mat.id);

    // 1. Study aid provenance
    const guideProvenance = screen.getByLabelText("Saved study aid provenance");
    expect(guideProvenance).toBeTruthy();
    const guideScope = within(guideProvenance);
    expect(guideScope.getByText("Saved study aid provenance")).toBeTruthy();
    expect(guideScope.getByText("Instrument Flying Handbook")).toBeTruthy();
    expect(guideScope.getByText("Gemini")).toBeTruthy();
    expect(guideScope.getByText("gemini-1.5-flash-guide-model")).toBeTruthy();
    expect(guideScope.getByText("Generated Thursday, October 1")).toBeTruthy();

    // Verify study aid provenance does NOT borrow practice test or configured settings metadata:
    expect(guideScope.queryByText("gemini-1.5-pro-test-model")).toBeNull();
    expect(guideScope.queryByText("gemini-3.5-flash-configured-in-settings")).toBeNull();
    expect(guideScope.queryByText("Generated Friday, October 2")).toBeNull();

    // 2. Practice test provenance
    const testProvenance = screen.getByLabelText("Saved practice test provenance");
    expect(testProvenance).toBeTruthy();
    const testScope = within(testProvenance);
    expect(testScope.getByText("Saved practice test provenance")).toBeTruthy();
    expect(testScope.getByText("Instrument Flying Handbook")).toBeTruthy();
    expect(testScope.getByText("Gemini")).toBeTruthy();
    expect(testScope.getByText("gemini-1.5-pro-test-model")).toBeTruthy();
    expect(testScope.getByText("Generated Friday, October 2")).toBeTruthy();

    // Verify practice test provenance does NOT borrow study aid or configured settings metadata:
    expect(testScope.queryByText("gemini-1.5-flash-guide-model")).toBeNull();
    expect(testScope.queryByText("gemini-3.5-flash-configured-in-settings")).toBeNull();
    expect(testScope.queryByText("Generated Thursday, October 1")).toBeNull();
  });

  it("renders imported content with 'Imported study packet' and 'Imported <date>', omitting model and verification claims", async () => {
    const mat = await repos.documents.create({
      id: "mat-import-test",
      title: "Ground School Packet",
      filePath: "documents/packet.pdf",
      originalFileName: "packet.pdf",
      fileSize: 8192,
    });

    await repos.documents.saveAiStudySet({
      sourceMaterialId: mat.id,
      title: "Imported Ground Knowledge",
      summary: "Airspace classifications and cloud clearances.",
      sections: [{ heading: "Class C", body: "20 NM outer area, two-way radio required." }],
      flashcards: [{ front: "Class C ceiling?", back: "4,000 ft AGL.", sourcePage: 4 }],
      sourceNotes: "Imported notes.",
      model: "",
    });

    await repos.documents.savePracticeTest({
      sourceMaterialId: mat.id,
      title: "Airspace Practice Quiz",
      questions: [
        {
          question: "What is basic VFR cloud clearance in Class C?",
          options: ["3 statute miles, 1,000 above, 500 below, 2,000 horizontal", "Clear of clouds"],
          correctIndex: 0,
          explanation: "3-152 rule applies in Class C.",
          sourcePage: 6,
        },
      ],
      model: "",
    });

    // Update both to provider 'import' and a specific date
    await db.execute(
      "UPDATE ai_study_sets SET provider = 'import', model = '', generated_at = ? WHERE source_material_id = ?",
      ["2026-10-03T14:30:00.000Z", mat.id],
    );
    await db.execute(
      "UPDATE practice_tests SET provider = 'import', model = '', generated_at = ? WHERE source_material_id = ?",
      ["2026-10-03T14:30:00.000Z", mat.id],
    );

    await openMaterial(mat.id);

    const guideProvenance = screen.getByLabelText("Saved study aid provenance");
    const guideScope = within(guideProvenance);
    expect(guideScope.getByText("Imported study packet")).toBeTruthy();
    expect(guideScope.getByText("Imported Saturday, October 3")).toBeTruthy();
    // Must NOT suggest an external model or instructor verification:
    expect(guideScope.queryByText(/Model/i)).toBeNull();
    expect(guideScope.queryByText(/Instructor verified/i)).toBeNull();
    expect(guideScope.queryByText(/Verified/i)).toBeNull();

    const testProvenance = screen.getByLabelText("Saved practice test provenance");
    const testScope = within(testProvenance);
    expect(testScope.getByText("Imported study packet")).toBeTruthy();
    expect(testScope.getByText("Imported Saturday, October 3")).toBeTruthy();
    expect(testScope.queryByText(/Model/i)).toBeNull();
    expect(testScope.queryByText(/Instructor verified/i)).toBeNull();

    // Existing disclaimer remains displayed:
    expect(screen.getAllByText(IMPORTED_CONTENT_DISCLAIMER).length).toBeGreaterThanOrEqual(1);
  });

  it("displays clear unavailable wording for empty model and invalid timestamps without inventing facts", async () => {
    const mat = await repos.documents.create({
      id: "mat-unavail",
      title: "Systems Review Handout",
      filePath: "documents/systems.pdf",
      originalFileName: "systems.pdf",
      fileSize: 2048,
    });

    await repos.documents.saveAiStudySet({
      sourceMaterialId: mat.id,
      title: "Electrical Systems",
      summary: "Alternator and bus layout.",
      sections: [{ heading: "Alternator", body: "28-volt DC system." }],
      flashcards: [],
      sourceNotes: "",
      model: "   ",
    });

    await repos.documents.savePracticeTest({
      sourceMaterialId: mat.id,
      title: "Systems Review Practice",
      questions: [
        {
          question: "Alternator rating?",
          options: ["28V", "14V"],
          correctIndex: 0,
          explanation: "28V DC bus.",
          sourcePage: null,
        },
      ],
      model: "   ",
    });

    await db.execute(
      "UPDATE ai_study_sets SET model = '   ', generated_at = 'malformed-unparseable-timestamp' WHERE source_material_id = ?",
      [mat.id],
    );
    await db.execute(
      "UPDATE practice_tests SET model = '   ', generated_at = 'malformed-unparseable-timestamp' WHERE source_material_id = ?",
      [mat.id],
    );

    await openMaterial(mat.id);

    // Guide provenance unavailable assertions:
    const guideProvenance = screen.getByLabelText("Saved study aid provenance");
    const guideScope = within(guideProvenance);
    expect(guideScope.getByText("Model unavailable")).toBeTruthy();
    expect(guideScope.getByText("Generated date unavailable")).toBeTruthy();
    expect(guideScope.queryByText(/Invalid Date/i)).toBeNull();
    expect(guideScope.queryByText("NaN")).toBeNull();

    // Practice test provenance unavailable assertions:
    const testProvenance = screen.getByLabelText("Saved practice test provenance");
    const testScope = within(testProvenance);
    expect(testScope.getByText("Model unavailable")).toBeTruthy();
    expect(testScope.getByText("Generated date unavailable")).toBeTruthy();
    expect(testScope.queryByText(/Invalid Date/i)).toBeNull();
    expect(testScope.queryByText("NaN")).toBeNull();
  });

  it("remains readable when Gemini is pending, disconnected or failed, and source file is missing, without network calls", async () => {
    const mat = await repos.documents.create({
      id: "mat-offline",
      title: "Offline VFR Guide",
      filePath: "documents/missing_file.pdf",
      originalFileName: "missing_file.pdf",
      fileSize: 4096,
    });

    vi.setSystemTime(new Date("2026-10-01T12:00:00.000Z"));
    await repos.documents.saveAiStudySet({
      sourceMaterialId: mat.id,
      title: "Offline Guide Content",
      summary: "Usable offline.",
      sections: [{ heading: "Emergency Procedures", body: "Glide speed 65 knots." }],
      flashcards: [{ front: "Best glide speed?", back: "65 knots.", sourcePage: null }],
      sourceNotes: "",
      model: "gemini-1.5-flash-offline",
    });

    vi.setSystemTime(new Date("2026-10-02T16:00:00.000Z"));
    await repos.documents.savePracticeTest({
      sourceMaterialId: mat.id,
      title: "Offline Practice Test",
      questions: [
        {
          question: "Best glide speed?",
          options: ["65 knots", "80 knots"],
          correctIndex: 0,
          explanation: "Best glide speed is 65 KIAS.",
          sourcePage: null,
        },
      ],
      model: "gemini-1.5-pro-offline",
    });

    // 1. Pending Gemini status (getGeminiStatus returns pending Promise)
    vi.spyOn(geminiService, "getGeminiStatus").mockReturnValue(new Promise(() => {}));
    vi.spyOn(documentService, "documentExists").mockResolvedValue(false);
    const networkSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network offline"));

    await openMaterial(mat.id);

    const guideProvenance = screen.getByLabelText("Saved study aid provenance");
    expect(within(guideProvenance).getByText("Offline VFR Guide")).toBeTruthy();
    expect(within(guideProvenance).getByText("gemini-1.5-flash-offline")).toBeTruthy();
    expect(within(guideProvenance).getByText("Generated Thursday, October 1")).toBeTruthy();

    const testProvenance = screen.getByLabelText("Saved practice test provenance");
    expect(within(testProvenance).getByText("Offline VFR Guide")).toBeTruthy();
    expect(within(testProvenance).getByText("gemini-1.5-pro-offline")).toBeTruthy();
    expect(within(testProvenance).getByText("Generated Friday, October 2")).toBeTruthy();

    expect(networkSpy).not.toHaveBeenCalled();

    cleanup();

    // 2. Explicitly disconnected Gemini status (configured: false)
    vi.spyOn(geminiService, "getGeminiStatus").mockResolvedValue({
      configured: false,
      model: "gemini-disconnected-default",
      choice: "standard",
    });
    await openMaterial(mat.id);

    const guideScopeDisconnected = within(screen.getByLabelText("Saved study aid provenance"));
    expect(guideScopeDisconnected.getByText("Offline VFR Guide")).toBeTruthy();
    expect(guideScopeDisconnected.getByText("gemini-1.5-flash-offline")).toBeTruthy();
    expect(guideScopeDisconnected.getByText("Generated Thursday, October 1")).toBeTruthy();
    const testScopeDisconnected = within(screen.getByLabelText("Saved practice test provenance"));
    expect(testScopeDisconnected.getByText("Offline VFR Guide")).toBeTruthy();
    expect(testScopeDisconnected.getByText("gemini-1.5-pro-offline")).toBeTruthy();
    expect(testScopeDisconnected.getByText("Generated Friday, October 2")).toBeTruthy();
    expect(networkSpy).not.toHaveBeenCalled();

    cleanup();

    // 3. Failed Gemini status (request rejected)
    vi.spyOn(geminiService, "getGeminiStatus").mockRejectedValue(new Error("Gemini unavailable"));
    await openMaterial(mat.id);

    const guideScopeFailed = within(screen.getByLabelText("Saved study aid provenance"));
    expect(guideScopeFailed.getByText("Offline VFR Guide")).toBeTruthy();
    expect(guideScopeFailed.getByText("gemini-1.5-flash-offline")).toBeTruthy();
    expect(guideScopeFailed.getByText("Generated Thursday, October 1")).toBeTruthy();
    const testScopeFailed = within(screen.getByLabelText("Saved practice test provenance"));
    expect(testScopeFailed.getByText("Offline VFR Guide")).toBeTruthy();
    expect(testScopeFailed.getByText("gemini-1.5-pro-offline")).toBeTruthy();
    expect(testScopeFailed.getByText("Generated Friday, October 2")).toBeTruthy();
    expect(networkSpy).not.toHaveBeenCalled();
  });

  it("refreshes provenance metadata correctly across material navigation and saved-content replacement", async () => {
    const mat1 = await repos.documents.create({
      id: "mat-nav-1",
      title: "Weather Meteorology 101",
      filePath: "documents/meteo.pdf",
      originalFileName: "meteo.pdf",
      fileSize: 2048,
    });

    const mat2 = await repos.documents.create({
      id: "mat-nav-2",
      title: "Navigation Flight Planning",
      filePath: "documents/plan.pdf",
      originalFileName: "plan.pdf",
      fileSize: 2048,
    });

    vi.setSystemTime(new Date("2026-10-01T10:00:00Z"));
    await repos.documents.saveAiStudySet({
      sourceMaterialId: mat1.id,
      title: "Weather Guide",
      summary: "Cold fronts and low pressure.",
      sections: [{ heading: "Fronts", body: "Steep slope." }],
      flashcards: [],
      sourceNotes: "",
      model: "gemini-model-weather-guide",
    });
    vi.setSystemTime(new Date("2026-10-01T11:00:00Z"));
    await repos.documents.savePracticeTest({
      sourceMaterialId: mat1.id,
      title: "Weather Practice",
      questions: [
        {
          question: "Front type?",
          options: ["Cold", "Warm"],
          correctIndex: 0,
          explanation: "Cold front.",
          sourcePage: null,
        },
      ],
      model: "gemini-model-weather-test",
    });

    vi.setSystemTime(new Date("2026-10-02T12:00:00Z"));
    await repos.documents.saveAiStudySet({
      sourceMaterialId: mat2.id,
      title: "Planning Guide",
      summary: "True course and magnetic variation.",
      sections: [{ heading: "Wind Correction", body: "WCA calculation." }],
      flashcards: [],
      sourceNotes: "",
      model: "gemini-model-planning-guide",
    });
    vi.setSystemTime(new Date("2026-10-02T13:00:00Z"));
    await repos.documents.savePracticeTest({
      sourceMaterialId: mat2.id,
      title: "Planning Practice",
      questions: [
        {
          question: "Magnetic variation source?",
          options: ["Isogonic lines", "Agonic line"],
          correctIndex: 0,
          explanation: "Sectional isogonic lines.",
          sourcePage: null,
        },
      ],
      model: "gemini-model-planning-test",
    });

    // Seed a completed attempt on mat2's initial version 1 practice test to verify attempt history preservation:
    const v1 = (await repos.practiceSessions.getActiveVersion(mat2.id))!;
    expect(v1).not.toBeNull();
    expect(v1.version.versionNumber).toBe(1);
    const startAttempt = await repos.practiceSessions.saveSessionAction({
      action: "start_or_resume",
      operationId: crypto.randomUUID(),
      materialId: mat2.id,
      versionId: v1.version.id,
    });
    await repos.practiceSessions.saveSessionAction({
      action: "complete_attempt",
      operationId: crypto.randomUUID(),
      attemptId: (startAttempt as { attemptId: string }).attemptId,
      expectedRevision: 0,
    });

    await openMaterial(mat1.id);

    // Initial Material 1 assertions:
    let guideProvenance = screen.getByLabelText("Saved study aid provenance");
    expect(within(guideProvenance).getByText("Weather Meteorology 101")).toBeTruthy();
    expect(within(guideProvenance).getByText("gemini-model-weather-guide")).toBeTruthy();
    expect(within(guideProvenance).getByText("Generated Thursday, October 1")).toBeTruthy();

    let testProvenance = screen.getByLabelText("Saved practice test provenance");
    expect(within(testProvenance).getByText("Weather Meteorology 101")).toBeTruthy();
    expect(within(testProvenance).getByText("gemini-model-weather-test")).toBeTruthy();
    expect(within(testProvenance).getByText("Generated Thursday, October 1")).toBeTruthy();

    // 1. Navigation to material 2:
    await act(async () => {
      navigate(`/study/${mat2.id}`);
    });

    await waitFor(() => {
      expect(screen.getByText("Navigation Flight Planning", { selector: "h1" })).toBeTruthy();
    });

    guideProvenance = screen.getByLabelText("Saved study aid provenance");
    expect(within(guideProvenance).getByText("Navigation Flight Planning")).toBeTruthy();
    expect(within(guideProvenance).getByText("gemini-model-planning-guide")).toBeTruthy();
    expect(within(guideProvenance).getByText("Generated Friday, October 2")).toBeTruthy();
    expect(within(guideProvenance).queryByText("Weather Meteorology 101")).toBeNull();
    expect(within(guideProvenance).queryByText("gemini-model-weather-guide")).toBeNull();

    testProvenance = screen.getByLabelText("Saved practice test provenance");
    expect(within(testProvenance).getByText("Navigation Flight Planning")).toBeTruthy();
    expect(within(testProvenance).getByText("gemini-model-planning-test")).toBeTruthy();
    expect(within(testProvenance).getByText("Generated Friday, October 2")).toBeTruthy();
    expect(within(testProvenance).queryByText("Weather Meteorology 101")).toBeNull();
    expect(within(testProvenance).queryByText("gemini-model-weather-test")).toBeNull();
    // Prior completed attempt for mat2 is reflected in the practice history link:
    expect(screen.getByText("View practice history (1)")).toBeTruthy();

    // 2. Replacement of saved study aid content via repository operation:
    vi.setSystemTime(new Date("2026-10-04T18:00:00Z"));
    await act(async () => {
      await context.mutate(async (r) => {
        await r.documents.saveAiStudySet({
          sourceMaterialId: mat2.id,
          title: "Advanced Planning Guide",
          summary: "Updated planning notes.",
          sections: [{ heading: "Flight Planning V2", body: "Check NOTAMs." }],
          flashcards: [{ front: "NOTAM?", back: "Notice to Air Missions", sourcePage: 1 }],
          sourceNotes: "AIM Chapter 5",
          model: "gemini-replaced-v2-guide",
        });
      });
    });

    await waitFor(() => {
      const updatedGuide = screen.getByLabelText("Saved study aid provenance");
      expect(within(updatedGuide).getByText("gemini-replaced-v2-guide")).toBeTruthy();
      expect(within(updatedGuide).getByText("Generated Sunday, October 4")).toBeTruthy();
    });

    // 3. Replacement of saved practice test content via repository operation:
    vi.setSystemTime(new Date("2026-10-05T09:00:00Z"));
    await act(async () => {
      await context.mutate(async (r) => {
        await r.documents.savePracticeTest({
          sourceMaterialId: mat2.id,
          title: "Advanced Planning Practice Test",
          questions: [
            {
              question: "What is compass deviation?",
              options: ["Aircraft magnetic error", "Earth magnetic field variation"],
              correctIndex: 0,
              explanation: "Deviation is caused by local magnetic fields within the aircraft.",
              sourcePage: 7,
            },
          ],
          model: "gemini-replaced-v2-test",
        });
      });
    });

    await waitFor(() => {
      const updatedTest = screen.getByLabelText("Saved practice test provenance");
      expect(within(updatedTest).getByText("gemini-replaced-v2-test")).toBeTruthy();
      expect(within(updatedTest).getByText("Generated Monday, October 5")).toBeTruthy();
    });

    // 4. Verify preserved attempt-version and history behavior:
    // Provenance specifically describes the saved test (version 2), not the earlier-version completed attempt:
    const finalTestCard = screen.getByLabelText("Saved practice test provenance");
    expect(within(finalTestCard).getByText("Saved practice test provenance")).toBeTruthy();
    expect(within(finalTestCard).getByText("gemini-replaced-v2-test")).toBeTruthy();
    expect(within(finalTestCard).getByText("Generated Monday, October 5")).toBeTruthy();

    // The prior-version completed attempt remains preserved in history:
    expect(screen.getByText("View practice history (1)")).toBeTruthy();

    const activeVer = await repos.practiceSessions.getActiveVersion(mat2.id);
    expect(activeVer).not.toBeNull();
    expect(activeVer!.version.versionNumber).toBe(2);
    expect(activeVer!.version.model).toBe("gemini-replaced-v2-test");

    const history = await repos.practiceSessions.getCompletedHistory(mat2.id);
    expect(history.length).toBe(1);
    expect(history[0]!.versionNumber).toBe(1);
    expect(history[0]!.totalQuestions).toBe(1);
  });

  it("demonstrates that omitting provenance integration causes relevant assertions to fail", async () => {
    const mat = await repos.documents.create({
      id: "mat-omission-demo",
      title: "Weight & Balance Handbook",
      filePath: "documents/wb.pdf",
      originalFileName: "wb.pdf",
      fileSize: 2048,
    });

    await repos.documents.saveAiStudySet({
      sourceMaterialId: mat.id,
      title: "CG Calculations",
      summary: "Datum and arm calculations.",
      sections: [],
      flashcards: [],
      sourceNotes: "",
      model: "gemini-1.5-flash",
    });

    await repos.documents.savePracticeTest({
      sourceMaterialId: mat.id,
      title: "CG Calculations Practice",
      questions: [
        {
          question: "What is the datum?",
          options: ["An imaginary vertical plane", "A horizontal line"],
          correctIndex: 0,
          explanation: "Reference plane for measurements.",
          sourcePage: 1,
        },
      ],
      model: "gemini-1.5-pro",
    });

    // 1. With integration present: provenance assertions pass
    await openMaterial(mat.id);
    expect(screen.getByLabelText("Saved study aid provenance")).toBeTruthy();
    expect(screen.getByLabelText("Saved practice test provenance")).toBeTruthy();

    cleanup();

    // 2. Simulate omitting the provenance integration by stubbing StudyContentProvenance to return null
    const provenanceModule = await import("@/pages/StudyLibrary/StudyContentProvenance");
    const spy = vi.spyOn(provenanceModule, "StudyContentProvenance").mockReturnValue(null as unknown as React.JSX.Element);

    await openMaterial(mat.id);

    // Demonstrate that omitting the provenance integration reports absence as expected:
    expect(screen.queryByLabelText("Saved study aid provenance")).toBeNull();
    expect(screen.queryByLabelText("Saved practice test provenance")).toBeNull();

    spy.mockRestore();
  });
});
