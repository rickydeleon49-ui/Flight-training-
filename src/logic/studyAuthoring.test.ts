import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { LIMITS } from "./studyPacket/limits";
import {
  appendRetirements, assignItemIds, itemOriginLabel, MAX_RETIRED_ITEMS,
  normalizedStudyText, prepareStudyEdit, previewRegeneration, resolveRegeneration, retireItem,
  retirementTerms, retirementTextKey, selectExportItems, StudyAuthoringError,
  type RetiredItem, type StudyItem,
} from "./studyAuthoring";

const card = (id = "card-a", front = "Which wing is lowered?", back = "The upwind wing."): StudyItem => ({ kind: "card", itemId: id, fields: [front, back] });
const summary = (text: string): StudyItem => ({ kind: "summary", itemId: "summary", fields: [text] });
const code = (run: () => unknown, expected: StudyAuthoringError["code"]) => {
  try { run(); throw new Error("Expected a refusal"); }
  catch (error) { expect(error).toBeInstanceOf(StudyAuthoringError); expect((error as StudyAuthoringError).code).toBe(expected); }
};

it("allocates legacy IDs only when asked and keeps subsequent edits on the same identities", () => {
  const input = [{ kind: "summary" as const, fields: ["Summary"] }, { kind: "section" as const, fields: ["Heading", "Body"] }, { kind: "card" as const, fields: ["Front", "Back"] }];
  let allocated = 0;
  const assigned = assignItemIds(input, () => `id-${++allocated}`);
  expect(assigned.map(i => i.itemId)).toEqual(["summary", "id-1", "id-2"]);
  expect(assignItemIds(assigned, () => { throw Error("must not allocate again"); })).toEqual(assigned);
  expect(input[1]).not.toHaveProperty("itemId");
  expect(Object.isFrozen(assigned)).toBe(true);
  expect(Object.isFrozen(assigned[1]!.fields)).toBe(true);
});

it("rejects identity collisions instead of attaching an edit to an ambiguous item", () => {
  code(() => assignItemIds([card("same"), { kind: "section", itemId: "same", fields: ["H", "B"] }]), "invalid_content");
  code(() => assignItemIds([{ kind: "section", fields: ["H", "B"] }, { kind: "card", fields: ["F", "B"] }], () => "duplicate"), "invalid_content");
  code(() => assignItemIds([card("summary")]), "invalid_content");
});

it.each([
  { ...card(), fields: ["one field"] },
  { ...card(), fields: ["", "Back"] },
  { ...card(), fields: ["Front", "Back", "extra"] },
  { ...card(), fields: ["\ud800", "Back"] },
  { ...card(), origin: "gemini" },
  { ...card(), kind: "unknown" },
  { ...card(), itemId: "a b" },
])("refuses malformed authoring input without changing the original", (bad) => {
  const before = JSON.stringify(bad);
  code(() => assignItemIds([bad as StudyItem]), "invalid_content");
  expect(JSON.stringify(bad)).toBe(before);
});

it.each([
  ["summary", ["x".repeat(LIMITS.summary)], ["x".repeat(LIMITS.summary + 1)]],
  ["section", ["x".repeat(LIMITS.heading), "Body"], ["x".repeat(LIMITS.heading + 1), "Body"]],
  ["section", ["Heading", "x".repeat(LIMITS.body)], ["Heading", "x".repeat(LIMITS.body + 1)]],
  ["card", ["x".repeat(LIMITS.front), "Back"], ["x".repeat(LIMITS.front + 1), "Back"]],
  ["card", ["Front", "x".repeat(LIMITS.back)], ["Front", "x".repeat(LIMITS.back + 1)]],
] as const)("honors %s field bounds without clipping text", (kind, fields, over) => {
  const item = { kind, itemId: kind === "summary" ? "summary" : "item", fields };
  expect(assignItemIds([item])[0]!.fields).toEqual(fields);
  code(() => assignItemIds([{ ...item, fields: over }]), "invalid_content");
});

it("accepts exactly the section/card counts and refuses an extra item", () => {
  const sections = Array.from({ length: LIMITS.sections }, (_, i) => ({ kind: "section" as const, itemId: `s-${i}`, fields: ["H", "B"] }));
  const cards = Array.from({ length: LIMITS.flashcards }, (_, i) => card(`c-${i}`));
  expect(assignItemIds([summary(""), ...sections, ...cards])).toHaveLength(601);
  code(() => assignItemIds([...sections, { kind: "section", itemId: "extra", fields: ["H", "B"] }]), "invalid_content");
  code(() => assignItemIds([...cards, card("extra")]), "invalid_content");
});

