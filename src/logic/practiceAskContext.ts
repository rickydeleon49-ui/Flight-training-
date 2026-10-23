import type { PracticeTestItem } from "@/domain/types";

const MAX_CONTEXT = 8000;

function shorten(text: string, budget: number): string {
  const points = Array.from(text);
  return points.length <= budget ? text : `${points.slice(0, Math.max(0, budget - 1)).join("")}…`;
}

/** Count Unicode code points, matching native validate_context. Reserve the
 * question and both answer identities before sharing space with optional text.
 * Oversized authored text is visibly shortened as well. */
export function practiceAskContext(
  question: Pick<PracticeTestItem, "questionText" | "options" | "explanation">,
  chosenAnswer: string,
  correctAnswer: string,
): string {
  const labels = ["Question: ", "Her chosen answer: ", "Correct answer: ", "Explanation: ", "Choices:\n"];
  const available = MAX_CONTEXT - Array.from(labels.join("")).length - 8; // four blank lines
  const required = [question.questionText, chosenAnswer, correctAnswer];
  // Imported required fields fit in full; unusually long authored fields share
  // the limit fairly, transferring unused space from shorter fields.
  let remaining = available;
  const budgets = [0, 0, 0];
  const order = required.map((text, index) => ({ index, size: Array.from(text).length }))
    .sort((a, b) => a.size - b.size);
  order.forEach(({ index, size }, rank) => {
    budgets[index] = Math.min(size, Math.floor(remaining / (3 - rank)));
    remaining -= budgets[index]!;
  });
  const optional = [question.explanation, question.options.map((text, i) => `${i + 1}. ${text}`).join("\n")];
  // Leave a visible omission mark for each optional field even for huge authored questions.
  if (remaining < 2) {
    const largest = budgets.indexOf(Math.max(...budgets));
    budgets[largest]! -= 2 - remaining;
    remaining = 2;
  }
  const explanationBudget = Math.min(Array.from(optional[0]!).length, Math.floor(remaining / 2));
  return [
    ...required.map((text, i) => labels[i]! + shorten(text, budgets[i]!)),
    labels[3]! + shorten(optional[0]!, explanationBudget),
    labels[4]! + shorten(optional[1]!, remaining - explanationBudget),
  ].join("\n\n");
}
