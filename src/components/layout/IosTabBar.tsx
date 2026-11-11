import type { MouseEvent, ReactElement } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";

import {
  BookIcon,
  CalendarIcon,
  DeckIcon,
  JournalIcon,
  MoreIcon,
} from "@/components/ui";

import { useScrollDirection } from "./useScrollDirection";
import { scrollBehavior } from "../../lib/motion";

import "./iosTabBar.css";

/** Pages that live under the More tab. */
export const MORE_PREFIXES = [
  "/more",
  "/flight-path",
  "/questions",
  "/notes",
  "/finances",
  "/toolkit",
  "/settings",
];

export function isMoreRoute(pathname: string): boolean {
  return MORE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

interface Tab {
  to: string;
  label: string;
  icon: (strokeWidth: number) => ReactElement;
}

const STROKE = 1.75;
const STROKE_ACTIVE = 2.25;

const TABS: Tab[] = [
  { to: "/", label: "Home", icon: (w) => <DeckIcon size={26} strokeWidth={w} /> },
  { to: "/study", label: "Study", icon: (w) => <BookIcon size={26} strokeWidth={w} /> },
  { to: "/schedule", label: "Schedule", icon: (w) => <CalendarIcon size={26} strokeWidth={w} /> },
  { to: "/journal", label: "Log", icon: (w) => <JournalIcon size={26} strokeWidth={w} /> },
];

interface Props {
  overdueCount: number;
  questionsToAsk: number;
}

/** The iPhone's main navigation: five tabs at the bottom of the screen. */
export function IosTabBar({ overdueCount, questionsToAsk }: Props) {
  const { pathname } = useLocation();
  const moreActive = isMoreRoute(pathname);
  const compact = useScrollDirection(pathname);

  // Tapping the tab you are already on scrolls back to the top (no new history entry).
  const scrollIfCurrent = (root: string) => (event: MouseEvent) => {
    if (pathname === root) {
      event.preventDefault();
      window.scrollTo({ top: 0, behavior: scrollBehavior() });
    }
  };

  return (
    <nav className={`ios-tab-bar${compact ? " is-compact" : ""}`} aria-label="Main">
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.to === "/"}
          onClick={scrollIfCurrent(tab.to)}
          className={({ isActive }) =>
            `ios-tab-bar__tab${isActive ? " is-active" : ""}`
          }
        >
          {({ isActive }) => (
            <>
              <span className="ios-tab-bar__icon">
                {tab.icon(isActive ? STROKE_ACTIVE : STROKE)}
              </span>
              <span className="ios-tab-bar__label">{tab.label}</span>
              {tab.to === "/" && overdueCount > 0 ? (
                <span className="ios-tab-bar__badge">
                  {overdueCount}
                  <span className="visually-hidden"> overdue</span>
                </span>
              ) : null}
            </>
          )}
        </NavLink>
      ))}
      <Link
        to="/more"
        aria-current={moreActive ? "page" : undefined}
        onClick={scrollIfCurrent("/more")}
        className={`ios-tab-bar__tab${moreActive ? " is-active" : ""}`}
      >
        <span className="ios-tab-bar__icon">
          <MoreIcon size={26} strokeWidth={moreActive ? STROKE_ACTIVE : STROKE} />
        </span>
        <span className="ios-tab-bar__label">More</span>
        {questionsToAsk > 0 ? (
          <span className="ios-tab-bar__badge ios-tab-bar__badge--quiet">
            {questionsToAsk}
            <span className="visually-hidden"> to ask</span>
          </span>
        ) : null}
      </Link>
    </nav>
  );
}
