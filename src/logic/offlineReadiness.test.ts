import { describe, expect, it } from "vitest";

import { describeReadiness } from "./offlineReadiness";

describe("describeReadiness", () => {
  it("states exact counts when everything is searchable", () => {
    const w = describeReadiness({ state: "searchable", pages: 524 });
    expect(w.label).toBe("Searchable");
    expect(w.detail).toBe("Ready for offline search: all 524 pages.");
    expect(w.tone).toBe("complete");
  });

  it("names image pages only when that is the known reason", () => {
    const w = describeReadiness({ state: "partial", searchable: 41, pages: 50, imagePages: 9, reason: "imagePages" });
    expect(w.detail).toBe(
      "Ready for offline search on 41 of 50 pages. 9 pages are images; text recognition would be needed to search them.",
    );
    expect(w.detail).not.toMatch(/scan/i);
  });

  it("uses neutral wording when the cause is unknown", () => {
    const w = describeReadiness({ state: "partial", searchable: 497, pages: 524, imagePages: 1, reason: "someUnreadable" });
    expect(w.detail).toBe("Ready for offline search on 497 of 524 pages. Some pages couldn't be read.");
    expect(w.detail).not.toMatch(/scan|image/i);
  });

  it("handles singular counts", () => {
    expect(describeReadiness({ state: "searchable", pages: 1 }).detail).toBe("Ready for offline search: all 1 page.");
    expect(
      describeReadiness({ state: "partial", searchable: 0, pages: 1, imagePages: 1, reason: "imagePages" }).detail,
    ).toContain("1 page is an image; text recognition would be needed to search it.");
  });

  it("offers preparation only when the file is verified and not yet prepared", () => {
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
  });

  it("says plainly that preparing stays on this Mac", () => {
    expect(describeReadiness({ state: "notPrepared" }).detail).toMatch(/nothing is sent anywhere/);
  });

  it("explains known refusals and keeps unknown codes generic and private", () => {
    expect(describeReadiness({ state: "couldNotProcess", code: "encrypted" }).detail).toMatch(/password-protected/);
    expect(describeReadiness({ state: "couldNotProcess", code: "memory_limit" }).detail).toMatch(/splitting it into chapters/);
    const unknown = describeReadiness({ state: "couldNotProcess", code: "worker_failed:exit" }).detail;
    expect(unknown).toMatch(/couldn't be read/);
    expect(unknown).not.toContain("worker_failed");
  });

  it("marks only checking and preparing as settling", () => {
    expect(describeReadiness({ state: "checking" }).settling).toBe(true);
    expect(describeReadiness({ state: "preparing" }).settling).toBe(true);
    expect(describeReadiness({ state: "notPrepared" }).settling).toBe(false);
  });
});
