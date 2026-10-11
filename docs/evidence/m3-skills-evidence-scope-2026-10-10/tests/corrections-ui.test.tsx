// @vitest-environment jsdom
/**
 * Permanent UI regressions for review findings M3-R3 (the app's real
 * React.StrictMode lifecycle), M3-R2c (an earlier save never discards newer
 * unsaved wording) and M3-R4 (earliest wording reachable in the history
 * view). Real candidate store (node:sqlite); jsdom only, no WKWebView claim.
 */
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Engine } from "../prototype/candidateEngine";
import type { EvidenceClient } from "../prototype/evidenceController";
import { SkillEvidenceSpecimen } from "../prototype/SkillEvidenceSpecimen";
import type { EvidencePage, SkillSummary } from "../prototype/types";
import { candidateWithDebrief, observation, uuid } from "./helpers";

const open: Engine[] = [];
afterEach(() => {
  cleanup();
  for (const e of open.splice(0)) e.close();
});

const EMPTY = "No observations for this skill yet. Add one from a lesson debrief.";

async function setup() {
  const ctx = await candidateWithDebrief();
  open.push(ctx.engine);
  const client: EvidenceClient = {
    page: (input) => ctx.store.page(input),
    summary: (id) => ctx.store.summary(id),
    act: (a) => ctx.store.act(a),
    history: (input) => ctx.store.history(input),
  };
  return { ...ctx, client, skills: await ctx.store.skills() };
}

type Ctx = Awaited<ReturnType<typeof setup>>;

