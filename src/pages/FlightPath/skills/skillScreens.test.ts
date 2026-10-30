// @vitest-environment jsdom
/**
 * The real M3 screens (the skill page route, a debrief's "Skill evidence"
 * card with its add-observation dialog, and the Skills list in Flight Path)
 * under the real AppDataProvider and React.StrictMode, over a real SQLite
 * library (node:sqlite). jsdom only: no WKWebView or installed-app claim.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { StrictMode, createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRepositories, type Repositories } from "@/data/repositories";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { JournalEntryDetail } from "@/pages/FlightJournal/JournalEntryDetail";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";

import { SkillPage } from "./SkillPage";
import { SkillsSection } from "./SkillsSection";

let db: TestDatabase;
let repos: Repositories;
let dir: string;

vi.mock("@/data", () => ({
  getDatabase: () => Promise.resolve(db),
  isTauri: () => false,
}));

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "hfd-skills-"));
  db = await createNodeSqliteDatabase(join(dir, "skills.db"));
  repos = createRepositories(db);
  await repos.app.set("airline_starter_pack", "skipped-for-tests");
});

afterEach(() => {
  cleanup();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

let context: ReturnType<typeof useAppData>;
function Probe() {
  context = useAppData();
  return null;
}
function Ready({ children }: { children: ReturnType<typeof h> }) {
  const { status } = useAppData();
  return status === "ready" ? children : null;
}

async function mount(path: string, routes: [string, ReturnType<typeof h>][]) {
  const view = render(
    h(
      StrictMode,
      null,
      h(
        AppDataProvider,
        null,
        h(
          MemoryRouter,
          { initialEntries: [path] },
          h(Probe),
          h(Ready, null, h(Routes, null, ...routes.map(([p, element]) => h(Route, { key: p, path: p, element })))),
        ),
      ),
    ),
  );
  await waitFor(() => expect(context?.status).toBe("ready"));
  return view;
}

async function debrief(title = "Pattern work", feedback = "Look further down the runway in the flare.") {
  const id = crypto.randomUUID();
  await db.saveDebriefAtomically!({
    operationId: crypto.randomUUID(),
    targetId: id,
    journal: { date: "2026-10-01", title, instructorFeedback: feedback, instructorName: "Synthetic CFI" },
    action: { id: crypto.randomUUID(), title: "Review flare timing" },
  });
  return id;
}

const record = (journalId: string, wording: string, skillId = "builtin.normal_landing") =>
  repos.skillEvidence.act({
    action: "create_observation", operationId: crypto.randomUUID(), observationId: crypto.randomUUID(), skillId, journalId,
    sourceField: "none", wording, observedOn: "2026-10-01", attribution: "instructor_transcribed", instructorName: "Sam",
  });

const APPROVAL = /verified|proficien|\bready\b|sign-off|signed off|endorse|certif/i;
const DISCLAIMER = "This is your own record. It isn't an instructor sign-off or a proficiency rating.";

function NavigableSkillPage() {
  const navigate = useNavigate();
  return h("div", null, h("button", { onClick: () => navigate("/flight-path/skills/builtin.go_around") }, "Test route change"), h(SkillPage));
}

describe("the skill page", () => {
  it("editing after a lost acknowledgment retains the new wording and saves at the acknowledged revision", async () => {
    const journalId = await debrief();
    await record(journalId, "Original");
    const real = db.saveSkillEvidenceAtomically!.bind(db);
    let lose = true;
    vi.spyOn(db, "saveSkillEvidenceAtomically").mockImplementation(async (request) => {
      const outcome = await real(request);
      if (lose) { lose = false; throw new Error("Lost after commit"); }
      return outcome;
    });
    await mount("/flight-path/skills/builtin.normal_landing", [["/flight-path/skills/:skillId", h(SkillPage)]]);
    const list = await screen.findByRole("list", { name: "Evidence history" });
    fireEvent.click(within(list).getByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit this observation" });
    const input = within(dialog).getByLabelText("What was said or noticed") as HTMLTextAreaElement;
    const save = within(dialog).getByRole("button", { name: "Save changes" });
    fireEvent.change(input, { target: { value: "Earlier" } });
    fireEvent.click(save);
    await within(dialog).findByRole("alert");
    fireEvent.change(input, { target: { value: "Changed" } });
    fireEvent.click(save);
    await within(dialog).findByText(/Your earlier change was saved/);
    expect(input.value).toBe("Changed");
    expect(await db.select("SELECT wording, revision FROM skill_observations")).toEqual([{ wording: "Earlier", revision: 2 }]);
    fireEvent.click(save);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await db.select("SELECT wording, revision FROM skill_observations")).toEqual([{ wording: "Changed", revision: 3 }]);
  });

  it("DATES-01: the edit dialog saves 11052026 typed in one go as 2026-11-05, and refuses a day that doesn't exist", async () => {
    const journalId = await debrief();
    await record(journalId, "Original");
    await mount("/flight-path/skills/builtin.normal_landing", [["/flight-path/skills/:skillId", h(SkillPage)]]);
    const list = await screen.findByRole("list", { name: "Evidence history" });
    fireEvent.click(within(list).getByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit this observation" });
    const date = within(dialog).getByLabelText("Date observed") as HTMLInputElement;
    expect(date.value).toBe("10/01/2026");
    const save = within(dialog).getByRole("button", { name: "Save changes" });
    fireEvent.change(date, { target: { value: "13292026" } });
    fireEvent.click(save);
    expect(within(dialog).getByText("That isn't a date — try 11/05/2026.")).toBeTruthy();
    expect(await db.select("SELECT observed_on FROM skill_observations")).toEqual([{ observed_on: "2026-10-01" }]);
    fireEvent.change(date, { target: { value: "11052026" } });
    expect(within(dialog).getByText("That's Thursday, November 5, 2026.")).toBeTruthy();
    fireEvent.click(save);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await db.select("SELECT observed_on FROM skill_observations")).toEqual([{ observed_on: "2026-11-05" }]);
  });

  it("a route change disposes the previous skill's edit dialog without writing its draft", async () => {
    const journalId = await debrief();
    await record(journalId, "First skill observation");
    await mount("/flight-path/skills/builtin.normal_landing", [["/flight-path/skills/:skillId", h(NavigableSkillPage)]]);
    const list = await screen.findByRole("list", { name: "Evidence history" });
    fireEvent.click(within(list).getByRole("button", { name: "Edit" }));
    await screen.findByRole("dialog", { name: "Edit this observation" });
    fireEvent.click(screen.getByText("Test route change"));
    await screen.findByText("Go-around");
    expect(screen.queryByRole("dialog", { name: "Edit this observation" })).toBeNull();
    expect(await db.select("SELECT wording, revision FROM skill_observations")).toEqual([{ wording: "First skill observation", revision: 1 }]);
  });

  it("shows her own status and confidence, the evidence sentence and the fixed disclaimer, with no approval wording", async () => {
    await mount("/flight-path/skills/builtin.normal_landing", [["/flight-path/skills/:skillId", h(SkillPage)]]);
    await screen.findByText("Your status: Not set");
    expect(screen.getByText("Your confidence: Not rated")).toBeTruthy();
    expect(screen.getByText("No observations yet.")).toBeTruthy();
    expect(screen.getByText(DISCLAIMER)).toBeTruthy();
    expect(screen.getByText("No observations for this skill yet. Add one from a lesson debrief.")).toBeTruthy();
    const text = document.body.textContent!.replace(DISCLAIMER, "");
    expect(text).not.toMatch(APPROVAL);
    expect(text).not.toMatch(/%|score/i);
  });

  it("status and confidence change only when she sets them, each with its own history", async () => {
    await mount("/flight-path/skills/builtin.steep_turns", [["/flight-path/skills/:skillId", h(SkillPage)]]);
    await screen.findByText("Your status: Not set");
    fireEvent.change(screen.getByLabelText("Change your status"), { target: { value: "practicing" } });
    await screen.findByText("Your status: Practicing");
    fireEvent.change(screen.getByLabelText("Change your confidence"), { target: { value: "3" } });
    await screen.findByText("Your confidence: 3 of 5");
    fireEvent.change(screen.getByLabelText("Change your status"), { target: { value: "" } });
    await screen.findByText("Your status: Not set");
    const rows = await db.select<{ kind: string; status: string | null; confidence: number | null; sequence: number }>(
      "SELECT kind, status, confidence, sequence FROM skill_self_assessments ORDER BY kind, sequence",
    );
    expect(rows).toEqual([
      { kind: "confidence", status: null, confidence: 3, sequence: 1 },
      { kind: "status", status: "practicing", confidence: null, sequence: 1 },
      { kind: "status", status: null, confidence: null, sequence: 2 },
    ]);
  });

  it("the item menu marks addressed, links a follow-up, and shows that finishing it doesn't resolve it in flight", async () => {
    const journalId = await debrief();
    await record(journalId, "Flare a little later.");
    await mount("/flight-path/skills/builtin.normal_landing", [["/flight-path/skills/:skillId", h(SkillPage)]]);
    const list = await screen.findByRole("list", { name: "Evidence history" });
    expect(within(list).getByText("Flare a little later.")).toBeTruthy();
    expect(within(list).getByText("Instructor feedback, as you wrote it down (Sam)")).toBeTruthy();
    fireEvent.click(within(list).getByRole("button", { name: "Mark addressed" }));
    await within(list).findByText("You marked this addressed.");
    fireEvent.click(within(list).getByRole("button", { name: "Link a follow-up" }));
    const dialog = await screen.findByRole("dialog", { name: "Link a follow-up" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Link" }));
    await within(list).findByText("Follow-up: “Review flare timing” (still to do)");
    // Completing the action elsewhere never marks anything addressed or changes status.
    const [action] = context.data.actions;
    await act(async () => {
      await context.mutate((r) => r.actions.update(action!.id, { status: "completed", completedAt: "2026-10-11T09:00:00.000Z" }));
    });
    await within(list).findByText("Follow-up “Review flare timing” is done. Finishing it doesn't mean this was resolved in flight.");
    expect(screen.getByText("Your status: Not set")).toBeTruthy();
    const [row] = await db.select<{ revision: number }>("SELECT revision FROM skill_observations");
    expect(row!.revision).toBe(3);
  });

  it("erasing permanently names what goes, says earlier backups keep it, and removes it", async () => {
    const journalId = await debrief();
    await record(journalId, "Unique wording to erase zq7.");
    await mount("/flight-path/skills/builtin.normal_landing", [["/flight-path/skills/:skillId", h(SkillPage)]]);
    const list = await screen.findByRole("list", { name: "Evidence history" });
    fireEvent.click(within(list).getByRole("button", { name: "Erase permanently" }));
    const dialog = await screen.findByRole("dialog", { name: "Erase this observation permanently?" });
    expect(within(dialog).getByText(/This erases “Unique wording to erase zq7\.” and every earlier version of it/)).toBeTruthy();
    expect(within(dialog).getByText(/Backups you made before now still contain it\./)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Erase permanently" }));
    await screen.findByText("No observations for this skill yet. Add one from a lesson debrief.");
    expect(screen.queryByText("Unique wording to erase zq7.")).toBeNull();
    expect(await db.select("SELECT * FROM skill_observation_revisions")).toEqual([]);
    expect(await db.select("SELECT COUNT(*) AS n FROM journal_entries")).toEqual([{ n: 1 }]);
  });

  it("re-reads when the app's data changes elsewhere: a deleted debrief shows its snapshot", async () => {
    const journalId = await debrief("Crosswind day");
    await record(journalId, "Kept after the debrief goes.");
    await mount("/flight-path/skills/builtin.normal_landing", [["/flight-path/skills/:skillId", h(SkillPage)]]);
    await screen.findByText("Kept after the debrief goes.");
    await act(async () => {
      await context.mutate((r) => r.journal.remove(journalId));
    });
    await screen.findByText("From a debrief that was deleted: “Crosswind day”, 2026-10-01");
  });

  it("an unknown skill says so", async () => {
    await mount("/flight-path/skills/builtin.no_such_skill", [["/flight-path/skills/:skillId", h(SkillPage)]]);
    await screen.findByText("That skill isn't here.");
  });
});

/**
 * "Add an observation" stays disabled until the skill list has loaded, and a
 * click on a disabled button does nothing. Finding the button is not enough:
 * under load the list can still be loading (M4S1-R9, CI run 38985040191).
 */
