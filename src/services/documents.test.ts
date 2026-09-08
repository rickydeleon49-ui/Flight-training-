import { describe, expect, it } from "vitest";

import { documentErrorMessage } from "./documents";

describe("document desktop errors", () => {
  it("keeps string errors returned by the desktop shell", () => {
    expect(documentErrorMessage("No default PDF application is installed.", "fallback")).toBe(
      "No default PDF application is installed.",
    );
  });

  it("uses the fallback only when no useful detail was returned", () => {
    expect(documentErrorMessage(null, "That file could not be opened.")).toBe(
      "That file could not be opened.",
    );
  });
});
