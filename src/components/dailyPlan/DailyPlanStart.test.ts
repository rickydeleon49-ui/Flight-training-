// @vitest-environment jsdom
/**
 * Start on a Flight Deck action, exercised on the real Flight Deck page: it
 * must leave keyboard focus on that action's own control, wherever the
 * dashboard shows it, or open the action when the dashboard does not list it.
 */
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRepositories, type Repositories } from "@/data/repositories";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import type { NextAction } from "@/domain/types";
import { addDays, todayIso } from "@/lib/dates";
import { FlightDeck } from "@/pages/FlightDeck/FlightDeck";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";

let db: TestDatabase;
let repos: Repositories;

vi.mock("@/data", () => ({
  getDatabase: () => Promise.resolve(db),
  isTauri: () => false,
}));

beforeEach(async () => {
  db = await createNodeSqliteDatabase();
  repos = createRepositories(db);
  await repos.app.set("airline_starter_pack", "skipped-for-tests");
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});

afterEach(() => {
  cleanup();
  db.close();
});

function Ready() {
  const { status } = useAppData();
  return status === "ready" ? h(FlightDeck) : null;
}

async function open() {
  render(h(AppDataProvider, null, h(MemoryRouter, null, h(Ready))));
  await screen.findByText("Daily Flight Plan");
}

const today = todayIso();
const create = (title: string, dueDate: string | null): Promise<NextAction> =>
  repos.actions.create({ title, estimatedMinutes: 5, dueDate });

describe("Daily Flight Plan Start on Flight Deck", () => {
  it("focuses the checkbox of an action listed in Today's plan", async () => {
    const action = await create("Brief the pattern", today);
    await open();

    fireEvent.click(await screen.findByRole("button", { name: "Start action: Brief the pattern" }));
    const container = document.getElementById(`action-${action.id}`);
    const checkbox = container?.querySelector("input[type=checkbox]");
    expect(checkbox).toBeTruthy();
    expect(document.activeElement).toBe(checkbox);
  });

  it("focuses the controls of an overdue action shown under Needs attention", async () => {
    const action = await create("Overdue weight and balance", addDays(today, -2));
    await open();

    fireEvent.click(
      await screen.findByRole("button", { name: "Start action: Overdue weight and balance" }),
    );
    const container = document.getElementById(`attention-${action.id}`);
    expect(container).toBeTruthy();
    expect(container?.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.tagName).toBe("BUTTON");
  });

  it("opens an action the dashboard does not list (due later) instead of doing nothing", async () => {
    await create("Order a new logbook", addDays(today, 5));
    await open();

    fireEvent.click(await screen.findByRole("button", { name: "Start action: Order a new logbook" }));
    await waitFor(() => {
      const dialog = document.querySelector("dialog[open]");
      expect(dialog).toBeTruthy();
      expect((dialog?.querySelector("input") as HTMLInputElement | null)?.value).toBe(
        "Order a new logbook",
      );
    });
  });
});
