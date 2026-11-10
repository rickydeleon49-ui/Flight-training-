// @vitest-environment jsdom
import { beforeEach, expect, it } from "vitest";

import { makeMaterial } from "@/testing/factories";
import { sortMaterials } from "@/logic/library";
import { pushRecent, recordOpened, resolveRecent, RECENT_KEY } from "./recentlyOpened";

beforeEach(() => localStorage.clear());

it("pushRecent puts the newest first, drops duplicates and caps the list", () => {
  expect(pushRecent(["a", "b", "c"], "d", 3)).toEqual(["d", "a", "b"]);
  expect(pushRecent(["a", "b", "c"], "b", 3)).toEqual(["b", "a", "c"]);
  const many = Array.from({ length: 60 }, (_, i) => `x${i}`);
  expect(pushRecent(many, "new")).toHaveLength(50);
});

it("resolveRecent drops deleted materials and keeps order", () => {
  const a = makeMaterial({ id: "a" });
  const c = makeMaterial({ id: "c" });
  expect(resolveRecent(["c", "gone", "a"], [a, c]).map((m) => m.id)).toEqual(["c", "a"]);
});

it("recordOpened stores the list on this device", () => {
  recordOpened("a");
  recordOpened("b");
  recordOpened("a");
  expect(JSON.parse(localStorage.getItem(`her-flight-deck.view.${RECENT_KEY}`)!)).toEqual(["a", "b"]);
});

it("Recently studied puts opened materials first, newest first, then the rest", () => {
  const a = makeMaterial({ id: "a", title: "A", createdAt: "2026-01-01T00:00:00.000Z" });
  const b = makeMaterial({ id: "b", title: "B", createdAt: "2026-01-02T00:00:00.000Z" });
  const c = makeMaterial({ id: "c", title: "C", createdAt: "2026-01-03T00:00:00.000Z" });
  const d = makeMaterial({ id: "d", title: "D", createdAt: "2026-01-04T00:00:00.000Z" });
  expect(sortMaterials([a, b, c, d], "studied", ["a", "b"]).map((m) => m.id)).toEqual(["a", "b", "d", "c"]);
});
