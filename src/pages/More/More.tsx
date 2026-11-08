import type { ReactElement } from "react";
import { Link } from "react-router-dom";

import { QUICK_FIND_EVENT } from "@/components/quickfind/QuickFind";
import {
  ChevronRightIcon,
  NoteIcon,
  QuestionIcon,
  RouteIcon,
  SearchIcon,
  SettingsIcon,
  TargetIcon,
  WalletIcon,
} from "@/components/ui";
import { useAppData } from "@/state/AppDataContext";

import "./more.css";
import { DISCLAIMER_LINE } from "@/logic/legal";

interface Row {
  to: string;
  label: string;
  icon: ReactElement;
}

const GROUPS: { title: string; rows: Row[] }[] = [
  {
    title: "Training",
    rows: [
      { to: "/flight-path", label: "Flight Path", icon: <RouteIcon size={20} /> },
      { to: "/questions", label: "Questions", icon: <QuestionIcon size={20} /> },
      { to: "/notes", label: "Notes", icon: <NoteIcon size={20} /> },
    ],
  },
  {
    title: "Tools",
    rows: [
      { to: "/finances", label: "Finances", icon: <WalletIcon size={20} /> },
      { to: "/toolkit", label: "Pilot Toolkit", icon: <TargetIcon size={20} /> },
    ],
  },
];

/** Everything that is not a main tab. */
export function More() {
  const { data } = useAppData();
  const toAsk = data.questions.filter((q) => q.status === "to_ask").length;

  return (
    <div className="more stack stack--5">
      <h1 className="more__title">More</h1>

      <ul className="more__list">
        <li>
          <button type="button" className="more__row" onClick={() => window.dispatchEvent(new Event(QUICK_FIND_EVENT))}>
            <span className="more__icon"><SearchIcon size={20} /></span>
            <span className="more__label">Search</span>
            <ChevronRightIcon size={18} className="more__chevron" />
          </button>
        </li>
      </ul>

      {GROUPS.map((group) => (
        <section key={group.title} aria-label={group.title}>
          <ul className="more__list">
            {group.rows.map((row) => (
              <li key={row.to}>
                <Link to={row.to} className="more__row">
                  <span className="more__icon">{row.icon}</span>
                  <span className="more__label">{row.label}</span>
                  {row.to === "/questions" && toAsk > 0 ? (
                    <span className="more__count">
                      {toAsk}
                      <span className="visually-hidden"> to ask</span>
                    </span>
                  ) : null}
                  <ChevronRightIcon size={18} className="more__chevron" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <ul className="more__list">
        <li>
          <Link to="/settings" className="more__row">
            <span className="more__icon"><SettingsIcon size={20} /></span>
            <span className="more__label">Settings</span>
            <ChevronRightIcon size={18} className="more__chevron" />
          </Link>
        </li>
      </ul>

      <p className="more__note">
        {DISCLAIMER_LINE}
      </p>
    </div>
  );
}
