// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { makeEvent } from "@/testing/factories";
import { todayIso } from "@/lib/dates";
import { DEFAULT_TOOLKIT_STATE } from "@/logic/toolkit";
import type { AppData } from "@/state/AppDataContext";

let data: AppData;
vi.mock("@/state/AppDataContext", () => ({
  useAppData: () => ({ data, mutate: async () => null }),
}));

const askPermission = vi.hoisted(() => vi.fn());
vi.mock("@/services/notify", () => ({ askPermission }));

import { RemindersCard } from "./RemindersCard";

beforeEach(() => {
  askPermission.mockReset().mockResolvedValue(false);
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

afterEach(cleanup);

it("shows reminders in Toolkit and asks notification permission only through its switch", () => {
  const requestPermission = askPermission;
  data.events = [makeEvent({ title: "Fictional pattern work", date: todayIso() })];
  data.toolkit = { ...data.toolkit, remindersEnabled: false };
  render(h(MemoryRouter, null, h(RemindersCard)));
  expect(requestPermission).not.toHaveBeenCalled();
  expect(screen.getByText("Fictional pattern work")).toBeTruthy();
  expect(screen.getByText(/Your reminder list is here in Settings/)).toBeTruthy();
  expect(screen.queryByText(/popup when the app opens/)).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(requestPermission).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox", { name: /Show system reminders/ }));
  expect(requestPermission).toHaveBeenCalledOnce();
});

it("keeps checked reminder settings readable without a completion strike", () => {
  data.toolkit = { ...data.toolkit, remindersEnabled: true };
  render(h(MemoryRouter, null, h(RemindersCard)));
  const checkbox = screen.getByRole("checkbox", { name: /Show system reminders/ }) as HTMLInputElement;
  expect(checkbox.checked).toBe(true);
  const label = checkbox.closest("label")!.querySelector<HTMLElement>(".checkbox__label")!;
  expect(label.style.textDecoration).toBe("none");
});

