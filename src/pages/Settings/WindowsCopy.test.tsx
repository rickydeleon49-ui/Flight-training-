// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";
import { describeReadiness } from "@/logic/offlineReadiness";
import { backupHealth } from "@/logic/dataSafety";
import { deviceWord } from "@/lib/platform";
import { exportStudyPacket, provenanceNote, type ExportSource } from "@/logic/studyExport";
import { providerWording } from "@/services/provider";
import { PDF_KIT_LABEL } from "@/logic/pdfKitLabels";
import { Settings } from "./Settings";

let db: TestDatabase;
vi.mock("@/data", () => ({ getDatabase: () => Promise.resolve(db), isTauri: () => false }));
function Ready() { return useAppData().status === "ready" ? <Settings /> : null; }
beforeEach(async () => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
  localStorage.clear();
  db = await createNodeSqliteDatabase();
});
afterEach(() => { cleanup(); db.close(); localStorage.clear(); vi.restoreAllMocks(); });

it("renders Windows Settings without Mac guidance", async () => {
  render(<AppDataProvider><MemoryRouter><Ready /></MemoryRouter></AppDataProvider>);
  await waitFor(() => expect(screen.getByRole("heading", { name: "About you" })).toBeTruthy());
  expect(document.body.textContent).not.toMatch(/Mac|Finder/);
  expect(document.body.textContent).toContain("this PC’s local library");
});

it("renders readiness and backup safety for this PC", () => {
  const states = [
    { state: "missing" }, { state: "checking" }, { state: "notPrepared" },
    { state: "preparing" }, { state: "searchable", pages: 2 },
    { state: "couldNotProcess", code: "memory_limit" },
  ] as const;
  render(<>{states.map((state) => <p key={state.state}>{describeReadiness(state).detail}</p>)}
    <p>{backupHealth({ lastBackupAt: null, lastBackupVersion: null, appVersion: "0.6.7", now: new Date() }).message}</p></>);
  expect(deviceWord()).toBe("PC");
  expect(document.body.textContent).not.toContain("Mac");
  expect(document.body.textContent).toContain("this PC");
});

it("keeps the saved PDF provenance byte-identical on Windows", () => {
  expect(PDF_KIT_LABEL).toMatchInlineSnapshot(`"Pulled from your PDF on this Mac"`);
});

it("keeps exported PDF provenance and packet bytes unchanged across devices", () => {
  const source: ExportSource = {
    material: { title: "Fictional study PDF" }, practiceTest: null,
    studySet: {
      sourceMaterialId: "fictional-pdf", title: "Fictional guide", summary: "Practice terms.",
      summaryPdfProvenance: { status: "valid", label: PDF_KIT_LABEL, sources: [] },
      sections: [], flashcards: [], sourceNotes: "", provider: "manual", model: "manual",
      generatedAt: "2026-11-02T12:00:00Z", updatedAt: "2026-11-02T12:00:00Z",
    },
  };
  const selection = { guide: true, flashcards: false, questions: false };
  expect(provenanceNote(source, selection, true)).toMatchInlineSnapshot(`"Pulled from a PDF on the sender's Mac. Compare this kit with your PDF, current FAA guidance and your instructor."`);
  const pc = exportStudyPacket(source, selection, new Date("2026-11-02T12:00:00Z"));
  expect(pc.ok).toBe(true);
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  expect(exportStudyPacket(source, selection, new Date("2026-11-02T12:00:00Z"))).toEqual(pc);
});

it("adapts only fixed provider messages, leaving arbitrary text intact", () => {
  const message = "Gemini finished, but saving the answer did not work, and it could not be kept on this Mac either. Anything already saved is unchanged. Save again uses the same answer while the app stays open.";
  expect(providerWording(message)).toContain("this PC");
  expect(providerWording(message, "claude-test")).toMatch(/^Claude.*this PC/);
  expect(providerWording("notes about this Mac.pdf", "claude-test")).toBe("notes about this Mac.pdf");
});
