/** Shared by the Jump to chips; the Related study chip also opens its collapsed list. */
export function jumpToMaterialHeading(id: string, scrollOptions: ScrollIntoViewOptions = { block: "start" }) {
  const heading = document.getElementById(id);
  if (heading instanceof HTMLElement && heading.parentElement instanceof HTMLDetailsElement) heading.parentElement.open = true;
  // Guide text and card containers are not normally keyboard focus targets.
  if (heading && heading.tabIndex < 0) heading.tabIndex = -1;
  heading?.focus({ preventScroll: true });
  heading?.scrollIntoView?.(scrollOptions);
}
