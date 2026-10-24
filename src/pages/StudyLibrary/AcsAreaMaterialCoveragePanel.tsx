import { useMemo } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui";
import type { StudyMaterial } from "@/domain/types";
import {
  summarizeAcsAreaMaterialCoverage,
  type AcsAreaMaterialCoverageSummary,
} from "@/logic/acsAreaMaterialCoverage";

export interface AcsAreaMaterialCoveragePanelProps {
  materials?: readonly StudyMaterial[];
}

export function AcsAreaMaterialCoveragePanel({
  materials = [],
}: AcsAreaMaterialCoveragePanelProps) {
  const coverageSummaries: AcsAreaMaterialCoverageSummary[] = useMemo(() => {
    return summarizeAcsAreaMaterialCoverage({ materials });
  }, [materials]);

  const totalMatchedCodes = useMemo(() => {
    return coverageSummaries.reduce((sum, item) => sum + item.matchedCodeCount, 0);
  }, [coverageSummaries]);

  return (
    <Card className="acs-area-material-coverage-panel">
      <CardHeader title="ACS Area Material Coverage" />
      <CardBody>
        <details className="acs-area-material-coverage-details">
          <summary className="acs-area-material-coverage-summary-heading" style={{ cursor: "pointer", fontWeight: 600 }}>
            See counts by ACS area
          </summary>
          <div style={{ marginTop: "var(--space-3)" }} className="stack">
            <p className="dim small" data-testid="acs-coverage-explanation">
              These counts show which study materials have ACS tags. They do not show what you have studied or how you are doing.
            </p>

            {totalMatchedCodes === 0 ? (
              <p className="dim small" data-testid="acs-coverage-zero-tags">
                No study materials have these ACS tags.
              </p>
            ) : null}

            <ul
              data-testid="acs-coverage-list"
              style={{ listStyleType: "none", padding: 0, margin: 0 }}
              className="stack"
            >
              {coverageSummaries.map((summary) => (
                <li
                  key={summary.area}
                  data-testid={`acs-coverage-area-${summary.area}`}
                  className="acs-coverage-row"
                  style={{
                    padding: "var(--space-2) 0",
                    borderBottom: "1px solid var(--border-subtle, #eee)",
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{summary.areaLabel}</div>
                  <div className="small muted">
                    {summary.matchedCodeCount} of {summary.totalCodeCount} current ACS codes have tagged study materials across {summary.distinctMaterialCount} {summary.distinctMaterialCount === 1 ? "material" : "materials"}.
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </details>
      </CardBody>
    </Card>
  );
}
