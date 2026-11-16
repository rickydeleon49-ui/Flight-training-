import { describe, expect, it } from "vitest";

import { applyPohCards, parsePohSet, pohCards, POH_FIELDS, type PohForm } from "@/logic/pohCards";
import { authoringStateOf } from "@/logic/studySetEditing";

const form = (values: Record<string, string>, memory: PohForm["memory"] = [], type = "Fake-172"): PohForm => ({ type, values, memory });
const empty = () => authoringStateOf({ summary: "", summaryOrigin: null, sections: [], flashcards: [], retired: [] });

describe("pohCards", () => {
  it("makes one card per filled field only, with labels and units", () => {
    const cards = pohCards(form({ vy: "70", fuel: "40 gal", vne: " " }));
    expect(cards).toEqual([
      { front: "Fake-172: Vy (best rate of climb)?", back: "70 KIAS" },
      { front: "Fake-172: Usable fuel?", back: "40 gal" },
    ]);
  });
  it("adds memory items and skips half-filled or repeated ones", () => {
    const cards = pohCards(form({}, [{ prompt: "Fake step", answer: "Fake answer" }, { prompt: "No answer", answer: "" }, { prompt: "fake step", answer: "again" }]));
    expect(cards).toEqual([{ front: "Fake step", back: "Fake answer" }]);
  });
  it("offers a field for every speed she may need", () => {
    expect(POH_FIELDS.map((f) => f.key)).toEqual(expect.arrayContaining(["vr", "vx", "vy", "vg", "va", "vfe", "vno", "vne", "vs0", "vs1", "fuel", "oilMin", "oilMax"]));
  });
});

describe("applyPohCards", () => {
  it("adds user cards, then updates the same cards on re-save without duplicates", async () => {
    const first = await applyPohCards(empty(), pohCards(form({ vy: "70", vx: "60" })));
    const cards1 = first.items.filter((i) => i.kind === "card");
    expect(cards1).toHaveLength(2);
    expect(cards1.every((c) => c.origin === "user")).toBe(true);
    const second = await applyPohCards(first, pohCards(form({ vy: "72", vx: "60", vne: "160" })));
    const cards2 = second.items.filter((i) => i.kind === "card");
    expect(cards2).toHaveLength(3);
    const vy = cards2.find((c) => c.fields[0]!.includes("Vy"))!;
    expect(vy.fields[1]).toBe("72 KIAS");
    expect(vy.itemId).toBe(cards1.find((c) => c.fields[0]!.includes("Vy"))!.itemId);
  });
  it("leaves cards alone when a field is cleared", async () => {
    const first = await applyPohCards(empty(), pohCards(form({ vy: "70" })));
    const second = await applyPohCards(first, pohCards(form({ vx: "60" })));
    expect(second.items.filter((i) => i.kind === "card")).toHaveLength(2);
  });
});

describe("parsePohSet", () => {
  it("round-trips a form without doubling units", () => {
    const f = form({ vy: "70", fuel: "40 gal", oilMax: "8" }, [{ prompt: "Fake step", answer: "Fake answer" }]);
    const cards = pohCards(f);
    const back = parsePohSet("My aircraft: Fake-172", cards.map((c, i) => ({ ...c, itemId: `id${i}` })));
    expect(back.type).toBe("Fake-172");
    expect(back.values).toEqual({ vy: "70 KIAS", fuel: "40 gal", oilMax: "8 qt" });
    expect(back.memory).toHaveLength(5);
    expect(back.memory[0]).toEqual({ prompt: "Fake step", answer: "Fake answer", itemId: "id3" });
    expect(pohCards(back)).toEqual(cards.map((c, i) => (i === 3 ? { ...c, itemId: "id3" } : c)));
  });
  it("updates a memory item in place when its prompt is edited", async () => {
    const first = await applyPohCards(empty(), pohCards(form({}, [{ prompt: "Fake step", answer: "A" }])));
    const id = first.items.find((i) => i.kind === "card")!.itemId;
    const back = parsePohSet("My aircraft: Fake-172", [{ front: "Fake step", back: "A", itemId: id }]);
    const edited = { ...back, memory: back.memory.map((m, i) => (i === 0 ? { ...m, prompt: "Fake step reworded" } : m)) };
    const second = await applyPohCards(first, pohCards(edited));
    const cards = second.items.filter((i) => i.kind === "card");
    expect(cards).toHaveLength(1);
    expect(cards[0]!.itemId).toBe(id);
    expect(cards[0]!.fields[0]).toBe("Fake step reworded");
  });
});
