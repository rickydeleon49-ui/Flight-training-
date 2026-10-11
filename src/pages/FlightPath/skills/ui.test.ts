// @vitest-environment jsdom
/**
 * UI specimen states over a real candidate store (node:sqlite): loading,
 * empty, history with missing sources and deleted actions, read error and
 * retry, duplicate submits, acknowledged-save/failed-refresh, labels and
 * honest wording. jsdom only: no WKWebView or installed-app claim.
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
import { storeWithDebrief, observation, uuid } from "@/data/testing/skillEvidenceEngines";

const open: Engine[] = [];
afterEach(() => {
  cleanup();
  for (const e of open.splice(0)) e.close();
});

async function setup() {
  const ctx = await storeWithDebrief();
  open.push(ctx.engine);
  const client: EvidenceClient = {
    page: (input) => ctx.store.page(input),
    summary: (id) => ctx.store.summary(id),
    act: (a) => ctx.store.act(a),
    history: (id) => ctx.store.history(id),
  };
  const skills = await ctx.store.skills();
  return { ...ctx, client, skills };
}

function renderPanel(ctx: Awaited<ReturnType<typeof setup>>, skillId = "builtin.normal_landing", withDebrief = true) {
  return render(
    h(SkillEvidenceSpecimen, {
      client: ctx.client,
      skills: ctx.skills,
      debrief: withDebrief ? { journalId: ctx.journalId, date: "2026-10-01", title: "Pattern work" } : null,
      initialSkillId: skillId,
    }),
  );
}

describe("skill evidence panel", () => {
  it("shows loading, then an honest empty state with no approval wording", async () => {
    const ctx = await setup();
    renderPanel(ctx, "builtin.stalls");
    expect(screen.getByRole("status").textContent).toMatch(/Loading your evidence/);
    await screen.findByText("No observations for this skill yet. Add one from a lesson debrief.");
    expect(screen.getByText("Your status: Not set")).toBeTruthy();
    expect(screen.getByText("No observations yet.")).toBeTruthy();
    expect(screen.getByText(/isn't an instructor sign-off or a proficiency rating/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/verified|proficient|ready for|signed off|endorsed/i);
  });

  it("history explains who said it, a deleted debrief, a renamed skill and a completed action", async () => {
    const ctx = await setup();
    const skillId = `custom.${uuid()}`;
    await ctx.store.act({ action: "create_custom_skill", operationId: uuid(), skillId, label: "Flare", description: "", topic: "landings" });
    const o = observation(skillId, ctx.journalId);
    await ctx.store.act(o);
    await ctx.store.act({ action: "link_action", operationId: uuid(), observationId: o.observationId, expectedRevision: 1, actionId: ctx.actionId });
    await ctx.store.act({ action: "edit_custom_skill", operationId: uuid(), skillId, expectedRevision: 1, label: "Flare and touchdown", description: "", topic: "landings" });
    ctx.engine.run("UPDATE next_actions SET status = 'completed' WHERE id = ?", [ctx.actionId]);
    ctx.engine.run("DELETE FROM journal_entries WHERE id = ?", [ctx.journalId]);
    ctx.skills = await ctx.store.skills();
    renderPanel(ctx, skillId, false);
    const list = await screen.findByRole("list", { name: "Evidence history" });
    const item = within(list).getByRole("listitem");
    expect(item.textContent).toMatch(/Instructor feedback, as you wrote it down \(Synthetic CFI\)/);
    expect(item.textContent).toMatch(/From a debrief that was deleted: “Pattern work”, 2026-10-01/);
    expect(item.textContent).toMatch(/Recorded under the skill name “Flare”/);
    expect(item.textContent).toMatch(/is done\. Finishing it doesn't mean this was resolved in flight\./);
    expect(item.textContent).not.toMatch(/marked this addressed/);
  });

  it("a read error says the data is safe; Try again reads again", async () => {
    const ctx = await setup();
    const page = ctx.client.page;
    ctx.client.page = vi.fn().mockRejectedValueOnce(new Error("busy")).mockImplementation(page);
    renderPanel(ctx);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Your saved observations are safe/);
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    await screen.findByText("No observations for this skill yet. Add one from a lesson debrief.");
  });

  it("form controls are labelled and the attribution choice is a named group", async () => {
    const ctx = await setup();
    renderPanel(ctx);
    await screen.findByText(/No observations for this skill yet/);
    expect(screen.getByLabelText("Skill")).toBeTruthy();
    const group = screen.getByRole("group", { name: "Who said it?" });
    expect(within(group).getByLabelText(/My instructor/)).toBeTruthy();
    expect(within(group).getByLabelText(/Me \(my own observation\)/)).toBeTruthy();
    expect(screen.getByLabelText("What was said or noticed")).toBeTruthy();
    expect(screen.getByLabelText("Date observed")).toBeTruthy();
    fireEvent.click(within(group).getByLabelText(/Me \(my own observation\)/));
    expect(screen.queryByLabelText("Instructor name (optional)")).toBeNull();
  });

  it("two quick submits save one observation and show it", async () => {
    const ctx = await setup();
    const act = vi.spyOn(ctx.client, "act");
    renderPanel(ctx);
    await screen.findByText(/No observations for this skill yet/);
    fireEvent.change(screen.getByLabelText("What was said or noticed"), { target: { value: "Hold the nose off longer." } });
    const form = screen.getByRole("button", { name: "Save observation" }).closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    const list = await screen.findByRole("list", { name: "Evidence history" });
    expect(within(list).getByText("Hold the nose off longer.")).toBeTruthy();
    expect(act).toHaveBeenCalledTimes(1);
    expect(ctx.engine.query("SELECT COUNT(*) AS n FROM skill_observations")[0]!["n"]).toBe(1);
  });

  it("a save whose refresh fails says Saved and offers a refresh that does not save again", async () => {
    const ctx = await setup();
    const act = vi.spyOn(ctx.client, "act");
    renderPanel(ctx);
    await screen.findByText(/No observations for this skill yet/);
    const page = ctx.client.page;
    ctx.client.page = () => Promise.reject(new Error("read failed"));
    fireEvent.change(screen.getByLabelText("What was said or noticed"), { target: { value: "Power to idle earlier." } });
    fireEvent.click(screen.getByRole("button", { name: "Save observation" }));
    const notice = await screen.findByText(/Saved\. We couldn't refresh the list\./);
    ctx.client.page = page;
    await act_(() => fireEvent.click(within(notice).getByRole("button", { name: "Refresh list" })));
    const list = await screen.findByRole("list", { name: "Evidence history" });
    expect(within(list).getByText("Power to idle earlier.")).toBeTruthy();
    expect(act).toHaveBeenCalledTimes(1);
  });

  it("switching skills ignores the earlier skill's late answer", async () => {
    const ctx = await setup();
    await ctx.store.act(observation("builtin.go_around", ctx.journalId, { wording: "Go-around note." }));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const page = ctx.client.page;
    ctx.client.page = async (input) => {
      if (input.skillId === "builtin.normal_landing") await gate;
      return page(input);
    };
    renderPanel(ctx, "builtin.normal_landing");
    fireEvent.change(screen.getByLabelText("Showing skill"), { target: { value: "builtin.go_around" } });
    await screen.findByText("Go-around note.");
    await act_(async () => release());
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.getByText("Go-around note.")).toBeTruthy();
    expect(screen.queryByText(/No observations for this skill yet/)).toBeNull();
  });
});

async function act_(fn: () => unknown) {
  await act(async () => {
    await fn();
  });
}

void waitFor;
