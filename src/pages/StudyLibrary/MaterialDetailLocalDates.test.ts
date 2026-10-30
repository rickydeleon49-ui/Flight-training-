// @vitest-environment jsdom
/**
 * DESKTOP-V054-01: Material detail names the local calendar day a timestamp
 * falls on. At 20:56 PDT on Thursday 15 October the native app said "Friday,
 * October 16" for both "Added" and "Last reviewed", because it printed the
 * first ten characters of a UTC timestamp. Real SQLite; jsdom only.
 */
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRepositories, type Repositories } from "@/data/repositories";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { MaterialDetail } from "@/pages/StudyLibrary/MaterialDetail";
import * as documentService from "@/services/documents";
import * as geminiService from "@/services/gemini";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";

let db: TestDatabase;
vi.mock("@/data", () => ({
  getDatabase: () => Promise.resolve(db),
  isTauri: () => false,
}));

let status = "";
function Probe() {
  status = useAppData().status;
  return null;
}

function Ready() {
  return useAppData().status === "ready"
    ? h(Routes, null, h(Route, { path: "/study/:materialId", element: h(MaterialDetail) }))
    : null;
}

async function openMaterial(id: string) {
  render(h(AppDataProvider, null, h(MemoryRouter, { initialEntries: [`/study/${id}?tab=more`] }, h(Probe), h(Ready))));
  await waitFor(() => expect(status).toBe("ready"));
  await screen.findByText("Added");
}

/** The value beside a <dt> label in the Details list. */
const detail = (label: string) => screen.getByText(label, { selector: "dt" }).nextElementSibling?.textContent;
const lastReviewed = () => screen.getByText(/^(Last reviewed|Reviewed before|Not reviewed yet)/).textContent;

let repos: Repositories;
let originalTZ: string | undefined;

async function material(createdAt: string, lastReviewedAt: string | null) {
  const created = await repos.documents.create({ title: "Synthetic chapter", materialType: "study_guide", topic: "aerodynamics" });
  await db.execute("UPDATE study_materials SET created_at = ?, last_reviewed_at = ? WHERE id = ?", [createdAt, lastReviewedAt, created.id]);
  return created.id;
}

function at(zone: string, instant: string) {
  process.env.TZ = zone;
  vi.setSystemTime(new Date(instant));
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  originalTZ = process.env.TZ;
  db = await createNodeSqliteDatabase();
  repos = createRepositories(db);
  vi.spyOn(geminiService, "getGeminiStatus").mockResolvedValue({ configured: false, model: null } as never);
  vi.spyOn(geminiService, "watchGeminiProgress").mockResolvedValue(() => {});
  vi.spyOn(documentService, "canHandleFiles").mockReturnValue(true);
  vi.spyOn(documentService, "documentExists").mockResolvedValue(true);
});

afterEach(() => {
  cleanup();
  db.close();
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (originalTZ === undefined) delete process.env.TZ;
  else process.env.TZ = originalTZ;
});

describe("Material detail dates are local calendar days", () => {
  it("shows the native run's evening timestamps as Thursday, not the UTC Friday", async () => {
    at("America/Los_Angeles", "2026-10-16T03:56:30Z"); // 20:56 PDT, Thursday 15 October
    const id = await material("2026-10-16T02:26:19.480Z", "2026-10-16T03:56:14.075Z");
    await openMaterial(id);
    expect(detail("Added")).toBe("Thursday, October 15");
    expect(lastReviewed()).toBe("Last reviewed Thursday, October 15.");
  });

  it("says today after Mark as reviewed today in the evening", async () => {
    at("America/Los_Angeles", "2026-10-16T03:56:30Z");
    const id = await material("2026-10-16T02:26:19.480Z", null);
    await openMaterial(id);
    expect(lastReviewed()).toBe("Not reviewed yet.");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Mark as reviewed today" }));
    });
    await waitFor(() => expect(lastReviewed()).toBe("Last reviewed Thursday, October 15."));
  });

  it("reads SQLite's UTC form in a positive-offset zone", async () => {
    at("Pacific/Kiritimati", "2026-10-15T12:00:00Z"); // Friday 16 October locally
    const id = await material("2026-10-15 10:00:00", "2026-10-15 09:59:59");
    await openMaterial(id);
    expect(detail("Added")).toBe("Friday, October 16");
    expect(lastReviewed()).toBe("Last reviewed Thursday, October 15.");
  });

  it("keeps a bare calendar day as that day", async () => {
    at("America/Los_Angeles", "2026-10-16T03:56:30Z");
    const id = await material("2026-10-12", "2026-10-14");
    await openMaterial(id);
    expect(detail("Added")).toBe("Monday, October 12");
    expect(lastReviewed()).toBe("Last reviewed Wednesday, October 14.");
  });

  it("says plainly when a stored date can't be read, instead of inventing one", async () => {
    at("America/Los_Angeles", "2026-10-16T03:56:30Z");
    const id = await material("not a date", "2026-02-30T12:00:00Z");
    await openMaterial(id);
    expect(detail("Added")).toBe("Unknown");
    expect(lastReviewed()).toBe("Reviewed before; the date can't be read.");
    expect(document.body.textContent).not.toMatch(/NaN|undefined/);
  });
});
