import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearDraft, readDraft, writeDraft } from "./drafts";

class MemoryStorage {
  private items = new Map<string, string>();
  getItem(key: string) { return this.items.get(key) ?? null; }
  setItem(key: string, value: string) { this.items.set(key, value); }
  removeItem(key: string) { this.items.delete(key); }
}

beforeEach(() => {
  vi.stubGlobal("window", { localStorage: new MemoryStorage() });
});

afterEach(() => vi.unstubAllGlobals());

describe("drafts", () => {
  it("gives back what was written", () => {
    writeDraft("journal.new", { title: "First solo", confidence: 4 });
    expect(readDraft("journal.new")).toEqual({ title: "First solo", confidence: 4 });
  });

  it("has nothing for a form that was never left mid-edit", () => {
    expect(readDraft("journal.new")).toBeNull();
  });

  it("forgets a draft once it is cleared", () => {
    writeDraft("journal.new", { title: "First solo" });
    clearDraft("journal.new");
    expect(readDraft("journal.new")).toBeNull();
  });

  it("keeps drafts of different forms apart", () => {
    writeDraft("journal.new", { title: "New" });
    writeDraft("journal.abc", { title: "Editing" });
    expect(readDraft("journal.new")).toEqual({ title: "New" });
    expect(readDraft("journal.abc")).toEqual({ title: "Editing" });
  });

  it("treats damaged stored text as no draft at all", () => {
    window.localStorage.setItem("her-flight-deck.draft.journal.new", "{not json");
    expect(readDraft("journal.new")).toBeNull();
  });

  it("survives storage being unavailable", () => {
    vi.stubGlobal("window", {
      get localStorage(): Storage {
        throw new Error("blocked");
      },
    });
    expect(() => writeDraft("journal.new", { title: "x" })).not.toThrow();
    expect(readDraft("journal.new")).toBeNull();
    expect(() => clearDraft("journal.new")).not.toThrow();
  });

  it("survives storage refusing to write", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => null,
        setItem: () => { throw new Error("quota exceeded"); },
        removeItem: () => undefined,
      },
    });
    expect(() => writeDraft("journal.new", { title: "x" })).not.toThrow();
  });
});