it("normalizes compatibility text, whitespace and case without locale-dependent casing", async () => {
  expect(normalizedStudyText("  Ａlpha\u00a0 BETA\nGamma  ")).toBe("alpha beta gamma");
  expect(await retirementTextKey(summary("\u00e9"))).toBe(await retirementTextKey(summary("e\u0301")));
  const item = card("a", "  ＦRONT\n", " BACK  ");
  const independentlyFramed = '["front","back"]';
  expect(await retirementTextKey(item)).toBe(createHash("sha256").update(independentlyFramed).digest("hex"));
});

it("keeps field boundaries unambiguous even with embedded NULs", async () => {
  expect(await retirementTextKey(card("a", "a\0b", "c"))).not.toBe(await retirementTextKey(card("b", "a", "b\0c")));
});

it("retains the first 64 sorted distinct words without depending on source order", () => {
  const words = Array.from({ length: 70 }, (_, i) => `word${String(i).padStart(2, "0")}`);
  expect(retirementTerms([words.slice().reverse().join(" "), "WORD00"])).toEqual(words.slice(0, 64));
});

it("creates retirement metadata without copying or mutating the original text", async () => {
  const input = card(); const before = JSON.stringify(input);
  const retired = await retireItem(input, "corrected");
  expect(retired).toMatchObject({ kind: "card", itemId: "card-a", reason: "corrected" });
  expect(retired).not.toHaveProperty("fields");
  expect(retired.textKey).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(input)).toBe(before);
  expect(Object.isFrozen(retired.terms)).toBe(true);
});

const record = (i: number): RetiredItem => ({ kind: "card", itemId: `id-${i}`, reason: "deleted", textKey: createHash("sha256").update(String(i)).digest("hex"), terms: ["back", "front"] });

describe("retirement overflow policy", () => {
  it("allows 1,999 → 2,000 and a repeated retirement at capacity", () => {
    const before = Array.from({ length: MAX_RETIRED_ITEMS - 1 }, (_, i) => record(i));
    const full = appendRetirements(before, [record(1999)]);
    expect(full).toHaveLength(MAX_RETIRED_ITEMS);
    expect(before).toHaveLength(1999);
    expect(appendRetirements(full, [record(1999)])).toEqual(full);
  });
  it("refuses 2,001 without evicting or mutating the existing ledger", () => {
    const full = Array.from({ length: MAX_RETIRED_ITEMS }, (_, i) => record(i));
    const snapshot = JSON.stringify(full);
    code(() => appendRetirements(full, [record(2000)]), "retirement_limit");
    expect(JSON.stringify(full)).toBe(snapshot);
  });
  it("keeps distinct historical text/reasons for the same stable item", () => {
    const a = record(1), b = { ...a, reason: "corrected" as const }, c = { ...a, textKey: record(2).textKey };
    expect(appendRetirements([a], [b, c, a])).toHaveLength(3);
  });
  it.each([
    { ...record(1), textKey: "not-a-hash" },
    { ...record(1), terms: ["UPPER"] },
    { ...record(1), terms: ["front", "back"] },
    { ...record(1), terms: ["back", "back"] },
    { ...record(1), terms: Array.from({ length: 65 }, (_, i) => `word${i}`) },
    { ...record(1), reason: "other" },
  ])("rejects corrupt ledger data instead of silently weakening matching", (entry) => {
    code(() => appendRetirements([entry as RetiredItem], []), "invalid_content");
  });
  it("refuses contradictory term metadata for an identical retirement record", () => {
    code(() => appendRetirements([record(1)], [{ ...record(1), terms: ["different"] }]), "invalid_content");
  });
});

it("holds exact normalized repeats back by default, with an explicit bring-back choice", async () => {
  const old = await retireItem(card("old", "Front", "Back"), "deleted");
  const preview = await previewRegeneration([card("new", " ＦRONT ", "BACK")], [old]);
  expect(preview[0]!.status).toBe("held");
  expect(resolveRegeneration(preview, new Map())).toEqual([]);
  expect(resolveRegeneration(preview, new Map([["new", "keep"]]))).toHaveLength(1);
});

it("blocks a 0.6 near-match until the user chooses, while a 0.5 match is new", async () => {
  const old = await retireItem(summary("alpha beta gamma delta epsilon"), "corrected");
  const near = await previewRegeneration([summary("alpha beta gamma")], [old]);
  expect(near[0]!.status).toBe("unresolved");
  code(() => resolveRegeneration(near, new Map()), "unresolved_match");
  expect(resolveRegeneration(near, new Map([["summary", "omit"]]))).toEqual([]);
  expect(resolveRegeneration(near, new Map([["summary", "keep"]]))).toHaveLength(1);
  const half = await previewRegeneration([summary("alpha beta gamma other")], [old]);
  expect(half[0]!.status).toBe("new");
});

