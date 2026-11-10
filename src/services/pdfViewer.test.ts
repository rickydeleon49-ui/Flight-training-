import { afterEach, expect, it, vi } from "vitest";
import * as platform from "./platform";
import { openedPageMessage } from "./pdfViewer";

afterEach(() => vi.restoreAllMocks());
it("uses page success words on iOS and preserves desktop guidance verbatim", () => {
  vi.spyOn(platform, "isIOS").mockReturnValue(true);
  expect(openedPageMessage(9, "Go to page 9 in your reader.")).toBe("Opened at PDF page 9.");
  vi.mocked(platform.isIOS).mockReturnValue(false);
  expect(openedPageMessage(9, "Go to page 9 in your reader.")).toBe("Go to page 9 in your reader.");
  expect(openedPageMessage(9, "")).toBe("");
});
