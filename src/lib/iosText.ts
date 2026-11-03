import { isIOS } from "@/services/platform";

/** Apply before rendering. Returns cleanup for tests and development reloads. */
export function initIOSText(): () => void {
  const root = document.documentElement;
  const ios = isIOS();
  root.classList.toggle("is-ios", ios);
  if (!ios) return () => {};

  // A separate system-font element avoids reading back our own scaled root.
  // Its dimensions change when WebKit updates Dynamic Type, including on resume.
  const probe = document.createElement("span");
  probe.className = "ios-text-probe";
  probe.setAttribute("aria-hidden", "true");
  probe.textContent = "M";
  document.body.append(probe);
  const update = () => {
    const size = Number.parseFloat(getComputedStyle(probe).fontSize);
    if (Number.isFinite(size) && size > 0) {
      root.style.setProperty("--ios-system-font-size", `${size}px`);
    }
  };
  update();
  const observer = new ResizeObserver(update);
  observer.observe(probe);
  document.addEventListener("visibilitychange", update);
  window.addEventListener("pageshow", update);
  return () => {
    observer.disconnect();
    document.removeEventListener("visibilitychange", update);
    window.removeEventListener("pageshow", update);
    probe.remove();
    root.classList.remove("is-ios");
    root.style.removeProperty("--ios-system-font-size");
  };
}