it("does not classify unrelated punctuation or another content kind as a near match", async () => {
  const old = await retireItem(summary("?!"), "deleted");
  expect((await previewRegeneration([summary("...")], [old]))[0]!.status).toBe("new");
  const otherKind = await retireItem({ kind: "section", itemId: "section", fields: ["Front", "Back"] }, "deleted");
  expect((await previewRegeneration([card()], [otherKind]))[0]!.status).toBe("new");
});

it("prefers an exact match over a near match and returns bounded, stable metadata", async () => {
  const exact = await retireItem(summary("alpha beta gamma delta epsilon"), "deleted");
  const near = await retireItem(summary("alpha beta gamma delta other"), "corrected");
  for (const ledger of [[near, exact], [exact, near]]) {
    const result = await previewRegeneration([summary("alpha beta gamma delta epsilon")], ledger);
    expect(result[0]!.status).toBe("held");
    expect(result[0]!.match).toEqual(exact);
    expect(Array.isArray(result[0]!.match)).toBe(false);
  }
});

it("snapshots candidates before asynchronous hashing so an in-flight edit cannot change the preview", async () => {
  const fields = ["Front", "Back"];
  const pending = previewRegeneration([{ kind: "card", itemId: "item", fields }], []);
  fields[0] = "changed while hashing";
  const result = await pending;
  expect(result[0]!.item.fields).toEqual(["Front", "Back"]);
  expect(Object.isFrozen(result[0]!.item.fields)).toBe(true);
  expect(resolveRegeneration(result, new Map())[0]!.fields).toEqual(["Front", "Back"]);
});

it("rejects stale/invalid choices and never modifies either preview or prior records", async () => {
  const preview = await previewRegeneration([card()], []);
  const before = JSON.stringify(preview);
  code(() => resolveRegeneration(preview, new Map([["gone", "keep"]])), "invalid_choice");
  code(() => resolveRegeneration(preview, new Map([["card-a", "unknown" as never]])), "invalid_choice");
  expect(resolveRegeneration(preview, new Map([["card-a", "omit"]]))).toEqual([]);
  expect(JSON.stringify(preview)).toBe(before);
});

it.each([
  [undefined, "gemini", "Gemini"], [undefined, "import", "Imported study packet"],
  [undefined, "manual", "User-created"], ["user", "gemini", "User-created"],
  ["user", "import", "User-created"], ["instructor", "gemini", "Instructor correction"],
  ["instructor", "manual", "Instructor correction"],
] as const)("labels %s on %s truthfully", (origin, provider, label) => {
  expect(itemOriginLabel({ origin }, provider)).toBe(label);
});

it("refuses unknown provenance instead of defaulting it to Gemini", () => {
  code(() => itemOriginLabel({}, "other" as never), "invalid_content");
  code(() => itemOriginLabel({ origin: "other" as never }, "manual"), "invalid_content");
});

it("keeps instructor corrections out of export selection until deliberately included", () => {
  const items = [card("generated"), { ...card("mine"), origin: "user" as const }, { ...card("corrected"), origin: "instructor" as const }];
  expect(selectExportItems(items).map(i => i.itemId)).toEqual(["generated", "mine"]);
  expect(selectExportItems(items, true).map(i => i.itemId)).toEqual(["generated", "mine", "corrected"]);
  expect(items).toHaveLength(3);
});


it("creates manual content without a provider and snapshots both logical states", async () => {
  const current = { items: [], retired: [] };
  const edit = await prepareStudyEdit(current, { kind: "add", item: { kind: "card", fields: ["Front", "Back"], sourcePage: null }, origin: "user" }, () => "new-card");
  expect(edit.next.items[0]).toEqual({ kind: "card", itemId: "new-card", fields: ["Front", "Back"], sourcePage: null, origin: "user" });
  expect(edit.previous).toEqual(current);
  expect(current).toEqual({ items: [], retired: [] });
  expect(edit.reason).toBe("edit");
});

it("keeps an ordinary edit's identity and source page while retiring overwritten wording", async () => {
  const original = { ...card(), sourcePage: 14 };
  const current = { items: [original], retired: [] };
  const edit = await prepareStudyEdit(current, { kind: "edit", itemId: "card-a", fields: ["New front", "New back"], origin: "user" });
  expect(edit.next.items[0]).toMatchObject({ itemId: "card-a", sourcePage: 14, origin: "user" });
  expect(edit.previous.items[0]).toEqual(original);
  expect(edit.next.retired).toHaveLength(1);
  expect((await previewRegeneration([card("generated")], edit.next.retired))[0]!.status).toBe("held");
  expect(current.items[0]).toEqual(original);
});

