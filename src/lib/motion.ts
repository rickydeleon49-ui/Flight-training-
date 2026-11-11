/** Scroll behavior that honors the system "Reduce motion" setting. */
export function scrollBehavior(): "auto" | "smooth" {
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  } catch {
    return "smooth";
  }
}
