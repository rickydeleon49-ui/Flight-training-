import { Card, CardBody, CardHeader } from "@/components/ui";
import { todayIso } from "@/lib/dates";
import {
  flightLogTotals,
  formatHours,
  HOURS_TO_GO_CANT_TELL,
  HOURS_TO_GO_NIGHT_STATUS,
  privatePilotHoursToGo,
} from "@/logic/flightLog";
import type { ToolkitState } from "@/domain/types";
import { useAppData } from "@/state/AppDataContext";

import "./pilotToolkit.css";

export function HoursToGoCard({ state }: { state: ToolkitState }) {
  const { data } = useAppData();
  const totals = flightLogTotals(data.journalEntries);
  const flownToday = todayIso();
  const nightLandings = data.journalEntries.reduce(
    (sum, entry) => sum + (entry.date <= flownToday ? (entry.nightLandings ?? 0) : 0),
    0,
  );
  const rows = privatePilotHoursToGo(totals, nightLandings, state.checkrideDate, data.journalEntries);
  return (
    <Card variant="grouped">
      <CardHeader title="Hours still to go" eyebrow="From your journal · 14 CFR 61.109(a)" />
      <CardBody flush>
        {rows.map((row) => (
          <div className="toolkit-row" key={row.key} data-testid={`hours-to-go-${row.key}`}>
            <div>
              <p className="strong small">{row.label}</p>
              <p className="tiny dim">Reference: {row.reference}</p>
              {row.info ? <p className="tiny">{row.info}</p> : null}
              {row.meta ? <p className="tiny dim">{row.meta}</p> : null}
            </div>
            <p className="small numeric">
              {row.statusText
                ? row.statusText
                : row.logged != null && row.toGo != null
                ? row.status === "done"
                  ? `logged ${formatHours(row.logged)} / ${row.reference} — done`
                  : `logged ${formatHours(row.logged)} / ${row.reference} — ${formatHours(row.toGo)} h to go`
                : row.key === "night"
                  ? HOURS_TO_GO_NIGHT_STATUS
                  : HOURS_TO_GO_CANT_TELL}
            </p>
          </div>
        ))}
      </CardBody>
      <CardBody>
        <p className="tiny dim">
          A study aid, not an eligibility check. Your instructor's logbook review decides.
        </p>
      </CardBody>
    </Card>
  );
}
