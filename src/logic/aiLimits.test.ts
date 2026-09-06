import { describe, expect, it } from "vitest";

import {
  MAX_INLINE_BYTES,
  MAX_PDF_BYTES,
  MAX_TEXT_BYTES,
  checkFileForGemini,
  describeFileSize,
} from "./aiLimits";

const reason = (fileName: string, bytes: number | null): string => {
  const verdict = checkFileForGemini(fileName, bytes);
  return verdict.ready ? "" : verdict.reason;
};

describe("checkFileForGemini", () => {
  it("accepts a handbook inside Google's PDF limit", () => {
    expect(checkFileForGemini("phak.pdf", MAX_PDF_BYTES)).toEqual({ ready: true });
  });

  it("says what to do about a handbook over it", () => {
    const message = reason("phak.pdf", 62 * 1024 * 1024);
    expect(message).toContain("62 MB");
    expect(message).toContain("50 MB");
    expect(message).toContain("1,000 pages");
    expect(message).toContain("chapter");
  });

  it("does not hold an image to the PDF limit", () => {
    // Between the two limits: sending it is fine, refusing it would not be.
    expect(checkFileForGemini("chart.png", MAX_PDF_BYTES + 1)).toEqual({ ready: true });
    expect(checkFileForGemini("chart.png", MAX_INLINE_BYTES + 1).ready).toBe(false);
  });

  it("holds text to what the model can read at once", () => {
    expect(checkFileForGemini("notes.md", MAX_TEXT_BYTES)).toEqual({ ready: true });
    expect(reason("notes.md", MAX_TEXT_BYTES + 1)).toContain("hold in mind");
  });

  it("names the types Google reads when the file is not one of them", () => {
    expect(reason("syllabus.docx", 1024)).toContain("Convert this one to PDF");
  });

  it("judges the extension whatever case it is written in", () => {
    expect(checkFileForGemini("HANDBOOK.PDF", 1024)).toEqual({ ready: true });
    expect(checkFileForGemini("Chart.JPEG", 1024)).toEqual({ ready: true });
  });

  it("lets an older record with no stored size through on type alone", () => {
    expect(checkFileForGemini("phak.pdf", null)).toEqual({ ready: true });
    expect(checkFileForGemini("syllabus.rtf", null).ready).toBe(false);
  });
});

describe("describeFileSize", () => {
  it("rounds up to whole units so nothing reads as empty", () => {
    expect(describeFileSize(62 * 1024 * 1024)).toBe("62 MB");
    expect(describeFileSize(50 * 1024 * 1024)).toBe("50 MB");
    expect(describeFileSize(3 * 1024)).toBe("3 KB");
    expect(describeFileSize(1)).toBe("1 KB");
  });
});
