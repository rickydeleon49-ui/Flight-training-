import { useHistoryScroll } from "./useHistoryScroll";
import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactElement } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";

import {
  QUICK_FIND_EVENT,
  QuickFind,
  quickFindShortcutLabel,
} from "@/components/quickfind/QuickFind";
import { GeminiOrphanNotices } from "@/components/gemini/GeminiOrphanNotices";
import { ReminderNotifications } from "@/components/reminders/ReminderNotifications";
import { UndoBar } from "@/components/undo/UndoBar";
import { useAppData } from "@/state/AppDataContext";
import { overdueActions } from "@/logic/actions";
import { todayIso } from "@/lib/dates";
import {
  BookIcon,
  CalendarIcon,
  SearchIcon,
  DeckIcon,
  JournalIcon,
  NoteIcon,
  PlaneIcon,
  QuestionIcon,
  RouteIcon,
  SettingsIcon,
  TargetIcon,
  WalletIcon,
  Loading,
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
  { to: "/journal", label: "Flight Log", icon: <JournalIcon size={19} /> },
  { to: "/questions", label: "Questions", icon: <QuestionIcon size={19} /> },
  { to: "/notes", label: "Notes", icon: <NoteIcon size={19} /> },
  { to: "/finances", label: "Finances", icon: <WalletIcon size={19} /> },
  { to: "/toolkit", label: "Pilot Toolkit", icon: <TargetIcon size={19} /> },
];

export function AppShell() {
  const { data } = useAppData();
  const location = useLocation();
  const today = todayIso();
  const menuRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const navigationRef = useRef<HTMLDivElement>(null);
  const [desktop, setDesktop] = useState(() => window.matchMedia?.("(min-width: 1000px)").matches ?? true);
  const [menuOpen, setMenuOpen] = useState(false);
  const resizeFocusRef = useRef<"search" | "menu" | null>(null);

  // Anchor destinations stay below the sticky header, including enlarged text.
  useLayoutEffect(() => {
    const sidebar = sidebarRef.current;
    const shell = sidebar?.parentElement;
    if (!sidebar || !shell || desktop) return;
    const measure = () => shell.style.setProperty("--narrow-header-height", `${sidebar.getBoundingClientRect().height}px`);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(sidebar);
    return () => {
      observer?.disconnect();
      shell.style.removeProperty("--narrow-header-height");
    };
  }, [desktop]);

  const overdueCount = overdueActions(data.actions, today).length;
  const questionsToAsk = data.questions.filter((q) => q.status === "to_ask").length;

  const countFor = (to: string): { value: number; quiet: boolean } | null => {
    if (to === "/" && overdueCount > 0) return { value: overdueCount, quiet: false };
    if (to === "/questions" && questionsToAsk > 0) return { value: questionsToAsk, quiet: true };
    return null;
  };

  useEffect(() => {
    const media = window.matchMedia?.("(min-width: 1000px)");
    if (!media) return;
    const update = () => {
      // Keep focus reachable when a resize hides the disclosure or its button.
      if (media.matches && document.activeElement === menuRef.current) {
        resizeFocusRef.current = "search";
      } else if (!media.matches && navigationRef.current?.contains(document.activeElement)) {
        resizeFocusRef.current = "menu";
      }
      setDesktop(media.matches);
      setMenuOpen(false);
    };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    // Wait until the new layout has revealed the destination before focusing it.
    if (resizeFocusRef.current === "search") {
      navigationRef.current?.querySelector<HTMLButtonElement>(".nav__search")?.focus();
    } else if (resizeFocusRef.current === "menu") {
      menuRef.current?.focus();
    }
    resizeFocusRef.current = null;
  }, [desktop]);

  const beforeQuickFindOpen = useCallback(() => {
    if (desktop) return;
    // Give the dialog a visible return target before it captures focus.
    // WebKit doesn't focus a button on mouse click, so an open Menu with focus
    // on the page body also returns to the Menu button.
    const active = document.activeElement;
    if (navigationRef.current?.contains(active) || (menuOpen && (!active || active === document.body))) {
      menuRef.current?.focus();
    }
    setMenuOpen(false);
  }, [desktop, menuOpen]);

  const closeMenu = () => {
    if (!desktop) {
      setMenuOpen(false);
      menuRef.current?.focus();
    }
  };

  useEffect(() => {
    // Also close after navigation from Quick Find or browser history.
    setMenuOpen(false);
    if (!desktop && navigationRef.current?.contains(document.activeElement)) {
      menuRef.current?.focus();
    }
  }, [location.key, desktop]);

  useHistoryScroll();

  useEffect(() => {
    if (desktop) {
      navigationRef.current?.querySelector<HTMLElement>(".nav .nav__link.is-active")
        ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    }
  }, [desktop, location.pathname]);

  return (
    <div className="shell">
      <aside ref={sidebarRef} className="sidebar" onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented || desktop || !menuOpen) return;
        const target = event.target as HTMLElement;
        if (target.closest("dialog, [role=dialog]")) return;
        if (target === menuRef.current || navigationRef.current?.contains(target)) {
          event.preventDefault();
          event.stopPropagation();
          closeMenu();
        }
      }}>
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">
            <PlaneIcon size={17} />
          </span>
          <div>
            <p className="brand__name">Her Flight Deck</p>
            <p className="brand__tagline">Training companion</p>
          </div>
        </div>

        <button
          ref={menuRef}
          type="button"
          className="button button--secondary sidebar__menu"
          hidden={desktop}
          aria-expanded={menuOpen}
          aria-controls="app-navigation"
          onClick={() => setMenuOpen((open) => !open)}
        >
          Menu
        </button>

        <div
          id="app-navigation"
          ref={navigationRef}
          className="sidebar__navigation"
          hidden={!desktop && !menuOpen}
        >
          <button
            type="button"
            className="nav__search"
            onClick={() => window.dispatchEvent(new Event(QUICK_FIND_EVENT))}
          >
            <span className="nav__icon">
              <SearchIcon size={17} />
            </span>
            <span>Search</span>
            <kbd className="nav__shortcut">{quickFindShortcutLabel()}</kbd>
          </button>

          <div className="nav-wrapper">
            <nav className="nav" aria-label="Main">
              {NAV_ITEMS.map((item) => {
                const count = countFor(item.to);
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={closeMenu}
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
          </div>

          <div className="sidebar__footer stack stack--3">
            <NavLink
              to="/settings"
              onClick={closeMenu}
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
        </div>
      </aside>

      <main className="content">
        <div className="content__inner">
          <GeminiOrphanNotices />
          <Suspense fallback={<Loading label="Opening this section" />}>
            <Outlet />
          </Suspense>
        </div>
      </main>
      <ReminderNotifications />
      <QuickFind onBeforeOpen={beforeQuickFindOpen} />
      <UndoBar />
    </div>
  );
}
