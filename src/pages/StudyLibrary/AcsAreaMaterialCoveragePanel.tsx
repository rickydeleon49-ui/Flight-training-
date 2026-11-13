import { useMemo } from "react";
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
    <section className="library-section acs-area-material-coverage-panel" aria-labelledby="acs-coverage-title">
      <h2 className="library-section__title" id="acs-coverage-title">ACS Area Material Coverage</h2>
      <div>
        <details className="acs-area-material-coverage-details">
          <summary className="acs-area-material-coverage-summary-heading">
            See counts by ACS area
          </summary>
          <div className="stack library-section__body">
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
              className="stack acs-coverage-list"
            >
              {coverageSummaries.map((summary) => (
                <li
                  key={summary.area}
                  data-testid={`acs-coverage-area-${summary.area}`}
                  className="acs-coverage-row"
                >
                  <div className="acs-coverage-row__area">{summary.areaLabel}</div>
                  <div className="small muted">
                    {summary.matchedCodeCount} of {summary.totalCodeCount} current ACS codes have tagged study materials across {summary.distinctMaterialCount} {summary.distinctMaterialCount === 1 ? "material" : "materials"}.
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </details>
      </div>
    </section>
  );
}