it("replaces a corrected original rather than putting both versions in the active set", async () => {
  const original = { ...card(), sourcePage: 3 };
  const edit = await prepareStudyEdit({ items: [original], retired: [] }, { kind: "correct", itemId: original.itemId, fields: ["Corrected front", "Corrected back"], origin: "instructor" }, () => "correction");
  expect(edit.next.items).toHaveLength(1);
  expect(edit.next.items[0]).toMatchObject({ itemId: "correction", replaces: "card-a", sourcePage: 3, origin: "instructor" });
  expect(edit.previous.items).toEqual([original]);
  expect(edit.next.retired[0]!.reason).toBe("corrected");
  expect(selectExportItems(edit.next.items)).toEqual([]);
});

it("preserves the summary's material-scoped identity and retires its prior text", async () => {
  const edit = await prepareStudyEdit({ items: [summary("Original")], retired: [] }, { kind: "correct", itemId: "summary", fields: ["Corrected"], origin: "instructor" }, () => { throw Error("summary must not allocate another id"); });
  expect(edit.next.items[0]).toMatchObject({ itemId: "summary", replaces: "summary", fields: ["Corrected"] });
  expect(edit.next.retired).toHaveLength(1);
});

it("deletes an item only in the proposed next state and retains the original for history", async () => {
  const original = card(); const current = { items: [original], retired: [] };
  const edit = await prepareStudyEdit(current, { kind: "delete", itemId: original.itemId });
  expect(edit.next.items).toEqual([]);
  expect(edit.next.retired[0]!.reason).toBe("deleted");
  expect(edit.previous.items).toEqual([original]);
  expect(current.items).toEqual([original]);
});

it("refuses an edit requiring retirement 2,001 without losing the current state", async () => {
  const current = { items: [card()], retired: Array.from({ length: 2000 }, (_, i) => record(i)) };
  const before = JSON.stringify(current);
  await expect(prepareStudyEdit(current, { kind: "delete", itemId: "card-a" })).rejects.toMatchObject({ code: "retirement_limit" });
  expect(JSON.stringify(current)).toBe(before);
  const provenanceOnly = await prepareStudyEdit(current, { kind: "edit", itemId: "card-a", fields: card().fields, origin: "user" });
  expect(provenanceOnly.next.retired).toHaveLength(2000);
});

it("refuses stale targets and correction-ID collisions without changing input", async () => {
  const current = { items: [card("one"), card("two")], retired: [] };
  await expect(prepareStudyEdit(current, { kind: "delete", itemId: "gone" })).rejects.toMatchObject({ code: "item_missing" });
  await expect(prepareStudyEdit(current, { kind: "correct", itemId: "one", fields: ["New", "Answer"], origin: "instructor" }, () => "two")).rejects.toMatchObject({ code: "invalid_content" });
  expect(current.items.map(i => i.itemId)).toEqual(["one", "two"]);
});

it("snapshots a caller's fields before an edit waits for hashing", async () => {
  const fields = ["New front", "New back"];
  const pending = prepareStudyEdit({ items: [card()], retired: [] }, { kind: "edit", itemId: "card-a", fields, origin: "user" });
  fields[0] = "another unsaved edit";
  expect((await pending).next.items[0]!.fields).toEqual(["New front", "New back"]);
});

it("does not allocate identifiers for invalid content", () => {
  code(() => assignItemIds([{ kind: "card", fields: ["", "Back"] }], () => { throw Error("must validate first"); }), "invalid_content");
  code(() => assignItemIds([null as never]), "invalid_content");
});

it("does not reuse a corrected card's original identity", async () => {
  await expect(prepareStudyEdit({ items: [card("same")], retired: [] }, { kind: "correct", itemId: "same", fields: ["New", "Answer"], origin: "instructor" }, () => "same")).rejects.toMatchObject({ code: "invalid_content" });
});

it("chooses the strongest near match independently of ledger order", async () => {
  const better = await retireItem(summary("alpha beta gamma delta"), "deleted");
  const weaker = await retireItem(summary("alpha beta gamma delta epsilon"), "corrected");
  for (const ledger of [[weaker, better], [better, weaker]]) {
    const [entry] = await previewRegeneration([summary("alpha beta gamma")], ledger);
    expect(entry!.status).toBe("unresolved");
    expect(entry!.match).toEqual(better);
  }
});
