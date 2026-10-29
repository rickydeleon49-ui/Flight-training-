// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeEvent } from "@/testing/factories";
import { todayIso } from "@/lib/dates";
import { DEFAULT_TOOLKIT_STATE } from "@/logic/toolkit";
import type { AppData } from "@/state/AppDataContext";

let data: AppData;
vi.mock("@/state/AppDataContext", () => ({
  useAppData: () => ({ data, mutate: async () => null }),
}));

import { PilotToolkit } from "./PilotToolkit";

beforeEach(() => {
  data = {
    profile: {
      id: "profile-1",
      pilotName: "Amelia Earhart",
      certificateGoal: "private_pilot",
      currentFocus: "Solo cross country",
      currentMilestoneId: null,
      flightSchool: "Bay Cities",
      instructorName: "Snook",
      homeAirport: "KOAK",
      aircraftType: "C172",
      trainingStartedOn: "2026-01-01",
      medicalExpiry: "2027-01-01",
      whyNote: "",
      photo: null,
      accentColor: "#1d4ed8",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
    toolkit: DEFAULT_TOOLKIT_STATE,
    milestones: [],
    goals: [],
    checklistItems: [],
    actions: [],
    materials: [],
    aiStudySets: [],
    practiceTests: [],
    tags: [],
    events: [],
    prepItems: [],
    journalEntries: [],
    questions: [],
    notes: [],
    transactions: [],
  } as unknown as AppData;
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("PilotToolkit WAI-ARIA tabs and accessibility", () => {
  it("establishes valid tab and panel relationships", () => {
    render(h(MemoryRouter, null, h(PilotToolkit)));

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(8);

    const activeTab = screen.getByRole("tab", { selected: true });
    expect(activeTab.id).toBe("toolkit-tab-readiness");
    expect(activeTab.getAttribute("aria-controls")).toBe("toolkit-panel-readiness");

    const panel = screen.getByRole("tabpanel");
    expect(panel.id).toBe("toolkit-panel-readiness");
    expect(panel.getAttribute("aria-labelledby")).toBe("toolkit-tab-readiness");
  });

  it("enforces roving tabindex with exactly one tabIndex=0", () => {
    render(h(MemoryRouter, null, h(PilotToolkit)));

    const tabs = screen.getAllByRole("tab");
    const activeTabs = tabs.filter((t) => t.tabIndex === 0);
    const inactiveTabs = tabs.filter((t) => t.tabIndex === -1);

    expect(activeTabs).toHaveLength(1);
    expect(activeTabs[0]!.getAttribute("aria-selected")).toBe("true");
    expect(inactiveTabs).toHaveLength(7);
    for (const tab of inactiveTabs) {
      expect(tab.getAttribute("aria-selected")).toBe("false");
    }
  });

  it("navigates forward and backward with ArrowRight and ArrowLeft", () => {
    render(h(MemoryRouter, null, h(PilotToolkit)));

    const tabs = screen.getAllByRole("tab");
    const tab0 = tabs[0]!; // Checkride / readiness
    const tab1 = tabs[1]!; // Instructor Report / report

    tab0.focus();
    expect(document.activeElement).toBe(tab0);

    // ArrowRight moves to next tab
    fireEvent.keyDown(tab0, { key: "ArrowRight" });
    expect(tab1.getAttribute("aria-selected")).toBe("true");
    expect(tab1.tabIndex).toBe(0);
    expect(tab0.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(tab1);

    const panel1 = screen.getByRole("tabpanel");
    expect(panel1.id).toBe("toolkit-panel-report");
    expect(panel1.getAttribute("aria-labelledby")).toBe("toolkit-tab-report");

    // ArrowLeft moves back to previous tab
    fireEvent.keyDown(tab1, { key: "ArrowLeft" });
    expect(tab0.getAttribute("aria-selected")).toBe("true");
    expect(tab0.tabIndex).toBe(0);
    expect(document.activeElement).toBe(tab0);

    const panel0 = screen.getByRole("tabpanel");
    expect(panel0.id).toBe("toolkit-panel-readiness");
    expect(panel0.getAttribute("aria-labelledby")).toBe("toolkit-tab-readiness");
  });

  it("wraps around at both ends with ArrowLeft and ArrowRight", () => {
    render(h(MemoryRouter, null, h(PilotToolkit)));

    const tabs = screen.getAllByRole("tab");
    const firstTab = tabs[0]!;
    const lastTab = tabs[tabs.length - 1]!; // Career Portfolio / career

    firstTab.focus();

    // ArrowLeft from first wraps to last
    fireEvent.keyDown(firstTab, { key: "ArrowLeft" });
    expect(lastTab.getAttribute("aria-selected")).toBe("true");
    expect(lastTab.tabIndex).toBe(0);
    expect(firstTab.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(lastTab);

    const lastPanel = screen.getByRole("tabpanel");
    expect(lastPanel.id).toBe("toolkit-panel-career");
    expect(lastPanel.getAttribute("aria-labelledby")).toBe("toolkit-tab-career");

    // ArrowRight from last wraps to first
    fireEvent.keyDown(lastTab, { key: "ArrowRight" });
    expect(firstTab.getAttribute("aria-selected")).toBe("true");
    expect(firstTab.tabIndex).toBe(0);
    expect(document.activeElement).toBe(firstTab);

    const firstPanel = screen.getByRole("tabpanel");
    expect(firstPanel.id).toBe("toolkit-panel-readiness");
  });

  it("navigates directly to ends with Home and End keys", () => {
    render(h(MemoryRouter, null, h(PilotToolkit)));

    const tabs = screen.getAllByRole("tab");
    const firstTab = tabs[0]!;
    const middleTab = tabs[3]!; // Cost Forecast
    const lastTab = tabs[tabs.length - 1]!;

    // Click middle tab first
    fireEvent.click(middleTab);
    expect(middleTab.getAttribute("aria-selected")).toBe("true");

    // End key moves to last tab
    fireEvent.keyDown(middleTab, { key: "End" });
    expect(lastTab.getAttribute("aria-selected")).toBe("true");
    expect(lastTab.tabIndex).toBe(0);
    expect(document.activeElement).toBe(lastTab);
    expect(screen.getByRole("tabpanel").id).toBe("toolkit-panel-career");

    // Home key moves to first tab
    fireEvent.keyDown(lastTab, { key: "Home" });
    expect(firstTab.getAttribute("aria-selected")).toBe("true");
    expect(firstTab.tabIndex).toBe(0);
    expect(document.activeElement).toBe(firstTab);
    expect(screen.getByRole("tabpanel").id).toBe("toolkit-panel-readiness");
  });

  it("synchronizes selection, focus, and visible panel on click", () => {
    render(h(MemoryRouter, null, h(PilotToolkit)));

    const tabs = screen.getAllByRole("tab");
    const certsTab = tabs[2]!; // Certificates / records

    fireEvent.click(certsTab);

    expect(certsTab.getAttribute("aria-selected")).toBe("true");
    expect(certsTab.tabIndex).toBe(0);
    expect(document.activeElement).toBe(certsTab);

    const panel = screen.getByRole("tabpanel");
    expect(panel.id).toBe("toolkit-panel-records");
    expect(panel.getAttribute("aria-labelledby")).toBe("toolkit-tab-records");
  });
});

it("shows reminders in Toolkit and asks notification permission only through its switch", () => {
  const requestPermission = vi.fn().mockResolvedValue("denied");
  vi.stubGlobal("Notification", class { static permission = "default"; static requestPermission = requestPermission; });
  data.events = [makeEvent({ title: "Fictional pattern work", date: todayIso() })];
  data.toolkit = { ...data.toolkit, remindersEnabled: false };
  render(h(MemoryRouter, null, h(PilotToolkit)));
  expect(requestPermission).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("tab", { name: "Reminders" }));
  expect(screen.getByText("Fictional pattern work")).toBeTruthy();
  expect(screen.getByText(/Your reminder list is here in Pilot Toolkit/)).toBeTruthy();
  expect(screen.queryByText(/popup when the app opens/)).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(requestPermission).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox", { name: /Show system reminders/ }));
  expect(requestPermission).toHaveBeenCalledOnce();
});

it("keeps checked reminder settings readable without a completion strike", () => {
  data.toolkit = { ...data.toolkit, remindersEnabled: true };
  render(h(MemoryRouter, null, h(PilotToolkit)));
  fireEvent.click(screen.getByRole("tab", { name: "Reminders" }));
  const checkbox = screen.getByRole("checkbox", { name: /Show system reminders/ }) as HTMLInputElement;
  expect(checkbox.checked).toBe(true);
  const label = checkbox.closest("label")!.querySelector<HTMLElement>(".checkbox__label")!;
  expect(label.style.textDecoration).toBe("none");
});
