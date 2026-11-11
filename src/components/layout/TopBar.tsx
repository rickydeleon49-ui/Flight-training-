import { IosBackButton } from "./IosBackButton";
import { useTopBar } from "./topBarContext";

/** Slim sticky bar. The title shows once the page's large title has scrolled away. */
export function TopBar({ back }: { back: boolean }) {
  const bar = useTopBar();
  const collapsed = bar?.collapsed ?? false;
  return (
    <div className={collapsed ? "top-bar is-collapsed" : "top-bar"}>
      <div className="top-bar__side">{back ? <IosBackButton /> : null}</div>
      <p className="top-bar__title" aria-hidden="true">{collapsed ? bar?.title : ""}</p>
      <div className="top-bar__side" />
    </div>
  );
}
