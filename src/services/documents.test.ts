import { describe, expect, it } from "vitest";

import { cleanupDocuments, documentErrorMessage } from "./documents";

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

describe("generated document cleanup", () => {
  it("attempts every file and reports each one that remains", async () => {
    const attempted: string[] = [];
    const failed = await cleanupDocuments(["one.pdf", "two.pdf", "three.pdf"], async (path) => {
      attempted.push(path);
      if (path !== "two.pdf") throw new Error("injected delete failure");
    });

    expect(attempted).toEqual(["one.pdf", "two.pdf", "three.pdf"]);
    expect(failed).toEqual(["one.pdf", "three.pdf"]);
  });
});
