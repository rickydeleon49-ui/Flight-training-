import { useMemo, useState, type FormEvent } from "react";
import { Button, Card, CardBody, CardHeader, Field, TextArea } from "@/components/ui";
import type { AiStudySet, PracticeTest, Question, StudyMaterial } from "@/domain/types";
import { tokenizeAktrCodes } from "@/logic/aktrCodeInput";
import {
  indexAcsRelatedStudy,
  selectAcsRelatedStudy,
  type AcsRelatedStudyIndex,
} from "@/logic/relatedStudy";
import { RelatedStudyList } from "./RelatedStudy";

export interface AcsCodeLookupPanelProps {
  materials?: readonly StudyMaterial[];
  aiStudySets?: readonly AiStudySet[];
  practiceTests?: readonly PracticeTest[];
  questions?: readonly Question[];
}

export function AcsCodeLookupPanel({
  materials = [],
  aiStudySets = [],
  practiceTests = [],
  questions = [],
}: AcsCodeLookupPanelProps) {
  const [input, setInput] = useState("");
  const [submittedTokens, setSubmittedTokens] = useState<string[] | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const handleInputChange = (value: string) => {
    setInput(value);
    if (!value.trim()) {
      if (submittedTokens !== null) {
        setAnnouncement("Lookup results cleared.");
      }
      setSubmittedTokens(null);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const tokens = tokenizeAktrCodes(input);
    if (tokens.length === 0) {
      setSubmittedTokens(null);
      setAnnouncement("No codes entered.");
      return;
    }

    setSubmittedTokens(tokens);

    const groups = tokens.map((code) => selectAcsRelatedStudy(code, index));

    let currentCount = 0;
    let archivedCount = 0;
    let notFoundCount = 0;

    for (const g of groups) {
      if (g.status === "current" || g.status === "task" || g.status === "failed") {
        currentCount += 1;
      } else if (g.status === "archived") {
        archivedCount += 1;
      } else {
        notFoundCount += 1;
      }
    }

    const total = groups.length;
    setAnnouncement(
      `${total} code${total === 1 ? "" : "s"} checked. ${currentCount} current, ${archivedCount} archived, ${notFoundCount} not found.`,
    );
  };

  // One pass over the library; each code then reads only its own exact tags.
  const index = useMemo(
    () => indexAcsRelatedStudy({ materials, aiStudySets, practiceTests, questions }),
    [materials, aiStudySets, practiceTests, questions],
  );
  const results = useMemo(
    () => (submittedTokens === null ? null : submittedTokens.map((code) => selectAcsRelatedStudy(code, index))),
    [submittedTokens, index],
  );

  return (
    <Card className="acs-code-lookup-panel">
      <CardHeader title="Find study materials for missed topics" />
      <CardBody>
        <form onSubmit={handleSubmit} className="stack">
          <Field
            label="Missed topic codes"
            hint="Enter codes from your knowledge-test report separated by spaces, commas, or semicolons (for example: PA.I.A.K1, PA.I.B.K2). Codes are kept only in this panel and are not saved. Study materials need the full ACS code as a tag to match."
          >
            <TextArea
              value={input}
              onChange={(e) => handleInputChange(e.target.value)}
              placeholder="PA.I.A.K1, PA.I.B.K2"
              rows={3}
            />
          </Field>

          <div>
            <Button type="submit" variant="primary">
              Find study materials
            </Button>
          </div>
        </form>

        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="visually-hidden"
          data-testid="acs-lookup-status"
        >
          {announcement}
        </div>

        {results !== null ? (
          <div className="acs-code-lookup-results stack" style={{ marginTop: "var(--space-4)" }}>
            {results.length === 0 ? (
              <p className="dim small">No codes entered.</p>
            ) : (
              results.map((group) => {
                if (group.status === "current" || group.status === "task" || group.status === "failed") {
                  return <AcsCodeRelatedStudy key={group.code} code={group.code} title={group.title} index={index} />;
                }

                if (group.status === "archived") {
                  return (
                    <div
                      key={group.code}
                      className="acs-code-result-item"
                      data-testid={`acs-code-result-${group.code}`}
                    >
                      <div>
                        <strong>{group.code}</strong>
                        {group.title ? (
                          <span className="dim"> — {group.title}</span>
                        ) : null}
                        <span className="dim small"> (Archived code)</span>
                      </div>
                      <p className="dim small" style={{ margin: "var(--space-1) 0 0 0" }}>
                        This code is from an older edition or superseded standard. No current study materials match.
                      </p>
                    </div>
                  );
                }

                return (
                  <div
                    key={group.code}
                    className="acs-code-result-item"
                    data-testid={`acs-code-result-${group.code}`}
                  >
                    <div>
                      <strong>{group.code}</strong>
                      <span className="dim small"> (Not found)</span>
                    </div>
                    <p className="dim small" style={{ margin: "var(--space-1) 0 0 0" }}>
                      This code was not recognized in the current Private Pilot Airplane ACS catalog.
                    </p>
                  </div>
                );
              })
            )}
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

/** One looked-up code: the shared Related study list, three rows first, then all of them. */
function AcsCodeRelatedStudy({ code, title, index }: { code: string; title: string | null; index: AcsRelatedStudyIndex }) {
  const [expanded, setExpanded] = useState(false);
  const group = selectAcsRelatedStudy(code, index, expanded);
  return (
    <div className="acs-code-result-item" data-testid={`acs-code-result-${code}`}>
      <div>
        <strong>{code}</strong>
        {title ? <span className="dim"> — {title}</span> : null}
      </div>
      <div className="related-study related-study--plain">
        <RelatedStudyList
          label={`Related study for ${code}`}
          rows={group.rows}
          hasMore={group.hasMore}
          expanded={expanded}
          onShowMore={() => setExpanded(true)}
          empty={group.status === "failed" ? null : "No tagged study materials exist for this topic code."}
        >
          {group.status === "failed" ? (
            <p className="small muted" role="alert">Study for this code couldn&apos;t be checked. Try again in a moment.</p>
          ) : null}
        </RelatedStudyList>
      </div>
    </div>
  );
}
