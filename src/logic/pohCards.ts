/** "My aircraft" cards: the student types numbers from your own POH; the app ships none (BL-73). Pure. */
import { normalizedStudyText, prepareStudyEdit, type AuthoringState } from "@/logic/studyAuthoring";

export type PohUnit = "KIAS" | "gal" | "qt";
export interface PohField { key: string; label: string; unit: PohUnit; speed: boolean }

export const POH_FIELDS: readonly PohField[] = [
  { key: "vr", label: "Vr (rotation speed)", unit: "KIAS", speed: true },
  { key: "vx", label: "Vx (best angle of climb)", unit: "KIAS", speed: true },
  { key: "vy", label: "Vy (best rate of climb)", unit: "KIAS", speed: true },
  { key: "vg", label: "Vg (best glide)", unit: "KIAS", speed: true },
  { key: "va", label: "Va (maneuvering speed)", unit: "KIAS", speed: true },
  { key: "vfe", label: "Vfe (max flaps extended)", unit: "KIAS", speed: true },
  { key: "vno", label: "Vno (max structural cruising)", unit: "KIAS", speed: true },
  { key: "vne", label: "Vne (never exceed)", unit: "KIAS", speed: true },
  { key: "vs0", label: "Vs0 (stall, landing configuration)", unit: "KIAS", speed: true },
  { key: "vs1", label: "Vs1 (stall, clean)", unit: "KIAS", speed: true },
  { key: "fuel", label: "Usable fuel", unit: "gal", speed: false },
  { key: "oilMin", label: "Oil minimum", unit: "qt", speed: false },
  { key: "oilMax", label: "Oil maximum", unit: "qt", speed: false },
];

export const POH_MEMORY_LINES = 5;
export const POH_NOTE = "Type these from your aircraft's POH. Your instructor's POH numbers win.";

export interface PohForm {
  type: string;
  values: Readonly<Record<string, string>>;
  /** `itemId` is set for a line loaded from a saved card, so editing it updates that card. */
  memory: readonly { prompt: string; answer: string; itemId?: string }[];
}
export interface PohCard { front: string; back: string; itemId?: string }

export const pohSetTitle = (type: string): string => `My aircraft: ${type.trim()}`;

const clean = (text: string | undefined) => (text ?? "").replace(/\s+/gu, " ").trim();

/** Your number, with its unit added only when you typed a bare number. */
function withUnit(value: string, unit: PohUnit): string {
  return /\p{L}/u.test(value) ? value : `${value} ${unit}`;
}

export const POH_TITLE_PREFIX = "My aircraft: ";

/** The aircraft type in a set title made by this form, or null for any other title. */
export const pohTypeOfTitle = (title: string): string | null =>
  title.startsWith(POH_TITLE_PREFIX) && title.slice(POH_TITLE_PREFIX.length).trim() ? title.slice(POH_TITLE_PREFIX.length).trim() : null;

/**
 * The form a saved set was made from: cards whose question has this form's wording fill their
 * field; any other cards (up to the memory-line limit) fill the memory lines.
 */
export function parsePohSet(title: string, cards: readonly { front: string; back: string; itemId?: string }[]): PohForm {
  const type = pohTypeOfTitle(title) ?? "";
  const byFront = new Map(POH_FIELDS.map((f) => [normalizedStudyText(`${type}: ${f.label}?`), f.key]));
  const values: Record<string, string> = {};
  const memory: { prompt: string; answer: string; itemId?: string }[] = [];
  for (const card of cards) {
    const key = byFront.get(normalizedStudyText(card.front));
    if (key && values[key] === undefined) values[key] = card.back;
    else if (!key && memory.length < POH_MEMORY_LINES) memory.push({ prompt: card.front, answer: card.back, ...(card.itemId ? { itemId: card.itemId } : {}) });
  }
  while (memory.length < POH_MEMORY_LINES) memory.push({ prompt: "", answer: "" });
  return { type, values, memory };
}

/** One card per filled field, in form order. Blank fields make no card. */
export function pohCards(form: PohForm): PohCard[] {
  const type = clean(form.type);
  const cards: PohCard[] = [];
  for (const field of POH_FIELDS) {
    const value = clean(form.values[field.key]);
    if (!value) continue;
    cards.push({ front: `${type}: ${field.label}?`, back: withUnit(value, field.unit) });
  }
  const seen = new Set(cards.map((card) => normalizedStudyText(card.front)));
  for (const line of form.memory.slice(0, POH_MEMORY_LINES)) {
    const front = clean(line.prompt);
    const back = clean(line.answer);
    if (!front || !back || seen.has(normalizedStudyText(front))) continue;
    seen.add(normalizedStudyText(front));
    cards.push({ front, back, ...(line.itemId ? { itemId: line.itemId } : {}) });
  }
  return cards;
}

/**
 * Put the cards into a set. A card whose question is already there is updated in place
 * (same item, so its review history stays); the rest are added. Nothing is removed.
 */
export async function applyPohCards(state: AuthoringState, cards: readonly PohCard[]): Promise<AuthoringState> {
  let next = state;
  for (const card of cards) {
    const at =
      (card.itemId ? next.items.find((item) => item.kind === "card" && item.itemId === card.itemId) : undefined) ??
      next.items.find((item) => item.kind === "card" && normalizedStudyText(item.fields[0] ?? "") === normalizedStudyText(card.front));
    const plan = at
      ? await prepareStudyEdit(next, { kind: "edit", itemId: at.itemId, fields: [card.front, card.back], origin: "user" })
      : await prepareStudyEdit(next, { kind: "add", item: { kind: "card", fields: [card.front, card.back], sourcePage: null }, origin: "user" });
    next = plan.next;
  }
  return next;
}
