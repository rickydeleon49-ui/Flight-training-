import { describe, expect, it } from "vitest";

import type {
  PracticeAttempt,
  PracticeResponse,
  PracticeTestItem,
  PracticeTestVersion,
} from "@/domain/types";
import { attemptReviewPath } from "./practiceAttemptReview";
import {
  DEFAULT_MISTAKE_FOLLOWUPS_LIMIT,
  MAX_MISTAKE_FOLLOWUPS_LIMIT,
  selectPracticeMistakeFollowups,
} from "./practiceMistakeFollowups";

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

function makeVersion(overrides?: Partial<PracticeTestVersion>): PracticeTestVersion {
  return {
    id: "ver-1",
    sourceMaterialId: "mat-1",
    historyKey: "hist-key-1",
    sourceMaterialTitle: "Navigation Fundamentals",
    versionNumber: 1,
    provider: "manual",
    model: "test-model",
    title: "Practice Test 1",
    contentHash: "a".repeat(64),
    createdAt: "2026-10-20T10:00:00.000Z",
    isActive: true,
    ...overrides,
  };
}

function makeAttempt(overrides?: Partial<PracticeAttempt>): PracticeAttempt {
  const totalQuestions = overrides?.totalQuestions ?? 4;
  return {
    id: "att-1",
    versionId: "ver-1",
    sourceMaterialId: "mat-1",
    sourceMaterialTitle: "Navigation Fundamentals",
    startedAt: "2026-10-20T10:05:00.000Z",
    completedAt: "2026-10-20T10:25:00.000Z",
    status: "completed",
    revision: 1,
    totalQuestions,
    answeredCount: totalQuestions,
    correctCount: 0,
    incorrectCount: totalQuestions,
    dontKnowCount: 0,
    scorePercent: 0,
    ...overrides,
  };
}

function makeItem(
  ordinal: number,
  overrides?: Partial<PracticeTestItem>,
): PracticeTestItem {
  return {
    id: `item-${ordinal}`,
    versionId: "ver-1",
    ordinal,
    questionText: `Question text ${ordinal}`,
    options: ["Option A", "Option B", "Option C", "Option D"],
    correctIndex: 0,
    explanation: `Explanation ${ordinal}`,
    sourcePage: 10 + ordinal,
    logicalId: `logical-${ordinal}`,
    origin: "instructor",
    replaces: null,
    ...overrides,
  };
}

function makeResponse(
  itemId: string,
  selectedIndex: number | null,
  isDontKnow = false,
  attemptId = "att-1",
  correctIndex = 0,
  isCorrectOverride?: boolean,
): PracticeResponse {
  const isCorrect =
    isCorrectOverride !== undefined
      ? isCorrectOverride
      : !isDontKnow && selectedIndex !== null && selectedIndex === correctIndex;
  return {
    id: `resp-${attemptId}-${itemId}`,
    attemptId,
    itemId,
    selectedIndex,
    isDontKnow,
    isCorrect,
    answeredAt: "2026-10-20T10:15:00.000Z",
  };
}

