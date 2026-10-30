import { describe, expect, it } from "vitest";

import { makeMaterial } from "@/testing/factories";
import type { CredentialRecord } from "@/domain/types";
import { checkAiSubmission, geminiSendDisclosure, geminiSendDisclosureParts } from "./aiSafety";

const record = (overrides: Partial<CredentialRecord> = {}): CredentialRecord => ({
  id: "rec-1",
  type: "medical",
  title: "Third-class medical",
  identifier: "",
  issuedOn: "2026-01-01",
  expiresOn: "2028-01-01",
  notes: "",
  materialId: null,
  ...overrides,
});

const withFile = (overrides = {}) =>
  makeMaterial({ filePath: "abc-notes.pdf", originalFileName: "notes.pdf", ...overrides });

describe("geminiSendDisclosureParts (POLISH-064)", () => {
  it("moves only what Google keeps into details; joined it reads exactly as before", () => {
    const parts = geminiSendDisclosureParts(withFile());
    expect(parts.message).toBe("Your copy on this Mac is not changed.");
    expect(parts.details).toContain("48 hours");
    expect(parts.details).toMatch(/^Only “notes\.pdf” leaves this Mac\. Google keeps/);
    expect(geminiSendDisclosure(withFile())).toBe(
      "Only “notes.pdf” leaves this Mac. Google keeps a temporary copy for up to 48 hours so a study guide and " +
        "a practice test can use it without uploading it again. Her Flight Deck asks Google to delete it sooner when " +
        "the file changes or you disconnect Gemini; otherwise Google removes it when it expires. Your copy on this Mac is not changed.",
    );
    expect(geminiSendDisclosureParts(withFile(), "Anthropic").details).toBeUndefined();
    expect(geminiSendDisclosureParts(withFile({ filePath: "a.txt", originalFileName: "a.txt" })).details).toBeUndefined();
  });
});

describe("checkAiSubmission", () => {
  it("allows ordinary study material, naming the file in the warning", () => {
    const result = checkAiSubmission(withFile(), []);
    expect(result.allowed).toBe(true);
    expect(result.reason).toContain("notes.pdf");
    expect(result.reason).toMatch(/Google/);
  });

  it("mentions reusing Google's copy only for PDFs, which Google keeps", () => {
    expect(checkAiSubmission(withFile(), []).reason).toContain(
      "if Google already has a copy from the last 48 hours, that copy is used instead",
    );
    const text = checkAiSubmission(
      withFile({ filePath: "abc-notes.txt", originalFileName: "notes.txt" }),
      [],
    ).reason;
    expect(text).toContain("will be sent to Google to generate the study aid.");
    expect(text).not.toContain("48 hours");
  });

  it("refuses a file attached to a certificate or medical record", () => {
    // The one click that must never be possible.
    const material = withFile({ id: "mat-1" });
    const result = checkAiSubmission(material, [record({ materialId: "mat-1" })]);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Third-class medical");
  });

  it("refuses anything filed as an administrative document", () => {
    const result = checkAiSubmission(withFile({ materialType: "admin_document" }), []);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Admin Document");
  });

  it("is not fooled by a record attached to some other material", () => {
    const material = withFile({ id: "mat-1" });
    const result = checkAiSubmission(material, [record({ materialId: "mat-2" })]);
    expect(result.allowed).toBe(true);
  });

  it("refuses a material with no file at all", () => {
    expect(checkAiSubmission(makeMaterial({ filePath: null }), []).allowed).toBe(false);
  });

  it("refuses on type even when the record link is absent", () => {
    expect(checkAiSubmission(withFile({ materialType: "admin_document" }), []).allowed).toBe(false);
  });
});
