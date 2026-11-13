import { isIOS } from "@/services/platform";
import { useHistoryScroll } from "./useHistoryScroll";
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";

import {
  QUICK_FIND_EVENT,
  QuickFind,
  quickFindShortcutLabel,
} from "@/components/quickfind/QuickFind";
import { GeminiOrphanNotices } from "@/components/gemini/GeminiOrphanNotices";
import { StudyPackNotice } from "@/components/StudyPackNotice";
import { KitQueueDialog } from "@/pages/StudyLibrary/KitQueueDialog";
import { CheckrideNotifications } from "@/components/reminders/CheckrideNotifications";
import { DailyStudyReminder } from "@/components/reminders/DailyStudyReminder";
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

import { IosTabBar } from "./IosTabBar";
import { TopBar } from "./TopBar";
import { TopBarContext } from "./topBarContext";

import "./shell.css";
import { DISCLAIMER_LINE } from "@/logic/legal";
import { useClearLibrarySearchOnLeave } from "@/pages/StudyLibrary/librarySearchReset";

interface NavItem {
  to: string;
  label: string;
  /** Visible label in the 700-999px rail; always part of `label`. */
  short: string;
  icon: ReactElement;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Flight Deck", short: "Deck", icon: <DeckIcon size={19} /> },
  { to: "/flight-path", label: "Flight Path", short: "Path", icon: <RouteIcon size={19} /> },
  { to: "/study", label: "Study Library", short: "Library", icon: <BookIcon size={19} /> },
  { to: "/schedule", label: "Schedule", short: "Schedule", icon: <CalendarIcon size={19} /> },
  { to: "/journal", label: "Flight Log", short: "Log", icon: <JournalIcon size={19} /> },
  { to: "/questions", label: "Ask my instructor", short: "Ask", icon: <QuestionIcon size={19} /> },
  { to: "/notes", label: "Notes", short: "Notes", icon: <NoteIcon size={19} /> },
  { to: "/finances", label: "Finances", short: "Finances", icon: <WalletIcon size={19} /> },
  { to: "/toolkit", label: "Pilot Toolkit", short: "Toolkit", icon: <TargetIcon size={19} /> },
];

const RAIL_QUERY = "(min-width: 700px) and (max-width: 999px)";
const SHORT_QUERY = "(max-height: 700px)";

function useMedia(query: string, initial = false): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia?.(query).matches ?? initial);
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media?.addEventListener) return;
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
}

