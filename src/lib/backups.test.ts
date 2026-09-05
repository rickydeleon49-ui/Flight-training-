import { describe, expect, it } from "vitest";

import { describeBackup, formatBytes } from "@/services/backups";

describe("describeBackup", () => {
  it("explains an automatic copy taken before an update", () => {
    expect(describeBackup("2026-09-05-174233-before-0.2.0")).toBe(
      "Taken before updating to 0.2.0",
    );
  });

  it("explains a copy she asked for", () => {
    expect(describeBackup("2026-09-05-174233-manual")).toBe("Taken by you");
  });

  it("falls back to something readable for anything else", () => {
    expect(describeBackup("something-else")).toBe("Database copy");
  });
});

describe("formatBytes", () => {
  it("scales the unit to the size", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
