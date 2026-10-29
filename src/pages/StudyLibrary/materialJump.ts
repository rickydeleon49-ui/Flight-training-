/** Shared by the Jump to chips; the Related study chip also opens its collapsed list. */
export function jumpToMaterialHeading(id: string) {
  const heading = document.getElementById(id);
  if (heading instanceof HTMLElement && heading.parentElement instanceof HTMLDetailsElement) heading.parentElement.open = true;
  heading?.focus({ preventScroll: true });
  heading?.scrollIntoView?.({ block: "start" });
}
