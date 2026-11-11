import { useEffect, useRef, type ReactNode } from "react";

import { useTopBar } from "./topBarContext";

/** Standard page title block. The title always uses the display face. */
export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  const bar = useTopBar();
  const setTitle = bar?.setTitle;
  const setCollapsed = bar?.setCollapsed;
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const node = heading.current;
    if (!setTitle || !setCollapsed || !node) return;
    setTitle(title);
    let observer: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== "undefined") {
      // The bar is about 44px tall; flip once the title passes under it.
      observer = new IntersectionObserver(
        (entries) => {
          const entry = entries[entries.length - 1];
          if (entry) setCollapsed(!entry.isIntersecting && entry.boundingClientRect.top < 0);
        },
        { rootMargin: "-56px 0px 0px 0px" },
      );
      observer.observe(node);
    }
    return () => {
      observer?.disconnect();
      setTitle("");
      setCollapsed(false);
    };
  }, [title, setTitle, setCollapsed]);

  return (
    <header className="page-header">
      <div>
        <h1 ref={heading} className="page-header__title">{title}</h1>
        {subtitle ? <p className="page-header__subtitle">{subtitle}</p> : null}
      </div>
      {action}
    </header>
  );
}
