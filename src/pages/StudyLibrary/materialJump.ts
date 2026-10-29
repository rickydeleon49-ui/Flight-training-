/** Shared by the existing Jump to controls and Related study. */
export function jumpToMaterialHeading(id: string) {
  const heading = document.getElementById(id);
  heading?.focus({ preventScroll: true });
  heading?.scrollIntoView?.({ block: "start" });
}
