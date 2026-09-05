import type { ReactElement } from "react";
import { NavLink, Outlet } from "react-router-dom";

import { useAppData } from "@/state/AppDataContext";
import { overdueActions } from "@/logic/actions";
import { todayIso } from "@/lib/dates";
import {
  BookIcon,
  CalendarIcon,
  DeckIcon,
  JournalIcon,
  PlaneIcon,
  QuestionIcon,
  RouteIcon,
  SettingsIcon,
  WalletIcon,
} from "@/components/ui";

import "./shell.css";

interface NavItem {
  to: string;
  label: string;
  icon: ReactElement;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Flight Deck", icon: <DeckIcon size={19} /> },
  { to: "/flight-path", label: "Flight Path", icon: <RouteIcon size={19} /> },
  { to: "/study", label: "Study Library", icon: <BookIcon size={19} /> },
  { to: "/schedule", label: "Schedule", icon: <CalendarIcon size={19} /> },
  { to: "/journal", label: "Flight Journal", icon: <JournalIcon size={19} /> },
  { to: "/questions", label: "Questions", icon: <QuestionIcon size={19} /> },
  { to: "/finances", label: "Finances", icon: <WalletIcon size={19} /> },
];

export function AppShell() {
  const { data } = useAppData();
  const today = todayIso();

  const overdueCount = overdueActions(data.actions, today).length;
  const questionsToAsk = data.questions.filter((q) => q.status === "to_ask").length;

  const countFor = (to: string): { value: number; quiet: boolean } | null => {
    if (to === "/" && overdueCount > 0) return { value: overdueCount, quiet: false };
    if (to === "/questions" && questionsToAsk > 0) return { value: questionsToAsk, quiet: true };
    return null;
  };

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">
            <PlaneIcon size={17} />
          </span>
          <div>
            <p className="brand__name">Her Flight Deck</p>
            <p className="brand__tagline">Training companion</p>
          </div>
        </div>

        <nav className="nav" aria-label="Main">
          {NAV_ITEMS.map((item) => {
            const count = countFor(item.to);
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) => `nav__link${isActive ? " is-active" : ""}`}
              >
                <span className="nav__icon">{item.icon}</span>
                <span>{item.label}</span>
                {count ? (
                  <span className={`nav__count${count.quiet ? " nav__count--quiet" : ""}`}>
                    {count.value}
                    <span className="visually-hidden">
                      {item.to === "/" ? " overdue" : " to ask"}
                    </span>
                  </span>
                ) : null}
              </NavLink>
            );
          })}
        </nav>

        <div className="sidebar__footer stack stack--3">
          <NavLink
            to="/settings"
            className={({ isActive }) => `nav__link${isActive ? " is-active" : ""}`}
          >
            <span className="nav__icon">
              <SettingsIcon size={19} />
            </span>
            <span>Settings</span>
          </NavLink>
          <p className="sidebar__note">
            Your instructor and official aviation guidance stay authoritative. This is
            here to keep your training organized.
          </p>
        </div>
      </aside>

      <main className="content">
        <div className="content__inner">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
