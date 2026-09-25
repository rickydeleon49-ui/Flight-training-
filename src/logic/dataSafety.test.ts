import { describe, expect, it } from "vitest";

import {
  BACKUP_REMINDER_DAYS,
  backupHealth,
  compareVersions,
  formatCompleteBackupSuccessNote,
  formatMissingDocumentsWarning,
  formatRestorePreviewMissingNotice,
  formatUnreferencedDocumentsNotice,
  isFromNewerVersion,
  resolveDocumentDisplayName,
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

describe("document warning formatting", () => {
  const materials = [
    { id: "1", title: "Weather Briefing", filePath: "docs/weather.pdf" },
    { id: "2", title: "Flight Maneuvers Manual", filePath: "maneuvers.pdf" },
    { id: "3", title: "Navigation Log", filePath: "nav.pdf" },
    { id: "4", title: "Checklist", filePath: "checklist.pdf" },
    { id: "5", title: "Weight and Balance", filePath: "wb.pdf" },
  ];

  it("resolves document display name by material title or filename fallback", () => {
    expect(resolveDocumentDisplayName("docs/weather.pdf", materials)).toBe("Weather Briefing");
    expect(resolveDocumentDisplayName("maneuvers.pdf", materials)).toBe("Flight Maneuvers Manual");
    expect(resolveDocumentDisplayName("unlinked/notes.pdf", materials)).toBe("notes.pdf");
    expect(resolveDocumentDisplayName("standalone.pdf")).toBe("standalone.pdf");
  });

  it("formats 1 missing document warning with correct verb and singular pronoun", () => {
    const warning = formatMissingDocumentsWarning(["docs/weather.pdf"], materials);
    expect(warning).toBe(
      '1 study file was missing from app storage and wasn\'t included: "Weather Briefing". You can re-attach it in the Study Library.',
    );
  });

  it("formats 2 missing documents warning with plural verbs and list", () => {
    const warning = formatMissingDocumentsWarning(
      ["docs/weather.pdf", "maneuvers.pdf"],
      materials,
    );
    expect(warning).toBe(
      '2 study files were missing from app storage and weren\'t included: "Weather Briefing" and "Flight Maneuvers Manual". You can re-attach them in the Study Library.',
    );
  });

  it("formats 3 missing documents warning with Oxford comma list", () => {
    const warning = formatMissingDocumentsWarning(
      ["docs/weather.pdf", "maneuvers.pdf", "nav.pdf"],
      materials,
    );
    expect(warning).toBe(
      '3 study files were missing from app storage and weren\'t included: "Weather Briefing", "Flight Maneuvers Manual", and "Navigation Log". You can re-attach them in the Study Library.',
    );
  });

  it("formats 5 missing documents warning with and N more truncation", () => {
    const warning = formatMissingDocumentsWarning(
      ["docs/weather.pdf", "maneuvers.pdf", "nav.pdf", "checklist.pdf", "wb.pdf"],
      materials,
    );
    expect(warning).toBe(
      '5 study files were missing from app storage and weren\'t included: "Weather Briefing", "Flight Maneuvers Manual", "Navigation Log", and 2 more. You can re-attach them in the Study Library.',
    );
  });

  it("formats unreferenced documents notice plainly", () => {
    expect(formatUnreferencedDocumentsNotice([])).toBe("");
    expect(formatUnreferencedDocumentsNotice(["orphan.pdf"])).toBe(
      "1 file in storage isn't linked to any material and was left out.",
    );
    expect(formatUnreferencedDocumentsNotice(["orphan1.pdf", "orphan2.pdf"])).toBe(
      "2 files in storage aren't linked to any material and were left out.",
    );
  });

  it("composes complete backup success note with warnings when present", () => {
    const formatBytes = (b: number) => `${b} B`;
    const clean = formatCompleteBackupSuccessNote(
      { files: 5, bytes: 1000 },
      formatBytes,
      materials,
    );
    expect(clean.hasWarnings).toBe(false);
    expect(clean.message).toBe("Complete backup saved — 5 files, 1000 B protected.");

    const withWarnings = formatCompleteBackupSuccessNote(
      {
        files: 4,
        bytes: 800,
        missingDocuments: ["docs/weather.pdf"],
        unreferencedDocuments: ["orphan.pdf"],
      },
      formatBytes,
      materials,
    );
    expect(withWarnings.hasWarnings).toBe(true);
    expect(withWarnings.message).toContain("Complete backup saved — 4 files, 800 B protected.");
    expect(withWarnings.message).toContain(
      '1 study file was missing from app storage and wasn\'t included: "Weather Briefing". You can re-attach it in the Study Library.',
    );
    expect(withWarnings.message).toContain(
      "1 file in storage isn't linked to any material and was left out.",
    );
  });

  it("formats restore preview missing notice for inspect and preview dialogs", () => {
    expect(formatRestorePreviewMissingNotice(0)).toBe("");
    expect(formatRestorePreviewMissingNotice(1)).toBe(
      "This backup lists 1 file that was already missing when it was made.",
    );
    expect(formatRestorePreviewMissingNotice(3)).toBe(
      "This backup lists 3 files that were already missing when it was made.",
    );
  });
});
