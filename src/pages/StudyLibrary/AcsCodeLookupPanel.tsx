import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Button, Card, CardBody, CardHeader, Field, TextArea } from "@/components/ui";
import type { AiStudySet, PracticeTest, Question, StudyMaterial } from "@/domain/types";
import { tokenizeAktrCodes } from "@/logic/aktrCodeInput";
import {
  findAcsStudyMaterialLinks,
  type AcsStudyMaterialLinksGroup,
} from "@/logic/acsStudyMaterialLinks";

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
  const [results, setResults] = useState<AcsStudyMaterialLinksGroup[] | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const handleInputChange = (value: string) => {
    setInput(value);
    if (!value.trim()) {
      if (results !== null) {
        setAnnouncement("Lookup results cleared.");
      }
      setResults(null);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const tokens = tokenizeAktrCodes(input);
    if (tokens.length === 0) {
      setResults(null);
      setAnnouncement("No codes entered.");
      return;
    }

    const groups = findAcsStudyMaterialLinks({
      codes: tokens,
      materials,
      aiStudySets,
      practiceTests,
      instructorQuestions: questions,
    });
    setResults(groups);

    let currentCount = 0;
    let archivedCount = 0;
    let notFoundCount = 0;

    for (const g of groups) {
      if (g.status === "current") {
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
                if (group.status === "current") {
                  return (
                    <div
                      key={group.code}
                      className="acs-code-result-item"
                      data-testid={`acs-code-result-${group.code}`}
                    >
                      <div>
                        <strong>{group.code}</strong>
                        {group.entry.description ? (
                          <span className="dim"> — {group.entry.description}</span>
                        ) : null}
                      </div>

                      {group.materials.length === 0 ? (
                        <p className="dim small" style={{ margin: "var(--space-1) 0 0 0" }}>
                          No tagged study materials exist for this topic code.
                        </p>
                      ) : (
                        <ul style={{ margin: "var(--space-2) 0 0 0", paddingLeft: "var(--space-4)" }}>
                          {group.materials.map((matLink) => {
                            const counts: string[] = [];
                            if (matLink.aiStudySets.length > 0) {
                              counts.push(
                                `${matLink.aiStudySets.length} study guide${
                                  matLink.aiStudySets.length === 1 ? "" : "s"
                                }/set${matLink.aiStudySets.length === 1 ? "" : "s"}`,
                              );
                            }
                            if (matLink.practiceTests.length > 0) {
                              counts.push(
                                `${matLink.practiceTests.length} practice test${
                                  matLink.practiceTests.length === 1 ? "" : "s"
                                }`,
                              );
                            }
                            if (matLink.instructorQuestions.length > 0) {
                              counts.push(
                                `${matLink.instructorQuestions.length} instructor question${
                                  matLink.instructorQuestions.length === 1 ? "" : "s"
                                }`,
                              );
                            }

                            return (
                              <li key={matLink.material.id}>
                                <Link to={`/study/${matLink.material.id}`}>
                                  {matLink.material.title}
                                </Link>
                                {counts.length > 0 ? (
                                  <span className="dim small"> ({counts.join(", ")})</span>
                                ) : null}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  );
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
                        {group.entry.description ? (
                          <span className="dim"> — {group.entry.description}</span>
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
