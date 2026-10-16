// @vitest-environment jsdom
/**
 * When Settings and her saved medical record give different expiry dates, the
 * Pilot Toolkit says so and asks which matches her certificate. Only her
 * choice changes anything, and it changes only the other record. Real SQLite.
 */
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRepositories, type Repositories } from "@/data/repositories";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import type { CredentialRecord } from "@/domain/types";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";
import { Settings } from "@/pages/Settings/Settings";
import { PilotToolkit } from "./PilotToolkit";

// Counts how many choices actually reach the write step, so "only one choice
// accepted" is measured rather than inferred from the final dates.
const reconciliations = vi.hoisted(() => ({ count: 0 }));
vi.mock("@/logic/toolkit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/logic/toolkit")>();
  return {
    ...actual,
    reconcileMedicalDates: (...args: Parameters<typeof actual.reconcileMedicalDates>) => {
      reconciliations.count += 1;
      return actual.reconcileMedicalDates(...args);
    },
  };
});

let testDb: TestDatabase;
vi.mock("@/data", () => ({
  getDatabase: () => Promise.resolve(testDb),
  isTauri: () => false,
}));

let repos: Repositories;
let status = "";
let app: ReturnType<typeof useAppData>;
function Probe() {
  app = useAppData();
  status = app.status;
  return null;
}

/** Wait for every queued write through the app's own serialized mutation queue. */
const flushWrites = () => app.mutate(async () => true);

/** Hold the app's write queue, so a choice made now stays pending until released. */
function holdWrites() {
  let open!: () => void;
  const held = new Promise<void>((resolve) => (open = resolve));
  const queued = app.mutate(async () => {
    await held;
    return true;
  });
  return async () => {
    open();
    await queued;
    await flushWrites();
  };
}

const saved = async () => ({
  settings: (await repos.profile.get()).medicalExpiry,
  credentials: (await repos.toolkit.get()).credentials,
});

const medical: CredentialRecord = {
  id: "med-new", type: "medical", title: "Third-class medical", identifier: "", issuedOn: "2026-10-01",
  expiresOn: "2031-10-31", notes: "", materialId: null,
};
const previous: CredentialRecord = { ...medical, id: "med-old", title: "Previous medical", expiresOn: "2026-03-31" };

async function showRecords() {
  render(h(AppDataProvider, null, h(MemoryRouter, null, h(Probe), h(PilotToolkit))));
  await waitFor(() => expect(status).toBe("ready"));
  fireEvent.click(await screen.findByRole("tab", { name: "Certificates" }));
}

beforeEach(async () => {
  reconciliations.count = 0;
  testDb = await createNodeSqliteDatabase();
  repos = createRepositories(testDb);
  await repos.profile.get();
  const toolkit = await repos.toolkit.get();
  await repos.toolkit.save({ ...toolkit, credentials: [previous, medical] });
});

afterEach(() => {
  cleanup();
  testDb.close();
});

describe("two different medical dates", () => {
  it("asks which is right, and changes nothing until she chooses", async () => {
    await repos.profile.update({ medicalExpiry: "2031-11-30" });
    await showRecords();
    const note = await screen.findByRole("note", { name: "Medical dates differ" });
    expect(note.textContent).toMatch(/Settings says your medical expires .*November 30, 2031\..*“Third-class medical” says .*October 31, 2031\..*Nothing changes until you choose/);
    expect((await repos.profile.get()).medicalExpiry).toBe("2031-11-30");
    expect((await repos.toolkit.get()).credentials.map((c) => c.expiresOn)).toEqual(["2026-03-31", "2031-10-31"]);
  });

  it("updates Settings when she says the record's date is right", async () => {
    await repos.profile.update({ medicalExpiry: "2031-11-30" });
    await showRecords();
    const note = await screen.findByRole("note", { name: "Medical dates differ" });
    await act(async () => {
      fireEvent.click(within(note).getByRole("button", { name: /October 31, 2031 is right/ }));
    });
    await waitFor(() => expect(screen.queryByRole("note", { name: "Medical dates differ" })).toBeNull());
    expect((await repos.profile.get()).medicalExpiry).toBe("2031-10-31");
    expect((await repos.toolkit.get()).credentials.map((c) => c.expiresOn)).toEqual(["2026-03-31", "2031-10-31"]);
  });

  it("updates only the latest record when she says the Settings date is right", async () => {
    await repos.profile.update({ medicalExpiry: "2031-11-30" });
    await showRecords();
    const note = await screen.findByRole("note", { name: "Medical dates differ" });
    await act(async () => {
      fireEvent.click(within(note).getByRole("button", { name: /November 30, 2031 is right/ }));
    });
    await waitFor(() => expect(screen.queryByRole("note", { name: "Medical dates differ" })).toBeNull());
    expect((await repos.profile.get()).medicalExpiry).toBe("2031-11-30");
    // The earlier medical is history and keeps its own date.
    expect((await repos.toolkit.get()).credentials.map((c) => c.expiresOn)).toEqual(["2026-03-31", "2031-11-30"]);
  });

  it("is pointed out in Settings beside the medical date", async () => {
    await repos.profile.update({ medicalExpiry: "2031-11-30" });
    render(h(AppDataProvider, null, h(MemoryRouter, null, h(Probe), h(Settings))));
    await waitFor(() => expect(status).toBe("ready"));
    const note = await screen.findByText(/Your saved medical record “Third-class medical” in the Pilot Toolkit/);
    expect(note.getAttribute("role")).toBe("note");
    expect(note.textContent).toMatch(/October 31, 2031, which differs from the date saved here.*under Certificates in the Pilot Toolkit/);
  });

  it("says nothing when the dates agree", async () => {
    await repos.profile.update({ medicalExpiry: "2031-10-31" });
    await showRecords();
    await screen.findByText("Add a certificate or record");
    expect(screen.queryByRole("note", { name: "Medical dates differ" })).toBeNull();
  });
});

