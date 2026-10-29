export const MATERIAL_TABS = ["study", "notes", "more"] as const;
export type MaterialTab = typeof MATERIAL_TABS[number];

export function materialTabFrom(params: URLSearchParams): MaterialTab {
  const tab = params.get("tab");
  return tab === "notes" || tab === "more" ? tab : "study";
}

export function materialTabParams(params: URLSearchParams, tab: MaterialTab): URLSearchParams {
  const next = new URLSearchParams(params);
  if (tab === "study") next.delete("tab");
  else next.set("tab", tab);
  return next;
}

/** Search notes sit outside the panels; PDF provenance distinguishes kit sections. */
export function materialTabForAnchor(anchor: string, pdfProvenance = false): MaterialTab | null {
  if (anchor === "search-target-note") return null;
  if (pdfProvenance || anchor === "search-target-kit-cards" || anchor === "read-pdf-text" ||
      anchor === "related-study" || anchor.startsWith("material-file") ||
      anchor.startsWith("material-backup") || anchor.startsWith("material-mac") ||
      anchor.startsWith("material-offline") || anchor.startsWith("material-pdf-kit") ||
      anchor.startsWith("material-saved-pdf-kit")) return "more";
  return "study";
}
