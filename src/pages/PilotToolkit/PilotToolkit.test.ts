// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeEvent } from "@/testing/factories";
import { todayIso } from "@/lib/dates";
import { DEFAULT_TOOLKIT_STATE, QUIZ_LENGTH, QUIZ_QUESTIONS } from "@/logic/toolkit";
import type { AppData } from "@/state/AppDataContext";

let data: AppData;
vi.mock("@/state/AppDataContext", () => ({
  useAppData: () => ({ data, mutate: async () => null }),
}));

const askPermission = vi.hoisted(() => vi.fn());
vi.mock("@/services/notify", () => ({ askPermission }));

import { PilotToolkit } from "./PilotToolkit";

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

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("PilotToolkit home of tiles", () => {
  it("shows 4 group headings and 11 tool tiles, and no tab strip", () => {
    render(h(MemoryRouter, null, h(PilotToolkit)));
    expect(screen.getAllByRole("heading", { level: 3 }).map((e) => e.textContent)).toEqual([
      "Checkride", "Plan a flight", "Practice", "My records",
    ]);
    const tiles = document.querySelectorAll("button.toolkit-tile");
    expect(tiles).toHaveLength(11);
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.getByText("Choose a tool to open it.")).toBeTruthy();
  });

  it("opens a tool from its tile, and All tools returns to the home", () => {
    render(h(MemoryRouter, null, h(PilotToolkit)));
    fireEvent.click(screen.getByRole("button", { name: /^E6B/ }));
    expect(screen.getByRole("heading", { level: 2, name: "E6B" })).toBeTruthy();
    expect(document.querySelectorAll("button.toolkit-tile")).toHaveLength(0);
    fireEvent.click(screen.getByRole("link", { name: "All tools" }));
    expect(document.querySelectorAll("button.toolkit-tile")).toHaveLength(11);
  });

  it("opens a tool directly from ?tool=e6b", () => {
    render(h(MemoryRouter, { initialEntries: ["/toolkit?tool=e6b"] }, h(PilotToolkit)));
    expect(screen.getByRole("heading", { level: 2, name: "E6B" })).toBeTruthy();
  });

  it("shows the home for an unknown ?tool= value", () => {
    render(h(MemoryRouter, { initialEntries: ["/toolkit?tool=nope"] }, h(PilotToolkit)));
    expect(document.querySelectorAll("button.toolkit-tile")).toHaveLength(11);
  });
});

it("shows reminders in Toolkit and asks notification permission only through its switch", () => {
  const requestPermission = askPermission;
  data.events = [makeEvent({ title: "Fictional pattern work", date: todayIso() })];
  data.toolkit = { ...data.toolkit, remindersEnabled: false };
  render(h(MemoryRouter, null, h(PilotToolkit)));
  expect(requestPermission).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /^Reminders/ }));
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
  fireEvent.click(screen.getByRole("button", { name: /^Reminders/ }));
  const checkbox = screen.getByRole("checkbox", { name: /Show system reminders/ }) as HTMLInputElement;
  expect(checkbox.checked).toBe(true);
  const label = checkbox.closest("label")!.querySelector<HTMLElement>(".checkbox__label")!;
  expect(label.style.textDecoration).toBe("none");
});

it("lets her clear a half-typed certificate form, and shows Clear only when something is typed", () => {
  render(h(MemoryRouter, null, h(PilotToolkit)));
  fireEvent.click(screen.getByRole("button", { name: /^Certificates/ }));
  expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
  const title = screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement;
  fireEvent.change(title, { target: { value: "Student pilot certificate" } });
  fireEvent.click(screen.getByRole("button", { name: "Clear" }));
  expect(title.value).toBe("");
  expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
});

it("says 'In progress' in the instructor report when no goal is being worked on", () => {
  render(h(MemoryRouter, null, h(PilotToolkit)));
  fireEvent.click(screen.getByRole("button", { name: /^Instructor Report/ }));
  expect(screen.getByText("No goals marked In Progress.")).toBeTruthy();
});

it("opens on Quizzes when the address says ?tool=quiz (the Study Library's Practice test link)", () => {
  render(h(MemoryRouter, { initialEntries: ["/toolkit?tool=quiz"] }, h(PilotToolkit)));
  expect(screen.getByRole("heading", { level: 2, name: "Quizzes" })).toBeTruthy();
});

it("shows the FAA figure drill card in Quizzes", () => {
  render(h(MemoryRouter, { initialEntries: ["/toolkit?tool=quiz"] }, h(PilotToolkit)));
  expect(screen.getByText("FAA figure drill")).toBeTruthy();
});

