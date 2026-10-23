/** Compare search text without changing the saved text or displayed titles. */
export function searchText(value: string): string {
  return value.toLowerCase().replace(/[–—−]/g, "-");
}
