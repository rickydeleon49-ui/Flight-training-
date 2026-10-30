import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { describeReadiness, fewTextSentence, MAX_OFFLINE_INPUT_BYTES } from "./offlineReadiness";

describe("describeReadiness", () => {
  it("states exact counts when everything is searchable", () => {
    const w = describeReadiness({ state: "searchable", pages: 524 });
    expect(w.label).toBe("Text read");
    expect(w.detail).toBe("Text read on this Mac: all 524 pages.");
    expect(w.tone).toBe("complete");
  });

  it("names image pages only when that is the known reason", () => {
    const w = describeReadiness({ state: "partial", searchable: 41, pages: 50, imagePages: 9, reason: "imagePages" });
    expect(w.label).toBe("Partly read");
    expect(w.detail).toBe(
      "Text read on 41 of 50 pages. 9 pages are images; text recognition would be needed to search them.",
    );
    expect(w.detail).not.toMatch(/scan/i);
  });

  it("uses neutral wording when the cause is unknown", () => {
    const w = describeReadiness({ state: "partial", searchable: 497, pages: 524, imagePages: 1, reason: "someUnreadable" });
    expect(w.detail).toBe("Text read on 497 of 524 pages. Some pages couldn't be read.");
    expect(w.detail).not.toMatch(/scan|image/i);
  });

  it("handles singular counts", () => {
    expect(describeReadiness({ state: "searchable", pages: 1 }).detail).toBe("Text read on this Mac: all 1 page.");
    expect(
      describeReadiness({ state: "partial", searchable: 0, pages: 1, imagePages: 1, reason: "imagePages" }).detail,
    ).toContain("1 page is an image; text recognition would be needed to search it.");
    expect(
      describeReadiness({ state: "partial", searchable: 0, pages: 1, imagePages: 1, reason: "imagePages" }).detail,
    ).toContain("Text read on 0 of 1 page.");
  });

  describe("pages that look like pictures of text (SCANNED-01)", () => {
    it("adds nothing when no page has too little text", () => {
      for (const few of [undefined, 0]) {
        expect(describeReadiness({ state: "searchable", pages: 40, fewTextPages: few }).detail).toBe(
          "Text read on this Mac: all 40 pages.",
        );
        expect(
          describeReadiness({ state: "partial", searchable: 41, pages: 50, imagePages: 9, reason: "imagePages", fewTextPages: few })
            .detail,
        ).toBe("Text read on 41 of 50 pages. 9 pages are images; text recognition would be needed to search them.");
      }
      expect(fewTextSentence(0, 40)).toBe("");
      expect(fewTextSentence(3, 0)).toBe("");
    });

    it("adds one plain sentence when some pages have too little text", () => {
      expect(describeReadiness({ state: "searchable", pages: 40, fewTextPages: 3 }).detail).toBe(
        "Text read on this Mac: all 40 pages. 3 of 40 pages have little or no readable text (often a blank page or a picture of text), so search and quotes can't use them.",
      );
      expect(
        describeReadiness({ state: "partial", searchable: 497, pages: 524, imagePages: 0, reason: "someUnreadable", fewTextPages: 2 })
          .detail,
      ).toBe(
        "Text read on 497 of 524 pages. Some pages couldn't be read. 2 of 524 pages have little or no readable text (often a blank page or a picture of text), so search and quotes can't use them.",
      );
    });

    it("uses singular wording for one page", () => {
      expect(fewTextSentence(1, 40)).toBe(" 1 of 40 pages has little or no readable text (often a blank page or a picture of text), so search and quotes can't use it.");
      expect(fewTextSentence(1, 1)).toBe(" 1 of 1 page has little or no readable text (often a blank page or a picture of text), so search and quotes can't use it.");
    });

    it("says all when every page has too little text", () => {
      expect(describeReadiness({ state: "searchable", pages: 12, fewTextPages: 12 }).detail).toBe(
        "Text read on this Mac: all 12 pages. All 12 pages have little or no readable text (often a blank page or a picture of text), so search and quotes can't use them.",
      );
      expect(fewTextSentence(99, 12)).toContain("All 12 pages");
    });

    it("never calls a page scanned", () => {
      expect(fewTextSentence(3, 40)).not.toMatch(/scan/i);
    });
  });

  it("offers reading only when the file is verified and not yet prepared", () => {
    const states = [
      { state: "unsupported" },
      { state: "missing" },
      { state: "checking" },
      { state: "notPrepared" },
      { state: "preparing" },
      { state: "searchable", pages: 3 },
      { state: "couldNotProcess", code: "malformed" },
    ] as const;
    const offered = states.filter((s) => describeReadiness(s).canPrepare).map((s) => s.state);
    expect(offered).toEqual(["notPrepared"]);
    expect(describeReadiness({ state: "notPrepared" }).label).toBe("Not read yet");
  });

  it("says plainly that reading stays on this Mac", () => {
    expect(describeReadiness({ state: "notPrepared" }).detail).toBe(
      "This PDF isn't ready to search on your Mac yet. Choose “Read it now” below once, then you can search its text without internet. Nothing is sent anywhere.",
    );
  });

  it("explains known refusals and keeps unknown codes generic and private", () => {
    const encrypted = describeReadiness({ state: "couldNotProcess", code: "encrypted" });
    expect(encrypted.label).toBe("Could not read");
    expect(encrypted.detail).toMatch(/password-protected/);
    expect(describeReadiness({ state: "couldNotProcess", code: "memory_limit" }).detail).toMatch(/splitting it into chapters/);
    const unknown = describeReadiness({ state: "couldNotProcess", code: "worker_failed:exit" }).detail;
    expect(unknown).toMatch(/couldn't be read/);
    expect(unknown).not.toContain("worker_failed");
  });

  it("marks only checking and preparing as settling", () => {
    expect(describeReadiness({ state: "checking" }).settling).toBe(true);
    const preparing = describeReadiness({ state: "preparing" });
    expect(preparing.settling).toBe(true);
    expect(preparing.label).toBe("Reading text…");
    expect(describeReadiness({ state: "notPrepared" }).settling).toBe(false);
  });

  it("ensures old phrases no longer appear in describeReadiness", () => {
    const allStates = [
      { state: "unsupported" as const },
      { state: "missing" as const },
      { state: "checking" as const },
      { state: "notPrepared" as const },
      { state: "preparing" as const },
      { state: "searchable" as const, pages: 10 },
      { state: "partial" as const, searchable: 5, pages: 10, imagePages: 5, reason: "imagePages" as const },
      { state: "couldNotProcess" as const, code: "encrypted" },
      { state: "couldNotProcess" as const, code: "malformed" },
      { state: "couldNotProcess" as const, code: "input_too_large" },
      { state: "couldNotProcess" as const, code: "memory_limit" },
    ];
    const oldPhrases = [
      "Not prepared",
      "Searchable",
      "Preparing search",
      "Partly searchable",
      "Could not prepare",
      "Prepare for offline study",
      "Offline study",
    ];
    for (const s of allStates) {
      const desc = describeReadiness(s);
      for (const phrase of oldPhrases) {
        expect(desc.label).not.toBe(phrase);
        expect(desc.detail).not.toContain(phrase);
      }
    }
  });

  it("keeps MAX_OFFLINE_INPUT_BYTES equal to native MAX_INPUT_BYTES in worker.rs", () => {
    const workerRs = readFileSync("src-tauri/src/extraction/worker.rs", "utf8");
    const match = workerRs.match(/pub\s+const\s+MAX_INPUT_BYTES:\s*u64\s*=\s*(\d+)\s*\*\s*(\d+)\s*\*\s*(\d+);/);
    expect(match).toBeTruthy();
    const nativeBytes = Number(match![1]) * Number(match![2]) * Number(match![3]);
    expect(nativeBytes).toBe(MAX_OFFLINE_INPUT_BYTES);
    expect(MAX_OFFLINE_INPUT_BYTES).toBe(128 * 1024 * 1024);
  });
});
