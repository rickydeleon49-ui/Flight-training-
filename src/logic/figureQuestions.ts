import type { PracticeQuestion } from "@/domain/types";

/**
 * BL-80: starter practice questions that are read from a bundled FAA figure. Written in our own
 * words (never copied from FAA tests). Plain data; `figureId` points into `FAA_FIGURES`.
 */
export const FIGURE_QUESTIONS: readonly PracticeQuestion[] = [
  {
    figureId: "faa-49",
    question: "On this airport diagram, which runway is marked as closed?",
    options: [
      "Runway 4-22",
      "Runway 18-36",
      "Neither runway",
    ],
    correctIndex: 0,
    explanation: "A large X painted on a runway means it is closed. Runway 4-22 has an X at each end; runway 18-36 has arrows and arrowheads before its numbers, which show a displaced threshold instead.",
    sourcePage: null,
  },
  {
    figureId: "faa-12",
    question: "Look at the KINK report. What wind does \"11012G18KT\" give you?",
    options: [
      "From 110 degrees at 12 knots, gusting to 18 knots",
      "From 120 degrees at 11 knots, gusting to 18 knots",
      "From 110 degrees at 18 knots, gusting to 12 knots",
    ],
    correctIndex: 0,
    explanation: "The first three digits are the direction the wind blows from (110 degrees true), the next two are the steady speed (12 knots), and G18 means gusts to 18 knots.",
    sourcePage: null,
  },
  {
    figureId: "faa-36",
    question: "On the crosswind component graph, as the wind angle off the runway gets closer to 90 degrees, what happens to the crosswind part of the same wind speed?",
    options: [
      "It gets larger",
      "It gets smaller",
      "It stays the same",
    ],
    correctIndex: 0,
    explanation: "A wind straight down the runway has no crosswind. As the angle moves toward 90 degrees, more of the same wind pushes sideways, so the crosswind part grows and the headwind part shrinks.",
    sourcePage: null,
  },
];
