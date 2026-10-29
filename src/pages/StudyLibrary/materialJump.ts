/** Shared by the existing Jump to controls and Related study. */
export function jumpToMaterialHeading(id: string) {
  const heading =
    document.getElementById(id) ?? (id === "material-guide-heading" ? document.getElementById("material-saved-pdf-kit") : null);
  // The Related study chip opens its collapsed list.
  if (heading instanceof HTMLElement && heading.parentElement instanceof HTMLDetailsElement) heading.parentElement.open = true;
  heading?.focus({ preventScroll: true });
  heading?.scrollIntoView?.({ block: "start" });
}
