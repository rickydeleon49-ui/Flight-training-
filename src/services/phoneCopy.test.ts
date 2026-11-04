import { expect, it } from "vitest";
import { faaPdfPrompt, materialFileNote, ratingKeyHint } from "./phoneCopy";

it("keeps the Mac wording and uses phone wording on the phone", () => {
  expect(materialFileNote(false)).toContain("desktop app’s private storage on this computer");
  expect(materialFileNote(true)).toBe("The file is copied into this app on your phone, so moving or deleting the original will not break this copy.");
  expect(faaPdfPrompt(false)).toBe("Choose a PDF from your computer.");
  expect(faaPdfPrompt(true)).toBe("Choose a PDF from Files.");
  expect(ratingKeyHint(false, false)).toBe("1–4 rate it.");
  expect(ratingKeyHint(false, true)).toBe("1–4 rate it (1: Again, 2: Hard, 3: Good, 4: Easy).");
  expect(ratingKeyHint(true, false)).toBeNull();
  expect(ratingKeyHint(true, true)).toBeNull();
});
