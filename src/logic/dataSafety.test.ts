import { describe, expect, it } from "vitest";

import {
  BACKUP_REMINDER_DAYS,
  backupHealth,
  compareVersions,
  isFromNewerVersion,
  restoreWarning,
} from "./dataSafety";

const at = (iso: string) => new Date(iso);

describe("compareVersions", () => {
  it("orders releases numerically, not alphabetically", () => {
    expect(compareVersions("0.10.0", "0.9.0")).toBeGreaterThan(0);
    expect(compareVersions("0.2.0", "0.10.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
  });

  it("treats an unreadable version as equal rather than newer", () => {
    expect(compareVersions("", "0.2.0")).toBeLessThan(0);
    expect(compareVersions("unknown", "0.0.0")).toBe(0);
  });
});

describe("isFromNewerVersion", () => {
  it("recognizes a backup written by a later release", () => {
    expect(isFromNewerVersion("0.3.0", "0.2.0")).toBe(true);
    expect(isFromNewerVersion("0.2.0", "0.2.0")).toBe(false);
    expect(isFromNewerVersion("0.1.0", "0.2.0")).toBe(false);
  });
});

describe("restoreWarning", () => {
  it("stops her restoring a newer record into an older app unwarned", () => {
    const warning = restoreWarning("0.3.0", "0.2.0");
    expect(warning).toContain("0.3.0");
    expect(warning).toContain("newer");
  });

  it("says nothing about a backup from this version or an earlier one", () => {
    expect(restoreWarning("0.2.0", "0.2.0")).toBeNull();
    expect(restoreWarning("0.1.0", "0.2.0")).toBeNull();
  });
});

describe("backupHealth", () => {
  const now = at("2026-09-06T12:00:00.000Z");

  it("asks for a first backup when none has ever been saved", () => {
    const health = backupHealth({
      lastBackupAt: null,
      lastBackupVersion: null,
      appVersion: "0.2.0",
      now,
    });
    expect(health.state).toBe("never");
    expect(health.needsAttention).toBe(true);
  });

  it("treats an unreadable stored date as no backup at all", () => {
    const health = backupHealth({
      lastBackupAt: "not a date",
      lastBackupVersion: "0.2.0",
      appVersion: "0.2.0",
      now,
    });
    expect(health.state).toBe("never");
  });

  it("is satisfied by a recent backup from this version", () => {
    const health = backupHealth({
      lastBackupAt: "2026-09-04T09:00:00.000Z",
      lastBackupVersion: "0.2.0",
      appVersion: "0.2.0",
      now,
    });
    expect(health.state).toBe("protected");
    expect(health.needsAttention).toBe(false);
    expect(health.message).toContain("2 days ago");
  });

  it("asks for a new backup after an update, however recent the old one is", () => {
    // The exact case she was promised protection from: an update arrived, and
    // the newest backup she has predates it.
    const health = backupHealth({
      lastBackupAt: "2026-09-06T09:00:00.000Z",
      lastBackupVersion: "0.2.0",
      appVersion: "0.3.0",
      now,
    });
    expect(health.state).toBe("after-update");
    expect(health.needsAttention).toBe(true);
    expect(health.message).toContain("0.3.0");
  });

  it("asks again once a backup has gone stale", () => {
    const stale = new Date(now.getTime() - (BACKUP_REMINDER_DAYS + 1) * 86_400_000);
    const health = backupHealth({
      lastBackupAt: stale.toISOString(),
      lastBackupVersion: "0.2.0",
      appVersion: "0.2.0",
      now,
    });
    expect(health.state).toBe("stale");
    expect(health.needsAttention).toBe(true);
  });

  it("does not nag the day before it is due", () => {
    const almost = new Date(now.getTime() - (BACKUP_REMINDER_DAYS - 1) * 86_400_000);
    const health = backupHealth({
      lastBackupAt: almost.toISOString(),
      lastBackupVersion: "0.2.0",
      appVersion: "0.2.0",
      now,
    });
    expect(health.state).toBe("protected");
  });
});
