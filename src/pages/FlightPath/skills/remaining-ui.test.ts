// @vitest-environment jsdom
/**
 * Permanent rendered regressions for re-review findings M3-R8 (the form
 * acknowledges the complete draft, not only its wording) and M3-R10 (a
 * confirmed erasure removes what was on screen). Real candidate store
 * (node:sqlite); jsdom only, no WKWebView claim.
 */
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/state/AppDataContext", () => ({
  useAppData: () => ({ repositories: null, dataRevision: 0, data: { actions: [] } }),
}));

import type { Engine } from "@/data/testing/skillEvidenceEngines";
import type { EvidenceClient } from "@/state/useSkillEvidence";
import { SkillEvidenceHarness as SkillEvidenceSpecimen } from "./testing/SkillEvidenceHarness";
import type { EvidencePage, ObservationHistoryPage } from "@/domain/types";
import { storeWithDebrief, observation, uuid } from "@/data/testing/skillEvidenceEngines";

const open: Engine[] = [];
afterEach(() => {
  cleanup();
  for (const e of open.splice(0)) e.close();
});

const EMPTY = /No observations for this skill yet/;

async function setup() {
  const x = await storeWithDebrief();
  open.push(x.engine);
  const held: (() => void)[] = [];
  let holding = false;
  const client: EvidenceClient = {
    page: (i) => x.store.page(i),
    summary: (i) => x.store.summary(i),
    act: async (a) => {
      if (holding) await new Promise<void>((r) => held.push(r));
      return x.store.act(a);
    },
    history: (i) => x.store.history(i),
  };
  return {
    ...x,
    client,
    skills: await x.store.skills(),
    hold: () => {
      holding = true;
    },
    /** Let every held write through, without an act() scope of its own. */
    releaseNow: () => {
      holding = false;
      for (const r of held.splice(0)) r();
    },
    /** Let every held write through. */
    release: async () => {
      holding = false;
      await act(async () => {
        for (const r of held.splice(0)) r();
      });
    },
    rows: () =>
      x.engine
        .query("SELECT wording, observed_on, attribution, instructor_name FROM skill_observations ORDER BY created_at, id")
        .map((r) => [r["wording"], r["observed_on"], r["attribution"], r["instructor_name"]]),
  };
}

type Ctx = Awaited<ReturnType<typeof setup>>;

function renderForm(ctx: Ctx, initialSkillId = "builtin.normal_landing") {
  return render(
    h(SkillEvidenceSpecimen, {
      client: ctx.client,
      skills: ctx.skills,
      debrief: { journalId: ctx.journalId, date: "2026-10-01", title: "Pattern work" },
      initialSkillId,
    }),
  );
}

const wording = () => screen.getByLabelText("What was said or noticed") as HTMLTextAreaElement;
const date = () => screen.getByLabelText("Date observed") as HTMLInputElement;
const meRadio = () => screen.getByLabelText(/Me \(my own observation\)/) as HTMLInputElement;
const instructorRadio = () => screen.getByLabelText(/My instructor/) as HTMLInputElement;
const nameInput = () => screen.getByLabelText("Instructor name (optional)") as HTMLInputElement;

type Field = "date" | "attribution" | "instructor name" | "wording";
function changeField(field: Field) {
  if (field === "date") fireEvent.change(date(), { target: { value: "2026-10-02" } });
  if (field === "attribution") fireEvent.click(meRadio());
  if (field === "instructor name") fireEvent.change(nameInput(), { target: { value: "Different instructor" } });
  if (field === "wording") fireEvent.change(wording(), { target: { value: "Changed wording" } });
}

async function startHeldSave(ctx: Ctx, text = "Keep the complete draft") {
  renderForm(ctx);
  await screen.findByText(EMPTY);
  fireEvent.change(wording(), { target: { value: text } });
  ctx.hold();
  fireEvent.click(screen.getByRole("button", { name: "Save observation" }));
}

const ORIGINAL = ["Keep the complete draft", "2026-10-01", "instructor_transcribed", ""];

