import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { ChevronRightIcon } from "./Icons";

interface ListRowProps {
  to?: string;
  onClick?: () => void;
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  value?: ReactNode;
  /** Show a chevron. Only for rows that open something. */
  chevron?: boolean;
}

/** One 44 pt row of a grouped list: a link, a button or a plain row. */
export function ListRow({ to, onClick, icon, title, subtitle, value, chevron }: ListRowProps) {
  const inner = (
    <>
      {icon ? <span className="list-row__icon">{icon}</span> : null}
      <span className="list-row__main">
        <span className="list-row__text">
          <span className="list-row__title">{title}</span>
          {subtitle ? <span className="list-row__subtitle">{subtitle}</span> : null}
        </span>
        {value ? <span className="list-row__value">{value}</span> : <span />}
        {chevron ? <ChevronRightIcon size={14} className="list-row__chevron" /> : <span />}
      </span>
    </>
  );
  if (to) return <Link to={to} className="list-row">{inner}</Link>;
  if (onClick) return <button type="button" className="list-row" onClick={onClick}>{inner}</button>;
  return <div className="list-row">{inner}</div>;
}
