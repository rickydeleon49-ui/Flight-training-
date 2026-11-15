/** Shared by the Jump to chips; the Related study chip also opens its collapsed list. */
export function jumpToMaterialHeading(id: string, scrollOptions: ScrollIntoViewOptions = { block: "start" }) {
  const heading = document.getElementById(id);
  if (heading instanceof HTMLElement && heading.parentElement instanceof HTMLDetailsElement) heading.parentElement.open = true;
  // The empty Oral questions card is a folded row; open it so the jump lands on a visible card, not a one-line row above Videos.
  if (heading instanceof HTMLElement && id === "material-oral") heading.querySelector("details")?.setAttribute("open", "");
  // Guide text and card containers are not normally keyboard focus targets.
  if (heading && heading.tabIndex < 0) heading.tabIndex = -1;
  heading?.focus({ preventScroll: true });
  heading?.scrollIntoView?.(scrollOptions);
}
