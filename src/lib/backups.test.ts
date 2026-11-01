import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  backupErrorMessage,
  backupLocalDay,
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

function inTimeZone(zone: string) {
  let hadTz = false;
  let originalTz: string | undefined;
  beforeAll(() => {
    hadTz = "TZ" in process.env;
    originalTz = process.env.TZ;
    process.env.TZ = zone;
  });
  afterAll(() => {
    if (hadTz) process.env.TZ = originalTz;
    else delete process.env.TZ;
  });
}

describe("backupLocalDay in Los Angeles", () => {
  inTimeZone("America/Los_Angeles");

  it("reads a copy made on a California evening as that evening's day, not the UTC day", () => {
    expect(backupLocalDay("2026-10-16-035630-manual", "2026-10-15")).toBe(
      "Thursday, October 15",
    );
    expect(backupLocalDay("2026-10-16-035630-before-restore", "2026-10-15")).toBe(
      "Thursday, October 15",
    );
  });

  it("changes day at local midnight (07:00Z in daylight time)", () => {
    expect(backupLocalDay("2026-10-16-065959-manual", "2026-10-16")).toBe(
      "Thursday, October 15",
    );
    expect(backupLocalDay("2026-10-16-070000-manual", "2026-10-16")).toBe(
      "Friday, October 16",
    );
  });

  it("reads names disambiguated within the same second and upgrade copies", () => {
    expect(backupLocalDay("2026-10-16-035630-2-before-0.5.4", "2026-10-15")).toBe(
      "Thursday, October 15",
    );
    expect(
      backupLocalDay("2026-10-16-035630-1792115790-before-restore", "2026-10-15"),
    ).toBe("Thursday, October 15");
  });

  it("adds the year when it is not the current one", () => {
    expect(backupLocalDay("2025-01-01-050000-manual", "2026-10-15")).toBe(
      "Tuesday, December 31, 2024",
    );
  });

  it("returns null for names without a readable time", () => {
    for (const name of [
      "",
      "something-else",
      "before-restore-test",
      "2026-13-01-120000-manual",
      "2026-02-30-120000-manual",
      "2026-10-16-250000-manual",
      "2026-10-16-12000-manual",
      "2026-10-16manual",
    ]) {
      expect(backupLocalDay(name, "2026-10-15")).toBeNull();
    }
  });
});

describe("backupLocalDay in Kiritimati", () => {
  inTimeZone("Pacific/Kiritimati");

  it("moves a UTC morning copy to the next local day", () => {
    expect(backupLocalDay("2026-10-15-095959-manual", "2026-10-15")).toBe(
      "Thursday, October 15",
    );
    expect(backupLocalDay("2026-10-15-100000-manual", "2026-10-16")).toBe(
      "Friday, October 16",
    );
  });
});

describe("backupLocalDay in UTC", () => {
  inTimeZone("UTC");

  it("keeps the named day", () => {
    expect(backupLocalDay("2026-10-16-035630-manual", "2026-10-16")).toBe(
      "Friday, October 16",
    );
  });
});

it.each([
  "Could not create the backup file: Read-only file system (os error 30)",
  new Error("Permission denied (os error 13)"),
  {message:"Access is denied. (os error 5)"},
])("replaces OS write details with a folder suggestion: %s", error => {
  expect(backupErrorMessage(error, "Fallback")).toBe("That folder can't be saved to. Choose another folder, like Documents.");
});

it("keeps folder-opening errors outside the backup write mapping", () => {
  expect(backupErrorMessage("Could not open /tmp/hfd: permission denied", "Fallback", false)).toBe("Could not open /tmp/hfd: permission denied");
});
