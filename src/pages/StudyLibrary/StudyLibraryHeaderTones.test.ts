import { describe, expect, it } from "vitest";
import { reviewStatusTone } from "./StudyLibrary";

describe("reviewStatusTone", () => {
  it("maps each review status to an existing badge tone", () => {
    expect(reviewStatusTone("confident")).toBe("complete");
    expect(reviewStatusTone("studying")).toBe("study");
    expect(reviewStatusTone("needs_review")).toBe("due");
    expect(reviewStatusTone("reference_only")).toBe("neutral");
    expect(reviewStatusTone("something_else")).toBe("neutral");
  });
});
