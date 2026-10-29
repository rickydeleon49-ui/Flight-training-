import { expect, it } from "vitest";
import { materialTabFrom, materialTabParams, materialTabForAnchor } from "./materialTabs";
it("defaults to Study, including unknown values", () => {
  for (const query of ["", "tab=study", "tab=unknown"]) expect(materialTabFrom(new URLSearchParams(query))).toBe("study");
  for (const tab of ["notes", "more"] as const) expect(materialTabFrom(new URLSearchParams(`tab=${tab}`))).toBe(tab);
});
it("serializes without writing Study and preserves other parameters", () => {
  const before = new URLSearchParams("card=1&rev=abc&tab=notes");
  expect(materialTabParams(before, "study").toString()).toBe("card=1&rev=abc");
  expect(materialTabParams(before, "more").toString()).toBe("card=1&rev=abc&tab=more");
  expect(before.get("tab")).toBe("notes");
});
it("maps anchors to their mounted panel, leaving the search note outside", () => {
  for (const id of ["search-target-summary", "search-target-guide-2", "search-target-cards"]) expect(materialTabForAnchor(id)).toBe("study");
  for (const id of ["search-target-kit-cards", "read-pdf-text", "material-file-actions", "material-backup-heading", "related-study"]) expect(materialTabForAnchor(id)).toBe("more");
  expect(materialTabForAnchor("search-target-guide-2", true)).toBe("more");
  expect(materialTabForAnchor("search-target-note")).toBeNull();
});
