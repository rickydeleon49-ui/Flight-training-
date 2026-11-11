import { useEffect, useState } from "react";
import { scrollBehavior } from "../../lib/motion";

/** A quiet shortcut for the two long study pages. */
export function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const update = () => setVisible(
      window.scrollY > window.innerHeight && !document.querySelector("dialog[open]"),
    );
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    // Includes native dialogs and the older WebKit modal fallback, even portals.
    const observer = new MutationObserver(update);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      observer.disconnect();
    };
  }, []);

  if (!visible) return null;
  return (
    <button className="button button--secondary back-to-top" type="button" aria-label="Back to top" title="Back to top" onClick={() => {
      const heading = document.querySelector<HTMLElement>("main h1");
      if (heading) {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
      }
      window.scrollTo({ top: 0, behavior: scrollBehavior() });
    }}>
      <span aria-hidden="true">↑</span>
    </button>
  );
}
