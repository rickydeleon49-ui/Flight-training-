import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

it.each([
  ["../layout/IosBackButton.tsx", "ios-back"],
  ["../../pages/StudyLibrary/StudyLibrary.tsx", "search-field__clear"],
  ["../../pages/StudyLibrary/FolderDialogs.tsx", "Folder actions"],
  ["../../pages/StudyLibrary/MaterialActionsMenu.tsx", "File actions"],
])("%s names its icon-only control", (file, marker) => {
  const s = src(file);
  const i = s.indexOf(marker);
  expect(i).toBeGreaterThan(-1);
  expect(s.slice(Math.max(0, i - 200), i + 300)).toContain("aria-label");
});