export function AppShell() {
  const { data } = useAppData();
  const location = useLocation();
  const today = todayIso();
  const menuRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const navigationRef = useRef<HTMLDivElement>(null);
  const [desktop, setDesktop] = useState(() => window.matchMedia?.("(min-width: 1000px)").matches ?? true);
  const [menuOpen, setMenuOpen] = useState(false);
  const railMedia = useMedia(RAIL_QUERY);
  const shortWindow = useMedia(SHORT_QUERY);
  const [noteOpen, setNoteOpen] = useState(false);
  const resizeFocusRef = useRef<"search" | "menu" | null>(null);
  const [barTitle, setBarTitle] = useState("");
  const [barCollapsed, setBarCollapsed] = useState(false);

  const rail = railMedia && !desktop;
  const overlay = rail && menuOpen;
  const railLabels = rail && !menuOpen;

  // Anchor destinations stay below the sticky header, including enlarged text.
  useLayoutEffect(() => {
    const sidebar = sidebarRef.current;
    const shell = sidebar?.parentElement;
    if (!sidebar || !shell || desktop || rail) return;
    const measure = () => shell.style.setProperty("--narrow-header-height", `${sidebar.getBoundingClientRect().height}px`);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(sidebar);
    return () => {
      observer?.disconnect();
      shell.style.removeProperty("--narrow-header-height");
    };
  }, [desktop, rail]);

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

  // Rail overlay: close when the layout changes, move focus in on open, close on an outside press.
  useEffect(() => { setMenuOpen(false); }, [rail]);
  useEffect(() => {
    if (!overlay) return;
    navigationRef.current?.querySelector<HTMLElement>(".nav__search")?.focus();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (navigationRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      if ((target as HTMLElement).closest?.("dialog, [role=dialog]")) return;
      setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [overlay]);

  useEffect(() => {
    // Wait until the new layout has revealed the destination before focusing it.
    if (resizeFocusRef.current === "search") {
      navigationRef.current?.querySelector<HTMLButtonElement>(".nav__search")?.focus();
    } else if (resizeFocusRef.current === "menu") {
      menuRef.current?.focus();
    }
    resizeFocusRef.current = null;
  }, [desktop]);

  // iPhone only: a bottom tab bar replaces the header and menu. A wide iPad keeps the sidebar.
  const tabs = isIOS() && !desktop;

  // The narrow Mac layout keeps its own sticky Menu header instead.
  const hasTopBar = tabs || desktop;
  const barState = useMemo(
    () => ({ title: barTitle, setTitle: setBarTitle, collapsed: barCollapsed, setCollapsed: setBarCollapsed }),
    [barTitle, barCollapsed],
  );

  const beforeQuickFindOpen = useCallback(() => {
    if (desktop || tabs) return;
    // Give the dialog a visible return target before it captures focus.
    // WebKit doesn't focus a button on mouse click, so an open Menu with focus
    // on the page body also returns to the Menu button.
    const active = document.activeElement;
    if (navigationRef.current?.contains(active) || (menuOpen && (!active || active === document.body))) {
      menuRef.current?.focus();
    }
    setMenuOpen(false);
  }, [desktop, tabs, menuOpen]);

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
  useClearLibrarySearchOnLeave();

  useEffect(() => {
    if (desktop) {
      navigationRef.current?.querySelector<HTMLElement>(".nav .nav__link.is-active")
        ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    }
  }, [desktop, location.pathname]);

  return (
    <TopBarContext.Provider value={barState}>
    <div className={tabs ? "shell shell--tabs" : "shell"}>
      {tabs ? <IosTabBar overdueCount={overdueCount} /> : (
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
            <p className="brand__name">Your Flight Deck</p>
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
          className={overlay ? "sidebar__navigation is-overlay" : "sidebar__navigation"}
          hidden={!desktop && !rail && !menuOpen}
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
            {isIOS() || railLabels ? null : <kbd className="nav__shortcut">{quickFindShortcutLabel()}</kbd>}
          </button>

          <div className="nav-wrapper">
            <nav className="nav" aria-label="Main">
              {NAV_ITEMS.map((item) => {
                const count = countFor(item.to);
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    state={item.to === "/study" ? { scrollToTop: true } : undefined}
                    replace={item.to === "/study" ? false : undefined}
                    onClick={closeMenu}
                    aria-label={railLabels ? item.label : undefined}
                    end={item.to === "/"}
                    className={({ isActive }) => `nav__link${isActive ? " is-active" : ""}`}
                  >
                    <span className="nav__icon">{item.icon}</span>
                    <span className="nav__label">{railLabels ? item.short : item.label}</span>
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
            {shortWindow ? (
              <div className="sidebar__note sidebar__note--short">
                <button
                  type="button"
                  className="sidebar__note-toggle"
                  aria-expanded={noteOpen}
                  aria-controls="sidebar-note-text"
                  onClick={() => setNoteOpen((open) => !open)}
                >
                  Study aid only
                  <span aria-hidden="true">{noteOpen ? " \u2212" : " +"}</span>
                </button>
                <p id="sidebar-note-text" hidden={!noteOpen}>{DISCLAIMER_LINE}</p>
              </div>
            ) : (
              <p className="sidebar__note">
                {DISCLAIMER_LINE}
              </p>
            )}
          </div>
        </div>
      </aside>
      )}

      <main className={hasTopBar ? "content content--top-bar" : "content"}>
        {hasTopBar ? <TopBar back={tabs} /> : null}
        <div className="content__inner">
          <GeminiOrphanNotices />
          <StudyPackNotice />
          <KitQueueDialog />
          <Suspense fallback={<Loading label="Opening this section" />}>
            <Outlet />
          </Suspense>
        </div>
      </main>
      <ReminderNotifications />
      <DailyStudyReminder />
      <CheckrideNotifications />
      <QuickFind onBeforeOpen={beforeQuickFindOpen} />
      <UndoBar />
    </div>
    </TopBarContext.Provider>
  );
}
