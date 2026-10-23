import { describe, expect, it } from "vitest";

import { pdfAskContext } from "./pdfAskContext";

describe("pdfAskContext", () => {
  it("keeps the 8,000-code-point budget without leaving a lone surrogate", () => {
    const context = pdfAskContext("A", "🛩".repeat(5000));
    const points = Array.from(context);
    expect(points.length).toBeLessThanOrEqual(8000);
    expect(context).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    expect(() => JSON.parse(JSON.stringify(context))).not.toThrow();
  });
});