describe("two different medical dates: one choice at a time, against current dates", () => {
  const choices = () => {
    const note = screen.getByRole("note", { name: "Medical dates differ" });
    return {
      note,
      record: within(note).getByRole("button", { name: /October 31, 2031 is right/ }) as HTMLButtonElement,
      settings: within(note).getByRole("button", { name: /November 30, 2031 is right/ }) as HTMLButtonElement,
    };
  };

  // Promoted from the independent review (SWEEP-R1): opposite choices clicked
  // before the first is saved used to swap the two dates.
  it.each(["record", "settings"])("keeps the first choice when %s is clicked before the opposite choice", async (first) => {
    await repos.profile.update({ medicalExpiry: "2031-11-30" });
    await showRecords();
    const note = await screen.findByRole("note", { name: "Medical dates differ" });
    const recordButton = within(note).getByRole("button", { name: /October 31, 2031 is right/ });
    const settingsButton = within(note).getByRole("button", { name: /November 30, 2031 is right/ });
    await act(async () => {
      fireEvent.click(first === "record" ? recordButton : settingsButton);
      fireEvent.click(first === "record" ? settingsButton : recordButton);
      await flushWrites();
    });
    const settings = (await repos.profile.get()).medicalExpiry;
    const record = (await repos.toolkit.get()).credentials.find((c) => c.id === medical.id)!.expiresOn;
    const authoritative = first === "record" ? "2031-10-31" : "2031-11-30";
    expect({ settings, record }).toEqual({ settings: authoritative, record: authoritative });
  });

  it("locks both choices while the first is saving, and accepts only that one", async () => {
    await repos.profile.update({ medicalExpiry: "2031-11-30" });
    await showRecords();
    await screen.findByRole("note", { name: "Medical dates differ" });
    const before = await saved();
    const release = holdWrites();
    const writes = vi.spyOn(testDb, "execute");

    // Both clicks land before React renders the locked buttons.
    await act(async () => {
      const { settings, record } = choices();
      fireEvent.click(settings);
      fireEvent.click(record);
    });
    const { note, record, settings } = choices();
    expect(record.disabled).toBe(true);
    expect(settings.disabled).toBe(true);
    expect(note.getAttribute("aria-busy")).toBe("true");
    expect(within(note).getByRole("status").textContent).toBe("Saving your choice…");
    // A further click on the locked buttons queues nothing either.
    fireEvent.click(record);
    expect(await saved()).toEqual(before);

    await act(release);
    const after = await saved();
    expect(after.settings).toBe("2031-11-30");
    expect(after.credentials.find((c) => c.id === medical.id)!.expiresOn).toBe("2031-11-30");
    // The earlier medical is untouched, field for field.
    expect(after.credentials.find((c) => c.id === previous.id)).toEqual(previous);
    // Exactly one accepted choice: one Toolkit write, no Settings write, and
    // only one choice ever reached the write step.
    const sql = writes.mock.calls.map(([statement]) => statement);
    expect(sql.filter((statement) => /pilot_toolkit/.test(statement) && /INSERT/.test(statement))).toHaveLength(1);
    expect(sql.filter((statement) => /UPDATE settings/.test(statement))).toHaveLength(0);
    expect(reconciliations.count).toBe(1);
    expect(screen.queryByRole("note", { name: "Medical dates differ" })).toBeNull();
  });

  it("keeps both dates after a failed save, unlocks, and reconciles on a deliberate retry", async () => {
    await repos.profile.update({ medicalExpiry: "2031-11-30" });
    await showRecords();
    await screen.findByRole("note", { name: "Medical dates differ" });
    const before = await saved();
    const execute = testDb.execute.bind(testDb);
    let failNext = true;
    vi.spyOn(testDb, "execute").mockImplementation(async (sql, params) => {
      if (failNext && /UPDATE settings/.test(sql)) {
        failNext = false;
        throw new Error("The disk is full.");
      }
      return execute(sql, params);
    });

    await act(async () => {
      fireEvent.click(choices().record);
    });
    // The app's error surface reports the failure (a later successful write
    // would clear it, so it is read before anything else is queued).
    await waitFor(() => expect(app.lastError).toMatch(/The disk is full/));
    await waitFor(() => expect(choices().record.disabled).toBe(false));
    expect(await saved()).toEqual(before);
    expect(reconciliations.count).toBe(1);
    const { record, settings } = choices();
    expect(record.disabled).toBe(false);
    expect(settings.disabled).toBe(false);
    expect(screen.queryByText(/These dates changed before your choice was saved/)).toBeNull();

    await act(async () => {
      fireEvent.click(choices().record);
      await flushWrites();
    });
    const after = await saved();
    expect(reconciliations.count).toBe(2);
    expect(after.settings).toBe("2031-10-31");
    expect(after.credentials).toEqual(before.credentials);
    expect(screen.queryByRole("note", { name: "Medical dates differ" })).toBeNull();
  });

  it("writes nothing when the record changes while her choice is queued, and shows the dates as they now stand", async () => {
    await repos.profile.update({ medicalExpiry: "2031-11-30" });
    await showRecords();
    await screen.findByRole("note", { name: "Medical dates differ" });
    const release = holdWrites();
    await act(async () => {
      fireEvent.click(choices().settings);
    });
    // Elsewhere, the record is corrected while that choice waits.
    const toolkit = await repos.toolkit.get();
    await repos.toolkit.save({
      ...toolkit,
      credentials: toolkit.credentials.map((c) => (c.id === medical.id ? { ...c, expiresOn: "2031-09-30" } : c)),
    });

    await act(release);
    const after = await saved();
    expect(after.settings).toBe("2031-11-30");
    expect(after.credentials.find((c) => c.id === medical.id)!.expiresOn).toBe("2031-09-30");
    expect(after.credentials.find((c) => c.id === previous.id)).toEqual(previous);
    const note = screen.getByRole("note", { name: "Medical dates differ" });
    expect(within(note).getByText(/These dates changed before your choice was saved, so nothing was changed/)).toBeTruthy();
    expect(within(note).getByRole("button", { name: /September 30, 2031 is right/ }).hasAttribute("disabled")).toBe(false);
  });

  it("writes nothing when Settings changes or the record is removed while her choice is queued", async () => {
    await repos.profile.update({ medicalExpiry: "2031-11-30" });
    await showRecords();
    await screen.findByRole("note", { name: "Medical dates differ" });
    let release = holdWrites();
    await act(async () => {
      fireEvent.click(choices().record);
    });
    await repos.profile.update({ medicalExpiry: "2031-12-31" });
    await act(release);
    expect((await saved()).settings).toBe("2031-12-31");
    expect((await saved()).credentials.find((c) => c.id === medical.id)!.expiresOn).toBe("2031-10-31");

    const note = screen.getByRole("note", { name: "Medical dates differ" });
    release = holdWrites();
    await act(async () => {
      fireEvent.click(within(note).getByRole("button", { name: /December 31, 2031 is right/ }));
    });
    const toolkit = await repos.toolkit.get();
    await repos.toolkit.save({ ...toolkit, credentials: toolkit.credentials.filter((c) => c.id !== medical.id) });
    await act(release);
    const after = await saved();
    expect(after.settings).toBe("2031-12-31");
    expect(after.credentials).toEqual([previous]);
  });

  it("keeps the choice locked across a tab switch, so a remounted card can't queue the opposite one", async () => {
    await repos.profile.update({ medicalExpiry: "2031-11-30" });
    await showRecords();
    await screen.findByRole("note", { name: "Medical dates differ" });
    const release = holdWrites();
    await act(async () => {
      fireEvent.click(choices().record);
    });
    fireEvent.click(screen.getByRole("tab", { name: "Cost Forecast" }));
    expect(screen.queryByRole("note", { name: "Medical dates differ" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Certificates" }));
    const { record, settings } = choices();
    expect(record.disabled).toBe(true);
    expect(settings.disabled).toBe(true);
    fireEvent.click(settings);

    await act(release);
    const after = await saved();
    expect(after.settings).toBe("2031-10-31");
    expect(after.credentials.find((c) => c.id === medical.id)!.expiresOn).toBe("2031-10-31");
    expect(reconciliations.count).toBe(1);
    expect(screen.queryByRole("note", { name: "Medical dates differ" })).toBeNull();
  });
});