describe("M3-R8 whole-draft acknowledgment", () => {
  describe.each([
    ["date", "the date", ["Keep the complete draft", "2026-10-02", "instructor_transcribed", ""]],
    ["attribution", "who said it", ["Keep the complete draft", "2026-10-01", "self_report", ""]],
    ["instructor name", "the instructor name", ["Keep the complete draft", "2026-10-01", "instructor_transcribed", "Different instructor"]],
  ] as const)("%s changed while saving", (field, words, replaced) => {
    it(`[M3-R8] a ${field} change during the save keeps the complete draft, stores the original, and Replace applies it`, async () => {
      const ctx = await setup();
      await startHeldSave(ctx);
      changeField(field);
      await ctx.release();
      await screen.findByText("Saved.");
      expect(wording().value).toBe("Keep the complete draft");
      expect(screen.getByText(`Not saved yet: your changes to ${words}.`)).toBeTruthy();
      expect(ctx.rows()).toEqual([ORIGINAL]);
      if (field === "date") expect(date().value).toBe("2026-10-02");
      if (field === "attribution") expect(meRadio().checked).toBe(true);
      if (field === "instructor name") expect(nameInput().value).toBe("Different instructor");
      fireEvent.click(screen.getByRole("button", { name: "Replace the saved wording with this" }));
      await waitFor(() => expect(wording().value).toBe(""));
      expect(ctx.rows()).toEqual([replaced]);
      // The metadata stays for the next note; the follow-up is gone.
      if (field === "date") expect(date().value).toBe("2026-10-02");
      if (field === "attribution") expect(meRadio().checked).toBe(true);
      expect(screen.queryByRole("button", { name: "Replace the saved wording with this" })).toBeNull();
    });
  });

  it("a skill change during save is named as unsaved and must be saved as a new observation", async () => {
    const ctx = await setup();
    await startHeldSave(ctx);
    fireEvent.change(screen.getByLabelText("Skill"), { target: { value: "builtin.go_around" } });
    await ctx.release();
    await screen.findByText("Not saved yet: your changes to the skill.");
    expect((screen.getByRole("button", { name: "Replace the saved wording with this" }) as HTMLButtonElement).disabled).toBe(true);
    expect(wording().value).toBe("Keep the complete draft");
    fireEvent.click(screen.getByRole("button", { name: "Save it as a new observation" }));
    await waitFor(() => expect(wording().value).toBe(""));
    expect(ctx.engine.query("SELECT skill_id FROM skill_observations ORDER BY skill_id")).toEqual([{ skill_id: "builtin.go_around" }, { skill_id: "builtin.normal_landing" }]);
  });

  it("[M3-R8] several changes at once (date, who said it and wording) are all kept and named", async () => {
    const ctx = await setup();
    await startHeldSave(ctx);
    changeField("date");
    changeField("attribution");
    changeField("wording");
    await ctx.release();
    await screen.findByText("Not saved yet: your changes to the wording, the date and who said it.");
    expect([wording().value, date().value, meRadio().checked]).toEqual(["Changed wording", "2026-10-02", true]);
    expect(ctx.rows()).toEqual([ORIGINAL]);
  });

  it("[M3-R8] a change made in the same turn as the acknowledgment is still compared (no delayed publication)", async () => {
    const ctx = await setup();
    await startHeldSave(ctx);
    // The edit and the save's answer are handled in one act() scope. (React
    // flushes a discrete input's commit and passive effects synchronously, so
    // this proves the same-turn comparison, not the handler-vs-effect timing,
    // which the form avoids by construction: see the remaining-corrections report.)
    await act(async () => {
      fireEvent.change(date(), { target: { value: "2026-09-30" } });
      ctx.releaseNow();
      await new Promise((r) => setTimeout(r, 20));
    });
    await screen.findByText("Not saved yet: your changes to the date.");
    expect([wording().value, date().value]).toEqual(["Keep the complete draft", "2026-09-30"]);
    expect(ctx.rows()).toEqual([ORIGINAL]);
  });

  it("[control] an unchanged draft is cleared after its save, and the next note is a new observation", async () => {
    const ctx = await setup();
    await startHeldSave(ctx);
    await ctx.release();
    await waitFor(() => expect(wording().value).toBe(""));
    expect(screen.queryByLabelText("Your unsaved changes")).toBeNull();
    expect(date().value).toBe("10/01/2026");
    fireEvent.change(wording(), { target: { value: "A second note" } });
    fireEvent.click(screen.getByRole("button", { name: "Save observation" }));
    await waitFor(() => expect(wording().value).toBe(""));
    expect(ctx.rows()).toEqual([ORIGINAL, ["A second note", "2026-10-01", "instructor_transcribed", ""]]);
  });

  it("DATES-01: saves 11052026 typed in one go as 2026-11-05, and Enter with a day that doesn't exist saves nothing", async () => {
    const ctx = await setup();
    renderForm(ctx);
    await screen.findByText(EMPTY);
    fireEvent.change(wording(), { target: { value: "Typed date" } });
    fireEvent.change(date(), { target: { value: "13292026" } });
    fireEvent.submit(date().form!);
    expect(screen.getByText("That isn't a date — try 11/05/2026.")).toBeTruthy();
    await act(async () => undefined);
    expect(ctx.rows()).toEqual([]);
    fireEvent.change(date(), { target: { value: "11052026" } });
    fireEvent.submit(date().form!);
    await waitFor(() => expect(wording().value).toBe(""));
    expect(ctx.rows()).toEqual([["Typed date", "2026-11-05", "instructor_transcribed", ""]]);
    expect(date().value).toBe("11052026");
  });

  it("[M3-R8] Replace: a change made while the replacement is saving is kept and offered again", async () => {
    const ctx = await setup();
    await startHeldSave(ctx);
    changeField("date");
    await ctx.release();
    ctx.hold();
    fireEvent.click(await screen.findByRole("button", { name: "Replace the saved wording with this" }));
    fireEvent.click(instructorRadio()); // already selected: no change
    fireEvent.change(nameInput(), { target: { value: "Later name" } });
    await ctx.release();
    await screen.findByText("Not saved yet: your changes to the instructor name.");
    expect(ctx.rows()).toEqual([["Keep the complete draft", "2026-10-02", "instructor_transcribed", ""]]);
    expect([wording().value, date().value, nameInput().value]).toEqual(["Keep the complete draft", "2026-10-02", "Later name"]);
    fireEvent.click(screen.getByRole("button", { name: "Replace the saved wording with this" }));
    await waitFor(() => expect(wording().value).toBe(""));
    expect(ctx.rows()).toEqual([["Keep the complete draft", "2026-10-02", "instructor_transcribed", "Later name"]]);
  });

  it("[M3-R8] Save as new: a change made while the new observation is saving is kept, and Replace targets the new one", async () => {
    const ctx = await setup();
    await startHeldSave(ctx);
    changeField("wording");
    await ctx.release();
    ctx.hold();
    fireEvent.click(await screen.findByRole("button", { name: "Save it as a new observation" }));
    fireEvent.click(meRadio());
    await ctx.release();
    await screen.findByText("Not saved yet: your changes to who said it.");
    expect(ctx.rows()).toEqual([ORIGINAL, ["Changed wording", "2026-10-01", "instructor_transcribed", ""]]);
    expect([wording().value, meRadio().checked]).toEqual(["Changed wording", true]);
    fireEvent.click(screen.getByRole("button", { name: "Replace the saved wording with this" }));
    await waitFor(() => expect(wording().value).toBe(""));
    expect(ctx.rows()).toEqual([ORIGINAL, ["Changed wording", "2026-10-01", "self_report", ""]]);
  });

  it("[M3-R8] a change made while the refresh after an acknowledged save is held is kept", async () => {
    const ctx = await setup();
    renderForm(ctx);
    await screen.findByText(EMPTY);
    let releasePage!: () => void;
    const gate = new Promise<void>((r) => (releasePage = r));
    const page = ctx.client.page;
    ctx.client.page = async (input): Promise<EvidencePage> => {
      await gate;
      return page(input);
    };
    fireEvent.change(wording(), { target: { value: "Keep the complete draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Save observation" }));
    await screen.findByText("Saved.");
    changeField("date");
    await act(async () => releasePage());
    await screen.findByText("Not saved yet: your changes to the date.");
    expect([wording().value, date().value]).toEqual(["Keep the complete draft", "2026-10-02"]);
    expect(ctx.rows()).toEqual([ORIGINAL]);
  });

  it("[M3-R8] an answer for a form that was replaced (skill switched away and back) cannot clear the newer form", async () => {
    const ctx = await setup();
    await startHeldSave(ctx);
    fireEvent.change(screen.getByLabelText("Showing skill"), { target: { value: "builtin.go_around" } });
    fireEvent.change(screen.getByLabelText("Showing skill"), { target: { value: "builtin.normal_landing" } });
    fireEvent.change(wording(), { target: { value: "Typed in the newer form" } });
    await ctx.release();
    await waitFor(() => expect(ctx.rows()).toEqual([ORIGINAL]));
    expect(wording().value).toBe("Typed in the newer form");
    expect(screen.queryByLabelText("Your unsaved changes")).toBeNull();
    // The newer form owns a fresh draft: its save is a new observation, not "an earlier save".
    fireEvent.click(screen.getByRole("button", { name: "Save observation" }));
    await waitFor(() => expect(wording().value).toBe(""));
    expect(ctx.rows()).toEqual([ORIGINAL, ["Typed in the newer form", "2026-10-01", "instructor_transcribed", ""]]);
    expect(screen.queryByLabelText("Your unsaved changes")).toBeNull();
  });

  it("[M3-R8] a joined duplicate submit's answer cannot raise a follow-up on the form the first answer cleared", async () => {
    const ctx = await setup();
    await startHeldSave(ctx);
    fireEvent.submit(screen.getByRole("button", { name: /Sav/ }).closest("form")!); // same draft, joins the held save
    await ctx.release();
    await waitFor(() => expect(wording().value).toBe(""));
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByLabelText("Your unsaved changes")).toBeNull();
    expect(ctx.rows()).toEqual([ORIGINAL]);
  });
});

