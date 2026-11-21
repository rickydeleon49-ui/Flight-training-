import { Link } from "react-router-dom";
import { Card, CardBody, CardHeader, Select } from "@/components/ui";
import { READINESS_STATUS_OPTIONS, type ReadinessStatus } from "@/domain/types";
import { readinessSummary } from "@/logic/toolkit";
import { HoursToGoCard } from "./HoursToGoCard";
import { AcsReadinessList } from "./AcsReadinessList";
import { BringChecklist } from "./ChecklistTools";
import { type ToolProps } from "./toolkitShared";

export function ReadinessTool({ state, save }: ToolProps) {
  const summary = readinessSummary(state.readinessItems);
  const areas = [
    ["knowledge", "Knowledge and oral preparation"],
    ["flight", "Flight proficiency"],
    ["administration", "Eligibility and paperwork"],
  ] as const;

  const updateStatus = (id: string, status: ReadinessStatus) =>
    save((current) => ({
      ...current,
      readinessItems: current.readinessItems.map((item) =>
        item.id === id ? { ...item, status } : item,
      ),
    }));

  return (
    <div className="stack stack--5 toolkit-print-area">
      <AcsReadinessList />
      <Card>
        <CardHeader
          title="Private pilot checkride prep"
          eyebrow="Planning checklist"
        />
        <CardBody>
          <div className="toolkit-hero-metrics">
            <div>
              <p className="toolkit-number numeric">
                {summary.ready}/{summary.total}
              </p>
              <p className="tiny dim">feel confident or signed off</p>
            </div>
            <div>
              <p className="toolkit-number numeric">{summary.signedOff}</p>
              <p className="tiny dim">instructor signed off</p>
            </div>
          </div>
          <div
            className="toolkit-progress"
            role="progressbar"
            aria-label="Checkride prep checklist"
            aria-valuemin={0}
            aria-valuemax={summary.total}
            aria-valuenow={summary.ready}
          >
            <span style={{ width: `${summary.percent}%` }} />
          </div>
          <p className="small muted toolkit-note">
            Your own checklist for talks with your instructor. It doesn't
            certify you or show you are eligible: only your instructor's
            endorsements and the examiner decide that.
          </p>
        </CardBody>
      </Card>

      <HoursToGoCard state={state} />

      <BringChecklist state={state} save={save} />

      <p className="small">
        <Link to="/flight-path">What the examiner looks for, by skill</Link>
      </p>

      {areas.map(([area, title]) => (
        <Card key={area} variant="grouped">
          <CardHeader title={title} />
          <CardBody flush>
            {state.readinessItems
              .filter((item) => item.area === area)
              .map((item) => (
                <div className="toolkit-row" key={item.id}>
                  <span className="small wrap-anywhere">{item.title}</span>
                  <Select
                    aria-label={`Readiness for ${item.title}`}
                    options={READINESS_STATUS_OPTIONS}
                    value={item.status}
                    onChange={(value) => void updateStatus(item.id, value)}
                  />
                </div>
              ))}
          </CardBody>
        </Card>
      ))}
      <p className="tiny dim">
        Use the current Private Pilot Airman Certification Standards and review
        every item with your instructor; this is intentionally not an exhaustive
        regulatory checklist.
      </p>
    </div>
  );
}