async function addObservationWhenReady(): Promise<HTMLButtonElement> {
  const button = (await screen.findByRole("button", { name: "Add an observation" })) as HTMLButtonElement;
  await waitFor(() => expect(button.disabled).toBe(false));
  return button;
}

describe("a debrief's Skill evidence card", () => {
  it("adds an observation through the dialog, deliberately, with honest attribution", async () => {
    const journalId = await debrief();
    expect(await db.select("SELECT COUNT(*) AS n FROM skill_observations")).toEqual([{ n: 0 }]);
    await mount(`/journal/${journalId}`, [["/journal/:entryId", h(JournalEntryDetail)]]);
    await screen.findByText("No observations from this debrief yet.");
    fireEvent.click(await addObservationWhenReady());
    const dialog = await screen.findByRole("dialog", { name: "Add an observation" });
    const who = within(dialog).getByRole("group", { name: "Who said it?" });
    expect(within(who).getByLabelText(/My instructor \(I'm writing down what they said\)/)).toBeTruthy();
    expect(within(who).getByLabelText(/Me \(my own observation\)/)).toBeTruthy();
    expect(within(dialog).getByLabelText("Date observed")).toHaveProperty("value", "10/01/2026");
    fireEvent.change(within(dialog).getByLabelText("Skill"), { target: { value: "builtin.crosswind_landing" } });
    fireEvent.change(within(dialog).getByLabelText("Came from"), { target: { value: "instructor_feedback" } });
    fireEvent.change(within(dialog).getByLabelText("Instructor name (optional)"), { target: { value: "Sam" } });
    fireEvent.change(within(dialog).getByLabelText("What was said or noticed"), { target: { value: "Aileron into the wind." } });
    expect(within(dialog).getByText("22 of 2000 characters")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save observation" }));
    await within(dialog).findByText("Saved.");
    await waitFor(() => expect((within(dialog).getByLabelText("What was said or noticed") as HTMLTextAreaElement).value).toBe(""));
    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    const list = await screen.findByRole("list", { name: "Evidence history" });
    expect(within(list).getByText("Aileron into the wind.")).toBeTruthy();
    expect(within(list).getByText("Crosswind landing")).toBeTruthy();
    const rows = await db.select<Record<string, unknown>>(
      "SELECT skill_id, journal_id, source_field, attribution, instructor_name FROM skill_observations",
    );
    expect(rows).toEqual([
      { skill_id: "builtin.crosswind_landing", journal_id: journalId, source_field: "instructor_feedback", attribution: "instructor_transcribed", instructor_name: "Sam" },
    ]);
    // The card's own words (the debrief page's existing logbook note is not part of it).
    const card = screen.getByRole("heading", { name: "Skill evidence" }).closest("section")!;
    expect(card.textContent).not.toMatch(APPROVAL);
  });

  it("two quick clicks on Save record one observation", async () => {
    const journalId = await debrief();
    await mount(`/journal/${journalId}`, [["/journal/:entryId", h(JournalEntryDetail)]]);
    fireEvent.click(await addObservationWhenReady());
    const dialog = await screen.findByRole("dialog", { name: "Add an observation" });
    fireEvent.change(within(dialog).getByLabelText("What was said or noticed"), { target: { value: "Once only." } });
    const save = within(dialog).getByRole("button", { name: "Save observation" });
    fireEvent.click(save);
    fireEvent.click(save);
    await within(dialog).findByText("Saved.");
    expect(await db.select("SELECT COUNT(*) AS n FROM skill_observations")).toEqual([{ n: 1 }]);
  });
});

describe("the Skills list in Flight Path", () => {
  it("groups skills by topic with status and evidence, adds her own, refuses a duplicate name, retires and restores", async () => {
    await mount("/flight-path", [["/flight-path", h(SkillsSection)]]);
    const landings = await screen.findByRole("region", { name: "Landings" });
    expect(within(landings).getByText("Crosswind landing")).toBeTruthy();
    expect(within(landings).getAllByText("Built-in").length).toBeGreaterThan(0);
    await waitFor(() => expect(within(landings).getAllByText("Not set · No observations yet.").length).toBe(3));

    fireEvent.click(screen.getByRole("button", { name: "Add your own skill" }));
    let dialog = await screen.findByRole("dialog", { name: "Add your own skill" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Short-field landing" } });
    fireEvent.change(within(dialog).getByLabelText("Topic"), { target: { value: "landings" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await within(landings).findByText("Short-field landing");
    expect(within(landings).getByText("Your skill")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Add your own skill" }));
    dialog = await screen.findByRole("dialog", { name: "Add your own skill" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "  CROSSWIND   landing " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await within(dialog).findByText("You already have an active skill with that name.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    fireEvent.click(within(landings).getByRole("button", { name: "Retire" }));
    await waitFor(() => expect(within(screen.getByRole("region", { name: "Landings" })).queryByText("Short-field landing")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Show retired skills" }));
    const retired = await within(screen.getByRole("region", { name: "Landings" })).findByText("Short-field landing");
    expect(retired).toBeTruthy();
    fireEvent.click(within(screen.getByRole("region", { name: "Landings" })).getByRole("button", { name: "Restore" }));
    await waitFor(async () =>
      expect(await db.select("SELECT status, revision FROM skill_catalog_entries WHERE origin = 'custom'")).toEqual([{ status: "active", revision: 3 }]),
    );
    // Built-in names stay as the app ships them.
    expect(within(screen.getByRole("region", { name: "Landings" })).queryAllByRole("button", { name: "Rename" })).toHaveLength(1);
  });
});
