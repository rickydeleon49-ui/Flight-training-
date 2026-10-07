/**
 * Content-addressed card identity, ported with unchanged meaning from the
 * accepted proof ([model] content-addressed card identity), including the
 * independently computed golden vectors, plus the saved-card validation that
 * decides `ok` / `none` / `malformed`.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { canonicalJson, cardVersion, deriveCurrentCards, parseSavedCards, type CanonicalCard } from "./cardIdentity";

const PROOF = `${process.cwd()}/docs/evidence/m2-card-review-scope-2026-10-06/proof/fixtures`;
const material = JSON.parse(readFileSync(`${PROOF}/synthetic-material.json`, "utf8")) as {
  materialId: string;
  flashcards: CanonicalCard[];
};
const golden = JSON.parse(readFileSync(`${PROOF}/identity-golden.json`, "utf8")) as {
  canonicalJson: string;
  contentHash: string;
  versionId: string;
  itemIds: string[];
};

describe("[identity] content-addressed card identity", () => {
  it("matches the golden vectors computed independently in Python", async () => {
    expect(canonicalJson(material.flashcards)).toBe(golden.canonicalJson);
    const version = await cardVersion(material.materialId, material.flashcards);
    expect({ contentHash: version.contentHash, versionId: version.versionId, itemIds: version.items.map((i) => i.itemId) }).toEqual({
      contentHash: golden.contentHash,
      versionId: golden.versionId,
      itemIds: golden.itemIds,
    });
  });

  it("is stable across calls and gives each of the three synthetic cards a distinct item ID", async () => {
    const a = await cardVersion(material.materialId, material.flashcards);
    const b = await cardVersion(material.materialId, structuredClone(material.flashcards));
    expect(a).toEqual(b);
    expect(new Set(a.items.map((item) => item.itemId)).size).toBe(3);
  });

  it("changing one card's text creates a new version whose items share no ID with the old one", async () => {
    const old = await cardVersion(material.materialId, material.flashcards);
    const edited = structuredClone(material.flashcards);
    edited[1]!.back = "Synthetic replacement";
    const replacement = await cardVersion(material.materialId, edited);
    expect(replacement.versionId).not.toBe(old.versionId);
    expect(replacement.items.filter((item) => old.items.some((o) => o.itemId === item.itemId))).toHaveLength(0);
  });

  it("reordering creates a new version; A -> B -> A returns to the original version", async () => {
    const original = await cardVersion(material.materialId, material.flashcards);
    const reordered = await cardVersion(material.materialId, [...material.flashcards].reverse());
    expect(reordered.versionId).not.toBe(original.versionId);
    expect((await cardVersion(material.materialId, material.flashcards)).versionId).toBe(original.versionId);
  });

  it("the same cards under another material are a different version; duplicate cards stay distinct by ordinal", async () => {
    expect((await cardVersion("other-material", material.flashcards)).versionId).not.toBe(
      (await cardVersion(material.materialId, material.flashcards)).versionId,
    );
    const twin = material.flashcards[0]!;
    const duplicated = await cardVersion(material.materialId, [twin, twin]);
    expect(duplicated.items[0]!.itemId).not.toBe(duplicated.items[1]!.itemId);
  });

  it("only front, back and sourcePage take part in identity", async () => {
    const extra = material.flashcards.map((card) => ({ ...card, note: "ignored" }));
    expect((await deriveCurrentCards(material.materialId, JSON.stringify(extra)))).toMatchObject({ versionId: golden.versionId });
  });
});

describe("[identity] saved-card validation", () => {
  const card = (overrides: Record<string, unknown> = {}) => ({ front: "F", back: "B", sourcePage: null, ...overrides });
  const set = (cards: unknown[]) => JSON.stringify(cards);

  it("absent and empty sets are none; a valid set is ok", () => {
    expect(parseSavedCards(null)).toEqual({ status: "none" });
    expect(parseSavedCards("[]")).toEqual({ status: "none" });
    expect(parseSavedCards(set([card()]))).toMatchObject({ status: "ok" });
  });

  it("accepts the exact bounds and refuses one past them", () => {
    expect(parseSavedCards(set(Array.from({ length: 500 }, () => card())))).toMatchObject({ status: "ok" });
    expect(parseSavedCards(set(Array.from({ length: 501 }, () => card())))).toEqual({ status: "malformed" });
    expect(parseSavedCards(set([card({ front: "x".repeat(1_000) })]))).toMatchObject({ status: "ok" });
    expect(parseSavedCards(set([card({ front: "x".repeat(1_001) })]))).toEqual({ status: "malformed" });
    expect(parseSavedCards(set([card({ back: "😀".repeat(2_000) })]))).toMatchObject({ status: "ok" });
    expect(parseSavedCards(set([card({ back: "😀".repeat(2_001) })]))).toEqual({ status: "malformed" });
    expect(parseSavedCards(set([card({ front: `  ${"x".repeat(1_000)}\n` })]))).toMatchObject({ status: "ok" });
    expect(parseSavedCards(set([card({ sourcePage: 1 })]))).toMatchObject({ status: "ok" });
    expect(parseSavedCards(set([card({ sourcePage: 1_000 })]))).toMatchObject({ status: "ok" });
  });

  it("refuses the whole set when any card is damaged, never converting it to empty", () => {
    for (const damaged of [
      "{not json",
      "{}",
      set([card(), "text"]),
      set([card(), null]),
      set([card({ front: "   " })]),
      set([card({ back: "" })]),
      set([card({ front: 3 })]),
      set([{ front: "F", back: "B" }]),
      set([card({ sourcePage: 0 })]),
      set([card({ sourcePage: 1_001 })]),
      set([card({ sourcePage: 1.5 })]),
      set([card({ sourcePage: "3" })]),
      '[{"front":"\\ud800","back":"B","sourcePage":null}]',
      set([card({ front: "﻿" })]),
    ]) {
      expect(parseSavedCards(damaged), damaged).toEqual({ status: "malformed" });
    }
  });

  it("U+0085 is text, not whitespace, exactly as the native trim treats it", () => {
    expect(parseSavedCards(set([card({ front: "\u0085" })]))).toMatchObject({ status: "ok" });
  });
});
