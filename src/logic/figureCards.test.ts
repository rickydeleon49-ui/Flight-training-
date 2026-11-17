import { expect, it } from "vitest";
import { addNewFigureCards, figureCards } from "./figureCards";
import { FIGURE_QUESTIONS } from "./figureQuestions";
import type { MixedQuestion } from "./mixedPractice";
import { authoringStateOf } from "./studySetEditing";

const mixed = (i: number): MixedQuestion => ({ question: FIGURE_QUESTIONS[i]!, materialId: "faa-figures", materialTitle: "FAA test figures" });
const empty = () => authoringStateOf({ summary: "", summaryOrigin: null, sections: [], flashcards: [], retired: [] });

it("builds front and back text and dedupes repeats", () => {
  const q = FIGURE_QUESTIONS[0]!;
  const cards = figureCards([mixed(0), mixed(0), mixed(1)]);
  expect(cards).toHaveLength(2);
  expect(cards[0]!.front).toBe(`Figure 49 (FAA-CT-8080-2H): ${q.question}`);
  expect(cards[0]!.back).toBe(`${q.options[q.correctIndex]}. ${q.explanation}`);
});

it("adds only cards not already in the set", async () => {
  const cards = figureCards([mixed(0), mixed(1)]);
  const first = await addNewFigureCards(empty(), cards);
  expect(first.added).toBe(2);
  const again = await addNewFigureCards(first.state, [...cards, ...figureCards([mixed(2)])]);
  expect(again.added).toBe(1);
  expect(again.state.items.filter((i) => i.kind === "card")).toHaveLength(3);
  const none = await addNewFigureCards(again.state, cards);
  expect(none.added).toBe(0);
});