function panel(ctx: Ctx, client = ctx.client, withDebrief = false) {
  return (
    <SkillEvidenceSpecimen
      client={client}
      skills={ctx.skills}
      debrief={withDebrief ? { journalId: ctx.journalId, date: "2026-10-01", title: "Pattern work" } : null}
      newId={uuid}
      initialSkillId="builtin.normal_landing"
    />
  );
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("M3-R3 React StrictMode lifecycle", () => {
  it("[M3-R3] under real StrictMode the live replay generation finishes loading", async () => {
    const ctx = await setup();
    render(<StrictMode>{panel(ctx)}</StrictMode>);
    await screen.findByText(EMPTY);
    expect(screen.queryByText(/Loading your evidence/)).toBeNull();
  });

  it("[M3-R3] held reads: the obsolete replay read is dropped and the live one publishes, in either order", async () => {
    for (const order of ["first-then-live", "live-then-first"] as const) {
      const ctx = await setup();
      await ctx.store.act(observation("builtin.normal_landing", ctx.journalId, { wording: "Live wording." }));
      const pages: { input: unknown; held: ReturnType<typeof deferred<EvidencePage>> }[] = [];
      const client: EvidenceClient = {
        ...ctx.client,
        page: (input) => {
          const held = deferred<EvidencePage>();
          pages.push({ input, held });
          return held.promise;
        },
      };
      const view = render(<StrictMode>{panel(ctx, client)}</StrictMode>);
      await waitFor(() => expect(pages).toHaveLength(2)); // setup, cleanup, setup
      const real = await ctx.store.page({ skillId: "builtin.normal_landing", limit: 20 });
      const obsolete = { items: [{ ...real.items[0]!, id: "obsolete", wording: "Obsolete wording." }], nextCursor: null };
      await act(async () => {
        if (order === "first-then-live") {
          pages[0]!.held.resolve(obsolete);
          pages[1]!.held.resolve(real);
        } else {
          pages[1]!.held.resolve(real);
          pages[0]!.held.resolve(obsolete);
        }
      });
      await screen.findByText("Live wording.");
      expect(screen.queryByText("Obsolete wording.")).toBeNull();
      view.unmount();
    }
  });

  it("[M3-R3] after a real unmount, late answers publish nothing", async () => {
    const ctx = await setup();
    const held = deferred<EvidencePage>();
    const summaries = vi.fn<(id: string) => Promise<SkillSummary | null>>(() => Promise.resolve(null));
    const client: EvidenceClient = { ...ctx.client, page: () => held.promise, summary: summaries };
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const view = render(<StrictMode>{panel(ctx, client)}</StrictMode>);
    view.unmount();
    await act(async () => held.resolve({ items: [], nextCursor: null }));
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("[M3-R3] a new client gets a new live controller; the old one's late answers are dropped", async () => {
    const ctx = await setup();
    const oldHeld = deferred<EvidencePage>();
    const oldClient: EvidenceClient = { ...ctx.client, page: () => oldHeld.promise };
    const view = render(<StrictMode>{panel(ctx, oldClient)}</StrictMode>);
    await ctx.store.act(observation("builtin.normal_landing", ctx.journalId, { wording: "From the new client." }));
    view.rerender(<StrictMode>{panel(ctx, ctx.client)}</StrictMode>);
    await screen.findByText("From the new client.");
    const real = await ctx.store.page({ skillId: "builtin.normal_landing", limit: 20 });
    await act(async () => oldHeld.resolve({ items: [{ ...real.items[0]!, id: "old", wording: "From the old client." }], nextCursor: null }));
    expect(screen.queryByText("From the old client.")).toBeNull();
    expect(screen.getByText("From the new client.")).toBeTruthy();
  });

  it("[M3-R3] under StrictMode a save works end to end and the form clears only the saved wording", async () => {
    const ctx = await setup();
    render(<StrictMode>{panel(ctx, ctx.client, true)}</StrictMode>);
    await screen.findByText(EMPTY);
    const text = screen.getByLabelText("What was said or noticed") as HTMLTextAreaElement;
    fireEvent.change(text, { target: { value: "Hold the nose off longer." } });
    fireEvent.click(screen.getByRole("button", { name: "Save observation" }));
    const list = await screen.findByRole("list", { name: "Evidence history" });
    expect(within(list).getByText("Hold the nose off longer.")).toBeTruthy();
    await waitFor(() => expect(text.value).toBe(""));
  });
});

describe("M3-R2c draft retention in the rendered form", () => {
  async function lostFirstSave() {
    const ctx = await setup();
    const real = ctx.client.act;
    ctx.client.act = async (a) => {
      await real(a);
      throw new Error("lost acknowledgment");
    };
    render(panel(ctx, ctx.client, true));
    await screen.findByText(EMPTY);
    const text = screen.getByLabelText("What was said or noticed") as HTMLTextAreaElement;
    fireEvent.change(text, { target: { value: "Earlier wording" } });
    fireEvent.click(screen.getByRole("button", { name: "Save observation" }));
    await screen.findByRole("alert");
    ctx.client.act = real;
    return { ctx, text };
  }

  it("[M3-R2c] discovering an earlier save keeps the newly edited unsaved wording and says what saved", async () => {
    const { ctx, text } = await lostFirstSave();
    fireEvent.change(text, { target: { value: "New unsaved wording" } });
    fireEvent.click(screen.getByRole("button", { name: "Save observation" }));
    await screen.findByText("Your earlier save had already gone through, so it was kept.");
    await waitFor(() => expect(text.value).toBe("New unsaved wording"));
    expect(screen.getByText("The wording in the box above isn't saved yet.")).toBeTruthy();
    expect(ctx.engine.query("SELECT wording FROM skill_observations")).toEqual([{ wording: "Earlier wording" }]);
  });

  it("[M3-R2c] 'Replace the saved wording with this' edits the saved observation, then the form clears", async () => {
    const { ctx, text } = await lostFirstSave();
    fireEvent.change(text, { target: { value: "New unsaved wording" } });
    fireEvent.click(screen.getByRole("button", { name: "Save observation" }));
    fireEvent.click(await screen.findByRole("button", { name: "Replace the saved wording with this" }));
    await waitFor(() => expect(text.value).toBe(""));
    expect(ctx.engine.query("SELECT wording, revision FROM skill_observations")).toEqual([{ wording: "New unsaved wording", revision: 2 }]);
    expect(within(await screen.findByRole("list", { name: "Evidence history" })).getByText("New unsaved wording")).toBeTruthy();
  });

  it("[M3-R2c] 'Save it as a new observation' is an explicit fresh observation", async () => {
    const { ctx, text } = await lostFirstSave();
    fireEvent.change(text, { target: { value: "A separate note" } });
    fireEvent.click(screen.getByRole("button", { name: "Save observation" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save it as a new observation" }));
    await waitFor(() => expect(text.value).toBe(""));
    expect(ctx.engine.query("SELECT wording FROM skill_observations ORDER BY wording")).toEqual([{ wording: "A separate note" }, { wording: "Earlier wording" }]);
  });

  it("[M3-R2] wording changed while a save is in flight is kept, not cleared", async () => {
    const ctx = await setup();
    const gate = deferred<void>();
    const real = ctx.client.act;
    ctx.client.act = async (a) => {
      await gate.promise;
      return real(a);
    };
    render(panel(ctx, ctx.client, true));
    await screen.findByText(EMPTY);
    const text = screen.getByLabelText("What was said or noticed") as HTMLTextAreaElement;
    fireEvent.change(text, { target: { value: "Saved words" } });
    fireEvent.click(screen.getByRole("button", { name: "Save observation" }));
    fireEvent.change(text, { target: { value: "Saved words, and more typed meanwhile" } });
    await act(async () => gate.resolve());
    await screen.findByText("Saved.");
    expect(text.value).toBe("Saved words, and more typed meanwhile");
    expect(screen.getByText("The wording in the box above isn't saved yet.")).toBeTruthy();
  });
});

describe("M3-R4 history view", () => {
  it("[M3-R4] Show older versions reaches the earliest wording after more than 100 revisions", async () => {
    const ctx = await setup();
    const o = observation("builtin.normal_landing", ctx.journalId, { wording: "Earliest wording" });
    await ctx.store.act(o);
    for (let revision = 1; revision <= 101; revision++) {
      await ctx.store.act({
        action: "edit_observation", operationId: uuid(), observationId: o.observationId, expectedRevision: revision,
        wording: `Edit ${revision}`, observedOn: o.observedOn, attribution: o.attribution, instructorName: o.instructorName,
      });
    }
    render(panel(ctx));
    fireEvent.click(await screen.findByRole("button", { name: "View earlier versions" }));
    const region = await screen.findByRole("region", { name: "Earlier versions" });
    await within(region).findByText("Edit 101");
    let guard = 0;
    while (!within(region).queryByText("Earliest wording") && guard++ < 20) {
      fireEvent.click(await within(region).findByRole("button", { name: "Show older versions" }));
      await waitFor(() => expect(within(region).queryByRole("button", { name: "Loading…" })).toBeNull());
    }
    expect(within(region).getByText("Earliest wording")).toBeTruthy();
    expect(within(region).getAllByRole("listitem")).toHaveLength(102);
    expect(within(region).queryByRole("button", { name: "Show older versions" })).toBeNull();
  });
});
