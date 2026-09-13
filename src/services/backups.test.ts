import { describe, expect, it } from "vitest";

import { dataDirectory, revealFolder } from "./backups";

describe("data directory outside the desktop shell", () => {
  it("reports no path rather than failing", async () => {
    expect(await dataDirectory()).toBe("");
  });

  it("refuses to reveal a folder without the desktop application", async () => {
    await expect(revealFolder("/some/path")).rejects.toThrow(
      "This needs the desktop application.",
    );
  });
});
