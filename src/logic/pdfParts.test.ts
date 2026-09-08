import { describe, expect, it } from "vitest";

import { pdfPartNotes, pdfPartTitle } from "./pdfParts";

describe("automatic PDF part labels", () => {
  it("labels every item with its position in the complete set", () => {
    expect(pdfPartTitle("Pilot Handbook", 0, 6)).toBe("Pilot Handbook — Part 1 of 6");
    expect(pdfPartTitle("Pilot Handbook", 5, 6)).toBe("Pilot Handbook — Part 6 of 6");
  });

  it("keeps the source page range with each part", () => {
    expect(pdfPartNotes("Pilot Handbook", { firstPage: 101, lastPage: 184 })).toBe(
      "Pages 101–184 of Pilot Handbook.",
    );
  });
});
