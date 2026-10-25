/**
 * Shared validation and normalization for historical flight school snapshot on journal entries.
 *
 * Stored as a trimmed string up to 200 JS code units (UTF-16).
 * Null, undefined, or empty/whitespace-only input normalizes to null.
 * Rejects non-string types and strings exceeding 200 code units.
 */
export function validateSchoolName(rawSchoolName: unknown): string | null {
  if (rawSchoolName === null || rawSchoolName === undefined) {
    return null;
  }
  if (typeof rawSchoolName !== "string") {
    throw new Error("School name must be a string or null.");
  }
  const trimmed = rawSchoolName.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length > 200) {
    throw new Error("School name exceeds maximum length of 200 characters.");
  }
  return trimmed;
}