describe("Knowledge quiz history", () => {
  it("says which list it shows, since material practice tests are counted elsewhere", () => {
    render(h(MemoryRouter, null, h(PilotToolkit)));
    fireEvent.click(screen.getByRole("button", { name: /^Quizzes/ }));
    expect(screen.getByText(/No knowledge quiz attempts yet\./)).toBeTruthy();
    expect(screen.getByText(/Practice tests on your study materials are kept in the Study Library/)).toBeTruthy();
  });

  it("lists a saved quiz attempt in Recent results", () => {
    data = {
      ...data,
      toolkit: {
        ...data.toolkit,
        quizAttempts: [{ id: "a1", date: "2026-11-10T10:00:00Z", score: 6, total: 8, weakTopics: [] }],
      },
    } as unknown as AppData;
    render(h(MemoryRouter, null, h(PilotToolkit)));
    fireEvent.click(screen.getByRole("button", { name: /^Quizzes/ }));
    expect(screen.getByText("6/8")).toBeTruthy();
    expect(screen.queryByText(/No knowledge quiz attempts yet/)).toBeNull();
  });
});

describe("Knowledge quiz result", () => {
  const openQuiz = () => {
    render(h(MemoryRouter, null, h(PilotToolkit)));
    fireEvent.click(screen.getByRole("button", { name: /^Quizzes/ }));
    fireEvent.click(screen.getByRole("button", { name: "Start quiz" }));
  };
  // The quiz draws a random set, so find each question by the prompt on screen.
  const onScreen = () => QUIZ_QUESTIONS.find((q) => screen.queryByText(q.prompt))!;
  const answerAll = (pick: (i: number, q: (typeof QUIZ_QUESTIONS)[number]) => string) => {
    for (let i = 0; i < QUIZ_LENGTH; i++) {
      fireEvent.click(screen.getByRole("radio", { name: pick(i, onScreen()) }));
      fireEvent.click(screen.getByRole("button", { name: "Check answer" }));
      fireEvent.click(screen.getByRole("button", { name: i === QUIZ_LENGTH - 1 ? "Finish quiz" : "Next question" }));
    }
  };

  it("shows the score, a Review line, and returns to the start card", async () => {
    openQuiz();
    answerAll((i, q) => (i === 0 ? "I don't know" : q.choices[q.correct]!));
    const heading = await screen.findByRole("heading", { name: `${QUIZ_LENGTH - 1} of ${QUIZ_LENGTH} right.` });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(screen.getByText(/Review:/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try another quiz" }));
    expect(screen.getByRole("button", { name: "Start quiz" })).toBeTruthy();
  });

  it("I don't know shows the correct answer like a wrong answer", () => {
    openQuiz();
    fireEvent.click(screen.getByRole("radio", { name: "I don't know" }));
    fireEvent.click(screen.getByRole("button", { name: "Check answer" }));
    const q = onScreen();
    expect(screen.getByText(new RegExp(`No problem, here is the answer: ${q.choices[q.correct]}`))).toBeTruthy();
  });

  it("names the correct option after a wrong answer and groups options as radios", () => {
    openQuiz();
    expect(screen.getByRole("radiogroup")).toBeTruthy();
    const q = onScreen();
    const wrong = q.choices.findIndex((_, i) => i !== q.correct);
    fireEvent.click(screen.getByRole("radio", { name: q.choices[wrong]! }));
    fireEvent.click(screen.getByRole("button", { name: "Check answer" }));
    expect(document.querySelector(".quiz__explanation")?.textContent).toContain(`Not quite. The correct answer is: ${q.choices[q.correct]}`);
  });
});

describe("Safety check personal minimums", () => {
  const open = () => render(h(MemoryRouter, { initialEntries: ["/toolkit?tool=safety"] }, h(PilotToolkit)));

  it("keeps the row as today when nothing is saved", () => {
    open();
    expect(screen.getByRole("button", { name: "Set my minimums" })).toBeTruthy();
    expect(screen.queryByText(/Your minimums:/)).toBeNull();
    expect(screen.queryByLabelText("Lowest ceiling (ft AGL)")).toBeNull();
  });

  it("shows saved minimums and inside/outside wording without ticking the box", () => {
    data = {
      ...data,
      toolkit: { ...DEFAULT_TOOLKIT_STATE, personalMinimums: { ceilingFt: 3000, visibilitySm: 5, windKt: 15, crosswindKt: 8 } },
    };
    open();
    expect(screen.getByText("Your minimums: ceiling 3,000 ft · vis 5 SM · wind 15 kt · crosswind 8 kt")).toBeTruthy();
    expect(screen.queryByTestId("minimums-summary")).toBeNull();

    fireEvent.change(screen.getByLabelText("Today's ceiling (ft AGL)"), { target: { value: "3000" } });
    expect(screen.getByTestId("minimums-summary").textContent).toBe(
      "Inside the minimums you saved. You and your instructor still make the call.",
    );
    fireEvent.change(screen.getByLabelText("Today's wind (kt)"), { target: { value: "20" } });
    expect(screen.getByTestId("minimums-summary").textContent).toBe("Outside your minimum — talk with your instructor.");
    expect(screen.getByText("outside your minimum")).toBeTruthy();

    const box = screen.getByLabelText(/Personal minimums/) as HTMLInputElement;
    expect(box.checked).toBe(false);
  });
});