describe("M3-R10 rendered erasure", () => {
  async function longHistory(ctx: Ctx) {
    const o = observation("builtin.normal_landing", ctx.journalId, { wording: "Private earliest wording", sourceField: "none" });
    await ctx.store.act(o);
    for (let revision = 1; revision <= 24; revision++) {
      await ctx.store.act({
        action: "edit_observation", operationId: uuid(), observationId: o.observationId, expectedRevision: revision,
        wording: `Private edit ${revision}`, observedOn: o.observedOn, attribution: o.attribution, instructorName: o.instructorName,
      });
    }
    return o;
  }

  it("[M3-R10] Show older versions after an erasure clears the versions and the list item, and says it was erased", async () => {
    const ctx = await setup();
    const o = await longHistory(ctx);
    renderForm(ctx);
    fireEvent.click(await screen.findByRole("button", { name: "View earlier versions" }));
    const region = await screen.findByRole("region", { name: "Earlier versions" });
    await within(region).findByText("Private edit 24");
    await ctx.store.act({ action: "erase_observation", operationId: uuid(), observationId: o.observationId, confirm: "erase" });
    fireEvent.click(within(region).getByRole("button", { name: "Show older versions" }));
    await within(region).findByText("This observation was erased.");
    expect(within(region).queryByRole("list")).toBeNull();
    expect(within(region).queryByRole("button", { name: "Show older versions" })).toBeNull();
    await screen.findByText(EMPTY);
    await screen.findByText("No observations yet.");
    expect(document.body.textContent).not.toMatch(/Private/);
  });

  it("[M3-R10] a held older page that lands after the erasure is known does not bring the wording back", async () => {
    const ctx = await setup();
    const o = await longHistory(ctx);
    let releaseOld!: () => void;
    const gate = new Promise<void>((r) => (releaseOld = r));
    const history = ctx.client.history;
    ctx.client.history = async (input): Promise<ObservationHistoryPage> => {
      if (!input.cursor) return history(input);
      const stale = await history(input);
      await gate;
      return stale;
    };
    renderForm(ctx);
    fireEvent.click(await screen.findByRole("button", { name: "View earlier versions" }));
    const region = await screen.findByRole("region", { name: "Earlier versions" });
    await within(region).findByText("Private edit 24");
    fireEvent.click(within(region).getByRole("button", { name: "Show older versions" }));
    await within(region).findByRole("button", { name: "Loading…" });
    await ctx.store.act({ action: "erase_observation", operationId: uuid(), observationId: o.observationId, confirm: "erase" });
    fireEvent.click(screen.getByRole("button", { name: "View earlier versions" })); // reads ERASED
    await screen.findByText("This observation was erased.");
    await act(async () => releaseOld());
    await new Promise((r) => setTimeout(r, 10));
    expect(document.body.textContent).not.toMatch(/Private/);
  });

  it("[control] a temporary failure loading older versions keeps the loaded versions on screen", async () => {
    const ctx = await setup();
    await longHistory(ctx);
    renderForm(ctx);
    fireEvent.click(await screen.findByRole("button", { name: "View earlier versions" }));
    const region = await screen.findByRole("region", { name: "Earlier versions" });
    await within(region).findByText("Private edit 24");
    ctx.client.history = () => Promise.reject(new Error("temporary outage"));
    fireEvent.click(within(region).getByRole("button", { name: "Show older versions" }));
    await within(region).findByText("We couldn't load older versions right now.");
    expect(within(region).getByText("Private edit 24")).toBeTruthy();
    expect(within(region).getByRole("button", { name: "Show older versions" })).toBeTruthy();
  });
});
