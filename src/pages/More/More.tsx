import type { ReactElement } from "react";

import { QUICK_FIND_EVENT } from "@/components/quickfind/QuickFind";
import {
  Card,
  ListRow,
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

      <Card variant="grouped" ariaLabel="Search">
        <ul className="list-group">
          <li>
            <ListRow
              onClick={() => window.dispatchEvent(new Event(QUICK_FIND_EVENT))}
              icon={<SearchIcon size={20} />}
              title="Search"
              chevron
            />
          </li>
        </ul>
      </Card>

      {GROUPS.map((group) => (
        <Card key={group.title} variant="grouped" ariaLabel={group.title}>
          <ul className="list-group">
            {group.rows.map((row) => (
              <li key={row.to}>
                <ListRow
                  to={row.to}
                  icon={row.icon}
                  title={row.label}
                  value={
                    row.to === "/questions" && toAsk > 0 ? (
                      <span className="more__count">
                        {toAsk}
                        <span className="visually-hidden"> to ask</span>
                      </span>
                    ) : undefined
                  }
                  chevron
                />
              </li>
            ))}
          </ul>
        </Card>
      ))}

      <Card variant="grouped" ariaLabel="Settings">
        <ul className="list-group">
          <li>
            <ListRow to="/settings" icon={<SettingsIcon size={20} />} title="Settings" chevron />
          </li>
        </ul>
      </Card>

      <p className="more__note">
        {DISCLAIMER_LINE}
      </p>
    </div>
  );
}
