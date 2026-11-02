// @vitest-environment jsdom
/**
 * DATES-01: the Flight Log, Settings and Pilot Toolkit dates use the one
 * typed date field. Typing 11052026 in one go saves 2026-11-05; a day that
 * doesn't exist is refused plainly and nothing is saved. Real SQLite.
 */
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRepositories } from "@/data/repositories";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { JournalForm } from "@/pages/FlightJournal/JournalForm";
import { PilotToolkit } from "@/pages/PilotToolkit/PilotToolkit";
import { Settings } from "@/pages/Settings/Settings";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";

let db: TestDatabase;
vi.mock("@/data", () => ({
  getDatabase: () => Promise.resolve(db),
  isTauri: () => false,
}));

let app: ReturnType<typeof useAppData>;
function Probe() {
  app = useAppData();
  return null;
}
function Ready() {
  return useAppData().status === "ready"
    ? h(
        Routes,
        null,
        h(Route, { path: "/settings", element: h(Settings) }),
        h(Route, { path: "/toolkit", element: h(PilotToolkit) }),
        h(Route, { path: "/journal/new", element: h(JournalForm) }),
        h(Route, { path: "*", element: h("div", null, "Elsewhere") }),
      )
    : null;
}
async function open(path: string) {
  render(h(AppDataProvider, null, h(MemoryRouter, { initialEntries: [path] }, h(Probe), h(Ready))));
  await waitFor(() => expect(app.status).toBe("ready"));
}

const NOT_A_DATE = "That isn't a date — try 11/05/2026.";
const typeDate = (label: string, typed: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value: typed } });

beforeEach(async () => {
  localStorage.clear();
  db = await createNodeSqliteDatabase();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});

afterEach(() => {
  cleanup();
  db.close();
  localStorage.clear();
});

describe("DATES-01 pages save a typed date as typed", () => {
  it("Flight Log: the full log date", async () => {
    await open("/journal/new");
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Pattern work" } });
    typeDate("Date", "13292026");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save flight record" }));
    });
    expect(await screen.findByText(NOT_A_DATE)).toBeTruthy();
    expect(await createRepositories(db).journal.list()).toEqual([]);
    typeDate("Date", "11052026");
    expect(screen.getByText("That's Thursday, November 5, 2026.")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save flight record" }));
    });
    await waitFor(async () => expect((await createRepositories(db).journal.list()).map((e) => e.date)).toEqual(["2026-11-05"]));
  });

  it("Flight Log: the quick debrief date", async () => {
    await open("/journal/new?mode=quick");
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Pattern work" } });
    typeDate("Date", "11052026");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save quick debrief" }));
    });
    await waitFor(async () => expect((await createRepositories(db).journal.list()).map((e) => e.date)).toEqual(["2026-11-05"]));
  });

  it("Flight Log: example placeholders say e.g.", async () => {
    await open("/journal/new");
    for (const label of ["Title", "Aircraft type / model", "Tail number / identifier", "Departure airport", "Arrival airport", "Instructor name"]) {
      expect((screen.getByLabelText(label) as HTMLInputElement).placeholder, label).toMatch(/^e\.g\. /);
    }
  });

  it("Settings: training started and medical expiry, both optional", async () => {
    await createRepositories(db).profile.update({ trainingStartedOn: "2026-01-01" });
    await open("/settings");
    expect((screen.getByLabelText("Training started") as HTMLInputElement).value).toBe("01/01/2026");
    typeDate("Training started", "13292026");
    fireEvent.click(screen.getAllByRole("button", { name: "Save profile" })[0]!);
    expect(await screen.findByText(NOT_A_DATE)).toBeTruthy();
    await act(async () => app.mutate(async () => true));
    // Never saved as "no date": the stored day stays until she types a real one.
    expect((await createRepositories(db).profile.get()).trainingStartedOn).toBe("2026-01-01");

    typeDate("Training started", "11052026");
    typeDate("Medical certificate expires", "11/05/2028");
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Save profile" })[0]!);
    });
    await waitFor(async () => {
      const profile = await createRepositories(db).profile.get();
      expect([profile.trainingStartedOn, profile.medicalExpiry]).toEqual(["2026-11-05", "2028-11-05"]);
    });
  });

  it("Pilot Toolkit: a certificate's issued and expiry dates", async () => {
    await open("/toolkit");
    fireEvent.click(await screen.findByRole("tab", { name: "Certificates" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Third-class medical" } });
    typeDate("Issued", "11052026");
    typeDate("Expires", "02/30/2031");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add record" }));
    });
    expect(await screen.findByText(NOT_A_DATE)).toBeTruthy();
    expect((await createRepositories(db).toolkit.get()).credentials).toEqual([]);
    typeDate("Expires", "");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add record" }));
    });
    await waitFor(async () => {
      const [record] = (await createRepositories(db).toolkit.get()).credentials;
      expect([record?.issuedOn, record?.expiresOn]).toEqual(["2026-11-05", null]);
    });
  });
});
