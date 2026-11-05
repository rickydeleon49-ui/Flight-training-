import { expect, it } from "vitest";

import { backTarget } from "./iosBack";

it.each([
  ["/study/history", "/study", "Study"],
  ["/study/history/k1", "/study/history", "History"],
  ["/study/history/k1/a2", "/study/history/k1", "Attempts"],
  ["/study/homework", "/study", "Study"],
  ["/study/homework/h1", "/study", "Study"],
  ["/study/m-1", "/study", "Study"],
  ["/schedule/s1", "/schedule", "Schedule"],
  ["/journal/new", "/journal", "Log"],
  ["/journal/j1", "/journal", "Log"],
  ["/journal/j1/edit", "/journal/j1", "Entry"],
  ["/flight-path", "/more", "More"],
  ["/questions", "/more", "More"],
  ["/notes", "/more", "More"],
  ["/finances", "/more", "More"],
  ["/toolkit", "/more", "More"],
  ["/settings", "/more", "More"],
  ["/flight-path/skills/s1", "/flight-path", "Flight Path"],
  ["/study/m-1/", "/study", "Study"],
])("%s goes back to %s as %s", (path, to, label) => {
  expect(backTarget(path)).toEqual({ to, label });
});

it.each(["/", "/study", "/schedule", "/journal", "/more", "/nowhere", "/study/", "/a/b/c/d"])(
  "%s has no back button",
  (path) => expect(backTarget(path)).toBeNull(),
);
