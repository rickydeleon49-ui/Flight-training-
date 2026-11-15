// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { jumpToMaterialHeading } from "./materialJump";

afterEach(() => { document.body.innerHTML = ""; });

it("opens the folded Oral questions card so the jump lands on it", () => {
  document.body.innerHTML = `<div id="material-oral"><div><details class="material-fold"><summary>Practice an oral question</summary></details></div></div>`;
  jumpToMaterialHeading("material-oral");
  expect(document.querySelector("details")?.open).toBe(true);
});
