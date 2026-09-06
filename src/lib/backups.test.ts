import { describe, expect, it } from "vitest";

import {
  backupErrorMessage,
  describeBackup,
  formatBackupDate,
  formatBytes,
} from "@/services/backups";

describe("backupErrorMessage", () => {
  it("keeps useful messages returned across the Tauri boundary", () => {
    expect(backupErrorMessage("That archive is damaged.", "Fallback")).toBe(
      "That archive is damaged.",
    );
    expect(backupErrorMessage(new Error("Disk full."), "Fallback")).toBe("Disk full.");
    expect(backupErrorMessage(null, "Fallback")).toBe("Fallback");
  });
});

describe("describeBackup", () => {
  it("explains an automatic copy taken before an update", () => {
    expect(describeBackup("2026-09-05-174233-before-0.2.0")).toBe(
      "Taken before updating to 0.2.0",
    );
  });

  it("explains a copy she asked for", () => {
    expect(describeBackup("2026-09-05-174233-manual")).toBe("Taken by you");
  });

  it("still reads a name that was disambiguated within the same second", () => {
    expect(describeBackup("2026-09-05-174233-2-before-0.2.0")).toBe(
      "Taken before updating to 0.2.0",
    );
  });

  it("recognizes the recovery copy made before a restore", () => {
    expect(describeBackup("2026-09-05-174233-before-restore")).toBe(
      "Saved before a restore",
    );
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

describe("formatBackupDate", () => {
  it("turns a stored Unix timestamp into a readable local date", () => {
    expect(formatBackupDate(0)).not.toContain("1970-01-01T00:00:00");
  });
});