describe("selectPracticeMistakeFollowups", () => {
  describe("explicit ID collision regression", () => {
    it("ensures distinct IDs when colon joining would collide", () => {
      // Prior colon-join candidateId was `${attempt.id}:${version.id}:${item.id}`.
      // Tuple 1: attempt="a:b", version="c", item="d" -> "a:b:c:d"
      // Tuple 2: attempt="a", version="b:c", item="d" -> "a:b:c:d"
      const ver1 = makeVersion({ id: "c" });
      const att1 = makeAttempt({ id: "a:b", versionId: "c", totalQuestions: 1 });
      const item1 = makeItem(0, { id: "d", versionId: "c" });
      const resp1 = makeResponse("d", 1, false, "a:b");

      const res1 = selectPracticeMistakeFollowups({
        attempt: att1,
        version: ver1,
        items: [item1],
        responses: [resp1],
      });
      expect(res1.status).toBe("available");
      if (res1.status !== "available") return;
      expect(res1.suggestions).toHaveLength(1);
      const id1 = res1.suggestions[0]!.id;

      const ver2 = makeVersion({ id: "b:c" });
      const att2 = makeAttempt({ id: "a", versionId: "b:c", totalQuestions: 1 });
      const item2 = makeItem(0, { id: "d", versionId: "b:c" });
      const resp2 = makeResponse("d", 1, false, "a");

      const res2 = selectPracticeMistakeFollowups({
        attempt: att2,
        version: ver2,
        items: [item2],
        responses: [resp2],
      });
      expect(res2.status).toBe("available");
      if (res2.status !== "available") return;
      expect(res2.suggestions).toHaveLength(1);
      const id2 = res2.suggestions[0]!.id;

      expect(id1).not.toBe(id2);
      expect(id1).toBe(JSON.stringify(["a:b", "c", "d"]));
      expect(id2).toBe(JSON.stringify(["a", "b:c", "d"]));
    });

    it("handles opaque IDs containing slashes, quotes, and unicode characters safely", () => {
      const ver = makeVersion({ id: "v/1:α" });
      const att = makeAttempt({ id: 'att/"quoted":β', versionId: "v/1:α", totalQuestions: 1 });
      const item = makeItem(0, { id: "item/γ:42", versionId: "v/1:α" });
      const resp = makeResponse("item/γ:42", 2, false, 'att/"quoted":β');

      const res = selectPracticeMistakeFollowups({
        attempt: att,
        version: ver,
        items: [item],
        responses: [resp],
      });
      expect(res.status).toBe("available");
      if (res.status !== "available") return;
      expect(res.suggestions).toHaveLength(1);
      expect(res.suggestions[0]!.id).toBe(
        JSON.stringify(['att/"quoted":β', "v/1:α", "item/γ:42"]),
      );
    });
  });

  describe("meaningful outcomes and actual type narrowing", () => {
    it("distinguishes incorrect, dont_know, unanswered and excludes correct", () => {
      const version = makeVersion();
      const attempt = makeAttempt({
        totalQuestions: 4,
        answeredCount: 3,
        correctCount: 1,
        incorrectCount: 1,
        dontKnowCount: 1,
        scorePercent: 25,
      });
      const items = [
        makeItem(0, { correctIndex: 0 }), // will be correct
        makeItem(1, { correctIndex: 0 }), // will be incorrect
        makeItem(2, { correctIndex: 0 }), // will be dont_know
        makeItem(3, { correctIndex: 0 }), // will be unanswered
      ];
      const responses = [
        makeResponse("item-0", 0, false), // correct
        makeResponse("item-1", 2, false), // incorrect
        makeResponse("item-2", null, true), // dont_know
        // item-3 omitted -> unanswered
      ];

      const res = selectPracticeMistakeFollowups({
        attempt,
        version,
        items,
        responses,
      });

      expect(res.status).toBe("available");
      if (res.status !== "available") return;

      expect(res.totalEligibleCount).toBe(3);
      expect(res.remainingCount).toBe(0);
      expect(res.suggestions).toHaveLength(3);

      const [sug0, sug1, sug2] = res.suggestions;
      expect(sug0).toBeDefined();
      expect(sug1).toBeDefined();
      expect(sug2).toBeDefined();
      if (!sug0 || !sug1 || !sug2) return;

      expect(sug0.outcome).toBe("incorrect");
      expect(sug0.number).toBe(2);
      expect(sug0.item.id).toBe("item-1");
      expect(sug0.response?.selectedIndex).toBe(2);

      expect(sug1.outcome).toBe("dont_know");
      expect(sug1.number).toBe(3);
      expect(sug1.item.id).toBe("item-2");
      expect(sug1.response?.isDontKnow).toBe(true);

      expect(sug2.outcome).toBe("unanswered");
      expect(sug2.number).toBe(4);
      expect(sug2.item.id).toBe("item-3");
      expect(sug2.response).toBeNull();
    });
  });

  describe("bounds, limits, and clamping", () => {
    it("defaults to 3 suggestions and max clamps to 5 on a 20-missed test", () => {
      const totalQuestions = 20;
      const version = makeVersion();
      const attempt = makeAttempt({ totalQuestions });
      const items = Array.from({ length: totalQuestions }, (_, i) => makeItem(i, { correctIndex: 0 }));
      const responses = items.map((it) => makeResponse(it.id, 1, false)); // all incorrect

      // 1. Default limit (undefined) -> 3 suggestions
      const resDefault = selectPracticeMistakeFollowups({
        attempt,
        version,
        items,
        responses,
      });
      expect(resDefault.status).toBe("available");
      if (resDefault.status !== "available") return;
      expect(resDefault.totalEligibleCount).toBe(20);
      expect(resDefault.suggestions).toHaveLength(DEFAULT_MISTAKE_FOLLOWUPS_LIMIT);
      expect(resDefault.remainingCount).toBe(17);
      expect(resDefault.suggestions.map((s) => s.number)).toEqual([1, 2, 3]);

      // 2. Custom limit = 1
      const res1 = selectPracticeMistakeFollowups({
        attempt,
        version,
        items,
        responses,
        limit: 1,
      });
      expect(res1.status).toBe("available");
      if (res1.status !== "available") return;
      expect(res1.suggestions).toHaveLength(1);
      expect(res1.remainingCount).toBe(19);

      // 3. Custom limit = 5 (max boundary)
      const res5 = selectPracticeMistakeFollowups({
        attempt,
        version,
        items,
        responses,
        limit: 5,
      });
      expect(res5.status).toBe("available");
      if (res5.status !== "available") return;
      expect(res5.suggestions).toHaveLength(MAX_MISTAKE_FOLLOWUPS_LIMIT);
      expect(res5.remainingCount).toBe(15);
      expect(res5.suggestions.map((s) => s.number)).toEqual([1, 2, 3, 4, 5]);

      // 4. Custom limit > 5 (clamped to 5)
      const resOver = selectPracticeMistakeFollowups({
        attempt,
        version,
        items,
        responses,
        limit: 20,
      });
      expect(resOver.status).toBe("available");
      if (resOver.status !== "available") return;
      expect(resOver.suggestions).toHaveLength(MAX_MISTAKE_FOLLOWUPS_LIMIT);
      expect(resOver.remainingCount).toBe(15);

      // 5. Valid integer 0 opts out
      const resZero = selectPracticeMistakeFollowups({
        attempt,
        version,
        items,
        responses,
        limit: 0,
      });
      expect(resZero.status).toBe("available");
      if (resZero.status !== "available") return;
      expect(resZero.suggestions).toHaveLength(0);
      expect(resZero.totalEligibleCount).toBe(20);
      expect(resZero.remainingCount).toBe(20);
    });

    it.each([
      ["negative integer", -1],
      ["negative integer -5", -5],
      ["fractional positive", 2.5],
      ["fractional zero", 0.5],
      ["fractional negative", -0.1],
      ["NaN", Number.NaN],
      ["Infinity", Number.POSITIVE_INFINITY],
      ["-Infinity", Number.NEGATIVE_INFINITY],
    ])("fails closed as invalid_limit on %s (%s)", (_desc, badLimit) => {
      const version = makeVersion();
      const attempt = makeAttempt({ totalQuestions: 1 });
      const items = [makeItem(0)];
      const responses: PracticeResponse[] = [];

      const res = selectPracticeMistakeFollowups({
        attempt,
        version,
        items,
        responses,
        limit: badLimit,
      });
      expect(res).toEqual({
        status: "unavailable",
        reason: "invalid_limit",
        suggestions: [],
      });
    });
  });

  describe("provenance, deep immutability, and isolation", () => {
    it("returns fresh deep copies of items, options, and provenance; input mutation cannot affect results and vice versa", () => {
      const version = makeVersion();
      const attempt = makeAttempt({ totalQuestions: 1 });
      const quote = "Wind vector triangle calculation details";
      const quoteBytes = new TextEncoder().encode(quote).length; // 41 bytes UTF-8
      const startOffset = 100;
      const endOffset = startOffset + quoteBytes; // 141 bytes UTF-8

      const originalItem = makeItem(0, {
        options: ["East", "West", "North", "South"],
        origin: "user",
        logicalId: "logic-nav-1",
        replaces: "logic-nav-old",
        pdfProvenance: {
          status: "valid",
          label: "Pulled from your PDF on this Mac",
          editOrigin: "instructor",
          sources: [
            {
              itemKind: "question",
              logicalId: "logic-nav-1",
              contentHash: "a".repeat(64),
              page: 12,
              startOffset,
              endOffset,
              quote,
              runId: "12345678-1234-4234-8234-123456789abc",
            },
          ],
        },
      });
      const originalResponse = makeResponse("item-0", 1, false);

      // Deep freeze inputs to verify no mutation occurs inside the helper
      deepFreeze(version);
      deepFreeze(attempt);
      deepFreeze(originalItem);
      deepFreeze(originalResponse);

      const res = selectPracticeMistakeFollowups({
        attempt,
        version,
        items: [originalItem],
        responses: [originalResponse],
      });

      expect(res.status).toBe("available");
      if (res.status !== "available") return;
      expect(res.suggestions).toHaveLength(1);

      const cand = res.suggestions[0]!;

      // Verify fields retained
      expect(cand.item.options).toEqual(["East", "West", "North", "South"]);
      expect(cand.item.origin).toBe("user");
      expect(cand.item.logicalId).toBe("logic-nav-1");
      expect(cand.item.replaces).toBe("logic-nav-old");
      expect(cand.item.pdfProvenance).toEqual(originalItem.pdfProvenance);
      expect(cand.item.pdfProvenance?.sources[0]!.quote).toBe(
        "Wind vector triangle calculation details",
      );

      // Verify candidates have independent references
      expect(cand.item).not.toBe(originalItem);
      expect(cand.item.options).not.toBe(originalItem.options);
      expect(cand.item.pdfProvenance).not.toBe(originalItem.pdfProvenance);
      expect(cand.item.pdfProvenance?.sources).not.toBe(originalItem.pdfProvenance?.sources);
      expect(cand.item.pdfProvenance?.sources[0]).not.toBe(originalItem.pdfProvenance?.sources[0]);
      expect(cand.response).not.toBe(originalResponse);

      // Mutate returned candidate to ensure it doesn't affect input
      cand.item.options.push("North-West");
      expect(cand.item.options).toHaveLength(5);
      expect(originalItem.options).toHaveLength(4);

      // Mutate returned provenance source quote (safe after defined guards)
      expect(cand.item.pdfProvenance?.sources).toBeDefined();
      expect(cand.item.pdfProvenance?.sources).toHaveLength(1);
      const candSources = cand.item.pdfProvenance?.sources;
      if (candSources && candSources.length > 0) {
        const candSource = candSources[0]!;
        candSource.quote = "Mutated quote in returned candidate";
        expect(candSource.quote).toBe("Mutated quote in returned candidate");
        expect(originalItem.pdfProvenance?.sources[0]!.quote).toBe(
          "Wind vector triangle calculation details",
        );
      }

      // Mutate returned response selectedIndex (safe after defined guards)
      expect(cand.response).not.toBeNull();
      if (cand.response) {
        cand.response.selectedIndex = 3;
        expect(cand.response.selectedIndex).toBe(3);
        expect(originalResponse.selectedIndex).toBe(1);
      }
    });
  });

  describe("encoded review paths", () => {
    it("preserves fullMissedReviewPath matching encoded route helper", () => {
      const version = makeVersion({ historyKey: "key with spaces & slashes/1" });
      const attempt = makeAttempt({
        id: "att:1#special",
        totalQuestions: 1,
        answeredCount: 0,
        incorrectCount: 0,
        scorePercent: 0,
      });
      const item = makeItem(0);
      const responses: PracticeResponse[] = [];

      const res = selectPracticeMistakeFollowups({
        attempt,
        version,
        items: [item],
        responses,
      });

      expect(res.status).toBe("available");
      if (res.status !== "available") return;

      const expectedPath = attemptReviewPath(
        "key with spaces & slashes/1",
        "att:1#special",
        "missed",
      );
      expect(res.fullMissedReviewPath).toBe(expectedPath);
      expect(res.fullMissedReviewPath).toContain("?review=missed");
    });
  });

  describe("order stability with shuffled items", () => {
    it("returns suggestions strictly in frozen ordinal order regardless of input array ordering", () => {
      const version = makeVersion();
      const attempt = makeAttempt({
        totalQuestions: 3,
        answeredCount: 0,
        incorrectCount: 0,
        scorePercent: 0,
      });
      const items = [
        makeItem(2, { id: "item-2" }),
        makeItem(0, { id: "item-0" }),
        makeItem(1, { id: "item-1" }),
      ];
      const responses: PracticeResponse[] = []; // all unanswered

      const res = selectPracticeMistakeFollowups({
        attempt,
        version,
        items,
        responses,
      });

      expect(res.status).toBe("available");
      if (res.status !== "available") return;

      expect(res.suggestions.map((s) => s.number)).toEqual([1, 2, 3]);
      expect(res.suggestions.map((s) => s.item.id)).toEqual([
        "item-0",
        "item-1",
        "item-2",
      ]);
    });
  });

  describe("graceful edge cases: zero items and all correct", () => {
    it("handles zero questions gracefully", () => {
      const version = makeVersion();
      const attempt = makeAttempt({
        totalQuestions: 0,
        answeredCount: 0,
        correctCount: 0,
        incorrectCount: 0,
        dontKnowCount: 0,
        scorePercent: null,
      });

      const res = selectPracticeMistakeFollowups({
        attempt,
        version,
        items: [],
        responses: [],
      });

      expect(res).toEqual({
        status: "available",
        attemptId: "att-1",
        versionId: "ver-1",
        sourceMaterialId: "mat-1",
        sourceMaterialTitle: "Navigation Fundamentals",
        fullMissedReviewPath: attemptReviewPath("hist-key-1", "att-1", "missed"),
        suggestions: [],
        totalEligibleCount: 0,
        remainingCount: 0,
      });
    });

    it("handles all correct responses gracefully with available empty suggestions", () => {
      const version = makeVersion();
      const attempt = makeAttempt({
        totalQuestions: 2,
        answeredCount: 2,
        correctCount: 2,
        incorrectCount: 0,
        dontKnowCount: 0,
        scorePercent: 100,
      });
      const items = [makeItem(0, { correctIndex: 1 }), makeItem(1, { correctIndex: 2 })];
      const responses = [
        makeResponse("item-0", 1, false, "att-1", 1),
        makeResponse("item-1", 2, false, "att-1", 2),
      ];

      const res = selectPracticeMistakeFollowups({
        attempt,
        version,
        items,
        responses,
      });

      expect(res.status).toBe("available");
      if (res.status !== "available") return;
      expect(res.totalEligibleCount).toBe(0);
      expect(res.remainingCount).toBe(0);
      expect(res.suggestions).toEqual([]);
    });
  });

  describe("historical inactive versions and null source materials", () => {
    it("permits inactive historical version and null sourceMaterialId without claiming fresh availability", () => {
      const version = makeVersion({
        isActive: false,
        sourceMaterialId: null,
      });
      const attempt = makeAttempt({
        versionId: "ver-1",
        sourceMaterialId: null,
        totalQuestions: 1,
      });
      const items = [makeItem(0)];
      const responses = [makeResponse("item-0", 1, false)]; // incorrect

      const res = selectPracticeMistakeFollowups({
        attempt,
        version,
        items,
        responses,
      });

      expect(res.status).toBe("available");
      if (res.status !== "available") return;
      expect(res.sourceMaterialId).toBeNull();
      expect(res.suggestions).toHaveLength(1);
    });

    it("returns no old suggestions on subsequent fresh call after erased attempt or erased version (no caching)", () => {
      const version = makeVersion();
      const attempt = makeAttempt({ totalQuestions: 1 });
      const items = [makeItem(0)];
      const responses = [makeResponse("item-0", 1, false)];

      // First call: available
      const res1 = selectPracticeMistakeFollowups({
        attempt,
        version,
        items,
        responses,
      });
      expect(res1.status).toBe("available");

      // Second call simulating erased attempt (null)
      const res2 = selectPracticeMistakeFollowups({
        attempt: null,
        version,
        items,
        responses,
      });
      expect(res2).toEqual({
        status: "unavailable",
        reason: "attempt_unavailable",
        suggestions: [],
      });

      // Third call simulating erased version (null) after available call
      const res3 = selectPracticeMistakeFollowups({
        attempt,
        version: null,
        items,
        responses,
      });
      expect(res3).toEqual({
        status: "unavailable",
        reason: "version_unavailable",
        suggestions: [],
      });
    });

    it("retains explicit frozen old version content, answers, options, and lineage while newer version exists; rejects mismatched combinations", () => {
      const oldVersion = makeVersion({
        id: "ver-old",
        versionNumber: 1,
        isActive: false,
        title: "Navigation Ground School v1",
        contentHash: "1".repeat(64),
        sourceMaterialTitle: "Navigation Fundamentals",
      });
      const currentVersion = makeVersion({
        id: "ver-current",
        versionNumber: 2,
        isActive: true,
        title: "Navigation Ground School v2",
        contentHash: "2".repeat(64),
        sourceMaterialTitle: "Navigation Fundamentals",
      });
      const oldItem = makeItem(0, {
        id: "item-old-0",
        versionId: "ver-old",
        questionText: "Old historical question text",
        options: ["Old Choice A", "Old Choice B", "Old Choice C", "Old Choice D"],
        correctIndex: 2,
        explanation: "Old historical explanation",
        sourcePage: 14,
        logicalId: "logic-nav-q1",
        origin: "instructor",
        replaces: null,
      });
      const currentItem = makeItem(0, {
        id: "item-curr-0",
        versionId: "ver-current",
        questionText: "Updated current question text",
        options: ["New Choice A", "New Choice B"],
        correctIndex: 0,
        explanation: "Updated explanation for v2",
        sourcePage: 28,
        logicalId: "logic-nav-q1",
        origin: "user",
        replaces: "item-old-0",
      });
      const oldAttempt = makeAttempt({
        id: "att-old-1",
        versionId: "ver-old",
        totalQuestions: 1,
        answeredCount: 1,
        incorrectCount: 1,
        correctCount: 0,
        scorePercent: 0,
      });
      const oldResponse = makeResponse("item-old-0", 1, false, "att-old-1", 2); // selected 1, correct is 2 -> incorrect

      deepFreeze(oldVersion);
      deepFreeze(currentVersion);
      deepFreeze(oldItem);
      deepFreeze(currentItem);
      deepFreeze(oldAttempt);
      deepFreeze(oldResponse);

      // 1. Old attempt paired with its own old version and old items preserves historical content
      const resOld = selectPracticeMistakeFollowups({
        attempt: oldAttempt,
        version: oldVersion,
        items: [oldItem],
        responses: [oldResponse],
      });

      expect(resOld.status).toBe("available");
      if (resOld.status !== "available") return;
      expect(resOld.suggestions).toHaveLength(1);

      const sug = resOld.suggestions[0]!;
      expect(sug.item.id).toBe("item-old-0");
      expect(sug.item.versionId).toBe("ver-old");
      expect(sug.item.questionText).toBe("Old historical question text");
      expect(sug.item.options).toEqual([
        "Old Choice A",
        "Old Choice B",
        "Old Choice C",
        "Old Choice D",
      ]);
      expect(sug.item.correctIndex).toBe(2);
      expect(sug.item.explanation).toBe("Old historical explanation");
      expect(sug.item.sourcePage).toBe(14);
      expect(sug.item.logicalId).toBe("logic-nav-q1");
      expect(sug.item.origin).toBe("instructor");
      expect(sug.item.replaces).toBeNull();
      expect(sug.response?.selectedIndex).toBe(1);
      expect(sug.outcome).toBe("incorrect");

      // Verify current version data was NEVER substituted
      expect(sug.item.questionText).not.toBe(currentItem.questionText);
      expect(sug.item.options).not.toEqual(currentItem.options);
      expect(sug.item.sourcePage).not.toBe(currentItem.sourcePage);
      expect(sug.item.versionId).not.toBe(currentVersion.id);
      expect(sug.item.id).not.toBe(currentItem.id);

      // 2. Reject old attempt with new version and new items (version mismatch)
      const resMismatch = selectPracticeMistakeFollowups({
        attempt: oldAttempt,
        version: currentVersion,
        items: [currentItem],
        responses: [oldResponse],
      });
      expect(resMismatch).toEqual({
        status: "unavailable",
        reason: "version_mismatch",
        suggestions: [],
      });

      // 3. Reject old pair (old attempt + old version) with new items (items_unavailable due to versionId)
      const resBadItems = selectPracticeMistakeFollowups({
        attempt: oldAttempt,
        version: oldVersion,
        items: [currentItem],
        responses: [oldResponse],
      });
      expect(resBadItems).toEqual({
        status: "unavailable",
        reason: "items_unavailable",
        suggestions: [],
      });

      // 4. Reject old pair with mixed items (items_unavailable)
      const resMixedItems = selectPracticeMistakeFollowups({
        attempt: oldAttempt,
        version: oldVersion,
        items: [oldItem, currentItem],
        responses: [oldResponse],
      });
      expect(resMixedItems).toEqual({
        status: "unavailable",
        reason: "items_unavailable",
        suggestions: [],
      });
    });
  });

  describe("foreign and contradictory responses", () => {
    it("ignores foreign attempt and foreign item responses; keeps item unanswered if only foreign response exists; proves frozen correctIndex wins over contradictory stored isCorrect", () => {
      const version = makeVersion();
      const attempt = makeAttempt({
        id: "att-1",
        totalQuestions: 3,
        answeredCount: 2,
        correctCount: 1,
        incorrectCount: 1,
        dontKnowCount: 0,
        scorePercent: 33,
      });
      const items = [
        makeItem(0, { id: "item-0", correctIndex: 0 }),
        makeItem(1, { id: "item-1", correctIndex: 1 }),
        makeItem(2, { id: "item-2", correctIndex: 0 }),
      ];

      const responses = [
        // 1. Foreign-only response for item-0 from other attempt (chose correct answer 0), with NO own response.
        // If foreign filter was broken, item-0 would be wrongly treated as correct and excluded.
        // Current attempt must ignore foreign response and keep item-0 unanswered/eligible.
        makeResponse("item-0", 0, false, "foreign-att-99", 0),

        // 2. Foreign item response for nonexistent/foreign item ID from att-1. Must be ignored.
        makeResponse("foreign-item-88", 0, false, "att-1", 0),

        // 3. Own response for item-1: selected 2 (wrong answer, correct is 1), but contradictory stored isCorrect: true.
        // Frozen correctIndex must win: classified as incorrect and remains eligible.
        makeResponse("item-1", 2, false, "att-1", 1, true),

        // 4. Own response for item-2: selected 0 (correct answer, correct is 0), but contradictory stored isCorrect: false.
        // Frozen correctIndex must win: classified as correct and excluded.
        makeResponse("item-2", 0, false, "att-1", 0, false),
      ];

      const res = selectPracticeMistakeFollowups({
        attempt,
        version,
        items,
        responses,
      });

      expect(res.status).toBe("available");
      if (res.status !== "available") return;

      // item-0 (unanswered) and item-1 (incorrect) are eligible; item-2 (correct) is excluded
      expect(res.totalEligibleCount).toBe(2);
      expect(res.remainingCount).toBe(0);
      expect(res.suggestions).toHaveLength(2);

      const [sug0, sug1] = res.suggestions;
      expect(sug0).toBeDefined();
      expect(sug1).toBeDefined();
      if (!sug0 || !sug1) return;

      // item-0: foreign response ignored, treated as unanswered
      expect(sug0.item.id).toBe("item-0");
      expect(sug0.outcome).toBe("unanswered");
      expect(sug0.number).toBe(1);
      expect(sug0.response).toBeNull();

      // item-1: wrong answer with contradictory isCorrect: true -> frozen correctIndex wins, outcome is incorrect
      expect(sug1.item.id).toBe("item-1");
      expect(sug1.outcome).toBe("incorrect");
      expect(sug1.number).toBe(2);
      expect(sug1.response?.selectedIndex).toBe(2);
    });

    it("treats empty responses array as all questions unanswered", () => {
      const version = makeVersion();
      const attempt = makeAttempt({
        totalQuestions: 2,
        answeredCount: 0,
        correctCount: 0,
        incorrectCount: 0,
        dontKnowCount: 0,
        scorePercent: 0,
      });
      const items = [makeItem(0), makeItem(1)];

      const res = selectPracticeMistakeFollowups({
        attempt,
        version,
        items,
        responses: [],
      });

      expect(res.status).toBe("available");
      if (res.status !== "available") return;
      expect(res.totalEligibleCount).toBe(2);
      expect(res.suggestions).toHaveLength(2);

      const [sug0, sug1] = res.suggestions;
      expect(sug0).toBeDefined();
      expect(sug1).toBeDefined();
      if (!sug0 || !sug1) return;

      expect(sug0.outcome).toBe("unanswered");
      expect(sug1.outcome).toBe("unanswered");
    });
  });

  describe("defensive validation: fails closed as unavailable", () => {
    const validVersion = makeVersion();
    const validAttempt = makeAttempt({ totalQuestions: 2 });
    const validItems = [makeItem(0), makeItem(1)];
    const validResponses: PracticeResponse[] = [];

    describe("attempt unavailable guards", () => {
      // Defensive invalid inputs to verify helper fails closed when runtime attempt data violates contracts
      it.each([
        ["null attempt", null],
        ["undefined attempt", undefined],
        ["non-completed attempt (in_progress)", makeAttempt({ status: "in_progress" })],
        ["non-completed attempt (abandoned)", makeAttempt({ status: "abandoned" })],
        ["null completedAt", makeAttempt({ completedAt: null })],
        ["empty completedAt", makeAttempt({ completedAt: "" })],
        ["negative totalQuestions", makeAttempt({ totalQuestions: -1 })],
        ["fractional totalQuestions", makeAttempt({ totalQuestions: 1.5 })],
        ["NaN totalQuestions", makeAttempt({ totalQuestions: Number.NaN })],
        ["Infinity totalQuestions", makeAttempt({ totalQuestions: Number.POSITIVE_INFINITY })],
        ["-Infinity totalQuestions", makeAttempt({ totalQuestions: Number.NEGATIVE_INFINITY })],
        ["empty id", makeAttempt({ id: "" })],
        ["empty versionId", makeAttempt({ versionId: "" })],
      ])("returns attempt_unavailable on %s", (_desc, badAttempt) => {
        const res = selectPracticeMistakeFollowups({
          attempt: badAttempt as unknown as PracticeAttempt,
          version: validVersion,
          items: validItems,
          responses: validResponses,
        });
        expect(res).toEqual({
          status: "unavailable",
          reason: "attempt_unavailable",
          suggestions: [],
        });
      });
    });

    describe("version unavailable guards", () => {
      // Defensive invalid inputs to verify helper fails closed when runtime version violates contracts
      it.each([
        ["null version", null],
        ["undefined version", undefined],
        ["empty id", makeVersion({ id: "" })],
        ["empty historyKey", makeVersion({ historyKey: "" })],
      ])("returns version_unavailable on %s", (_desc, badVersion) => {
        const res = selectPracticeMistakeFollowups({
          attempt: validAttempt,
          version: badVersion as unknown as PracticeTestVersion,
          items: validItems,
          responses: validResponses,
        });
        expect(res).toEqual({
          status: "unavailable",
          reason: "version_unavailable",
          suggestions: [],
        });
      });
    });

    describe("version mismatch guard", () => {
      it("returns version_mismatch when attempt.versionId !== version.id", () => {
        const mismatchVersion = makeVersion({ id: "ver-different" });
        const res = selectPracticeMistakeFollowups({
          attempt: validAttempt, // versionId: "ver-1"
          version: mismatchVersion,
          items: validItems,
          responses: validResponses,
        });
        expect(res).toEqual({
          status: "unavailable",
          reason: "version_mismatch",
          suggestions: [],
        });
      });
    });

    describe("items unavailable guards", () => {
      // Defensive invalid inputs to verify helper fails closed when runtime items violate contracts
      it.each([
        ["null items", null],
        ["undefined items", undefined],
        ["null item member inside items array", [makeItem(0), null]],
        ["undefined item member inside items array", [makeItem(0), undefined]],
        ["incomplete items length (1 vs 2 expected)", [makeItem(0)]],
        ["excess items length (3 vs 2 expected)", [makeItem(0), makeItem(1), makeItem(2)]],
        [
          "item version mismatch",
          [makeItem(0), makeItem(1, { versionId: "ver-other" })],
        ],
        [
          "duplicate item IDs",
          [makeItem(0, { id: "same-id" }), makeItem(1, { id: "same-id" })],
        ],
        [
          "null item id",
          [makeItem(0, { id: null as unknown as string }), makeItem(1)],
        ],
        [
          "empty item id",
          [makeItem(0, { id: "" }), makeItem(1)],
        ],
        [
          "negative ordinal",
          [makeItem(-1), makeItem(1)],
        ],
        [
          "fractional ordinal",
          [makeItem(0.5), makeItem(1)],
        ],
        [
          "out of range ordinal",
          [makeItem(0), makeItem(2)], // items.length is 2, ordinals must be 0 and 1
        ],
        [
          "duplicate ordinals",
          [makeItem(0, { id: "item-a" }), makeItem(0, { id: "item-b" })],
        ],
      ])("returns items_unavailable on %s", (_desc, badItems) => {
        const res = selectPracticeMistakeFollowups({
          attempt: validAttempt,
          version: validVersion,
          items: badItems as unknown as PracticeTestItem[],
          responses: validResponses,
        });
        expect(res).toEqual({
          status: "unavailable",
          reason: "items_unavailable",
          suggestions: [],
        });
      });
    });

    describe("responses unavailable guards", () => {
      // Defensive invalid inputs to verify helper fails closed when runtime responses violate contracts
      it.each([
        ["null responses", null],
        ["undefined responses", undefined],
        ["non-array responses", "not-an-array"],
      ])("returns responses_unavailable on %s", (_desc, badResponses) => {
        const res = selectPracticeMistakeFollowups({
          attempt: validAttempt,
          version: validVersion,
          items: validItems,
          responses: badResponses as unknown as PracticeResponse[],
        });
        expect(res).toEqual({
          status: "unavailable",
          reason: "responses_unavailable",
          suggestions: [],
        });
      });
    });
  });
});
