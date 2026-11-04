/** Wording that differs on the phone. The Mac text stays exactly as it was. */

export const MATERIAL_FILE_NOTE_MAC =
  "The file is copied into the desktop app’s private storage on this computer, so moving or deleting the original will not break this copy. Include it in a complete backup before moving to another computer.";
export const MATERIAL_FILE_NOTE_PHONE =
  "The file is copied into this app on your phone, so moving or deleting the original will not break this copy.";

export function materialFileNote(ios: boolean): string {
  return ios ? MATERIAL_FILE_NOTE_PHONE : MATERIAL_FILE_NOTE_MAC;
}

export function faaPdfPrompt(ios: boolean): string {
  return ios ? "Choose a PDF from Files." : "Choose a PDF from your computer.";
}

/** The keyboard hint, or null where there is no keyboard (the phone). */
export function ratingKeyHint(ios: boolean, detailed: boolean): string | null {
  if (ios) return null;
  return detailed ? "1–4 rate it (1: Again, 2: Hard, 3: Good, 4: Easy)." : "1–4 rate it.";
}
