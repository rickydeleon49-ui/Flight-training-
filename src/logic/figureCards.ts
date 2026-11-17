/** BL-80: review cards made from missed FAA figure questions. Pure; modelled on pohCards.ts. */
import type { MixedQuestion } from "@/logic/mixedPractice";
import { getFigure } from "@/logic/figures";
import { normalizedStudyText, prepareStudyEdit, type AuthoringState } from "@/logic/studyAuthoring";

export const FIGURE_MATERIAL_TITLE = "FAA test figures";
export interface FigureCard { front: string; back: string }

const clean = (text: string) => text.replace(/\s+/gu, " ").trim();

/** One card per missed question; the same question twice makes one card. */
export function figureCards(missed: readonly MixedQuestion[]): FigureCard[] {
  const seen = new Set<string>();
  const cards: FigureCard[] = [];
  for (const { question } of missed) {
    const figure = question.figureId ? getFigure(question.figureId) : undefined;
    const lead = figure ? `Figure ${figure.faaNumber} (${figure.edition.split(" ")[0]}): ` : "";
    const front = clean(`${lead}${question.question}`);
    const key = normalizedStudyText(front);
    if (!front || seen.has(key)) continue;
    seen.add(key);
    const answer = clean(question.options[question.correctIndex] ?? "").replace(/[.!?]+$/u, "");
    cards.push({ front, back: clean(`${answer}. ${question.explanation}`) });
  }
  return cards;
}

/** Add the cards whose question is not already in the set. Nothing existing is changed. */
export async function addNewFigureCards(state: AuthoringState, cards: readonly FigureCard[]): Promise<{ state: AuthoringState; added: number }> {
  const have = new Set(state.items.filter((item) => item.kind === "card").map((item) => normalizedStudyText(item.fields[0] ?? "")));
  let next = state;
  let added = 0;
  for (const card of cards) {
    const key = normalizedStudyText(card.front);
    if (have.has(key)) continue;
    have.add(key);
    const plan = await prepareStudyEdit(next, { kind: "add", item: { kind: "card", fields: [card.front, card.back], sourcePage: null }, origin: "user" });
    next = plan.next;
    added += 1;
  }
  return { state: next, added };
}
