/** Turn text copied from Quizlet's Export into flashcards (BL-68). Pure; no network. */
export const QUIZLET_CARD_CAP = 500;

export interface QuizletParse {
  cards: { front: string; back: string }[];
  skippedDuplicates: number;
  skippedBlank: number;
  /** True when more than the cap was found and the rest was left out. */
  cut: boolean;
}

const key = (text: string) => text.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();

function splitRow(row: string): [string, string] {
  let at = row.indexOf("\t");
  if (at >= 0) return [row.slice(0, at), row.slice(at + 1)];
  at = row.search(/,/u);
  if (at >= 0) return [row.slice(0, at), row.slice(at + 1)];
  at = row.indexOf(" - ");
  if (at >= 0) return [row.slice(0, at), row.slice(at + 3)];
  return [row, ""];
}

export function parseQuizletText(text: string, existingFronts: readonly string[]): QuizletParse {
  const clean = text.replace(/^﻿/u, "").replace(/\r\n?/gu, "\n");
  const rows = !clean.includes("\n") && clean.includes(";") ? clean.split(";") : clean.split("\n");
  const seen = new Set(existingFronts.map(key));
  const cards: { front: string; back: string }[] = [];
  let skippedDuplicates = 0;
  let skippedBlank = 0;
  let cut = false;
  for (const row of rows) {
    if (!row.trim()) continue;
    const [rawFront, rawBack] = splitRow(row);
    const front = rawFront.trim();
    const back = rawBack.trim();
    if (!front || !back) {
      skippedBlank += 1;
      continue;
    }
    const k = key(front);
    if (seen.has(k)) {
      skippedDuplicates += 1;
      continue;
    }
    if (cards.length >= QUIZLET_CARD_CAP) {
      cut = true;
      continue;
    }
    seen.add(k);
    cards.push({ front, back });
  }
  return { cards, skippedDuplicates, skippedBlank, cut };
}
