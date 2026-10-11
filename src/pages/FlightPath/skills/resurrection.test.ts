// @vitest-environment jsdom
/**
 * M3-D7 through the rendered form: a save whose answer was lost (it landed),
 * then erased elsewhere, can never be recreated by the form, whether she
 * tries again with the same wording or with changed wording. Production form,
 * list and hook over a real store (node:sqlite); jsdom only.
 */
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SkillEvidenceError } from "@/data/skillEvidenceTransaction";
import { storeWithDebrief, uuid, type Engine } from "@/data/testing/skillEvidenceEngines";
import type { EvidenceClient } from "@/state/useSkillEvidence";

import { SkillEvidenceHarness } from "./testing/SkillEvidenceHarness";

vi.mock("@/state/AppDataContext", () => ({
  useAppData: () => ({ repositories: null, dataRevision: 0, data: { actions: [] } }),
}));

const open: Engine[] = [];
afterEach(() => {
  cleanup();
  for (const e of open.splice(0)) e.close();
});

async function setup() {
  const x = await storeWithDebrief();
  open.push(x.engine);
  let loseNextAnswer = false;
  const client: EvidenceClient = {
    page: (i) => x.store.page(i),
    summary: (i) => x.store.summary(i),
    act: async (a) => {
      const outcome = await x.store.act(a);
      if (loseNextAnswer) {
        loseNextAnswer = false;
        throw new SkillEvidenceError("STORAGE_FAILURE", "The app couldn't confirm that.");
      }
      return outcome;
    },
    history: (i) => x.store.history(i),
  };
  render(
    h(SkillEvidenceHarness, {
      client,
      skills: await x.store.skills(),
      debrief: { journalId: x.journalId, date: "2026-10-01", title: "Pattern work" },
      initialSkillId: "builtin.normal_landing",
    }),
  );
  await screen.findByText("No observations for this skill yet. Add one from a lesson debrief.");
  return { ...x, loseNext: () => (loseNextAnswer = true) };
}

const wording = () => screen.getByLabelText("What was said or noticed") as HTMLTextAreaElement;
const observations = (e: Engine) => e.query("SELECT id, wording FROM skill_observations");
const eraseAll = async (x: Awaited<ReturnType<typeof setup>>) => {
  for (const row of observations(x.engine)) {
    await x.store.act({ action: "erase_observation", operationId: uuid(), observationId: String(row["id"]), confirm: "erase" });
  }
};

describe("an uncertain save erased elsewhere, through the form", () => {
  for (const retry of ["the same wording", "changed wording"] as const) {
    it(`trying again with ${retry} never recreates it`, async () => {
      const x = await setup();
      fireEvent.change(wording(), { target: { value: "Erase me later." } });
      x.loseNext();
      fireEvent.click(screen.getByRole("button", { name: "Save observation" }));
      await screen.findByText(/We couldn't confirm that save/);
      expect(observations(x.engine)).toHaveLength(1); // it did land
      await eraseAll(x);
      if (retry === "changed wording") fireEvent.change(wording(), { target: { value: "Erase me later, reworded." } });
      fireEvent.click(screen.getByRole("button", { name: "Save observation" }));
      await screen.findByText("Your earlier save went through but was erased afterwards, so it wasn't saved again. Your wording is still here.");
      expect(screen.getByText("What's in the form above isn't saved.")).toBeTruthy();
      expect(wording().value).toBe(retry === "changed wording" ? "Erase me later, reworded." : "Erase me later.");
      expect(observations(x.engine)).toHaveLength(0);
      // Another click is still refused for that erased save; only an explicit new observation goes out.
      fireEvent.click(screen.getByRole("button", { name: "Save observation" }));
      await act(async () => undefined);
      expect(observations(x.engine)).toHaveLength(0);
      fireEvent.click(screen.getByRole("button", { name: "Save it as a new observation" }));
      await waitFor(() => expect(observations(x.engine)).toHaveLength(1));
      expect(x.engine.query("SELECT COUNT(*) AS n FROM skill_evidence_operations WHERE is_erased = 1")).toEqual([{ n: 1 }]);
    });
  }
});
