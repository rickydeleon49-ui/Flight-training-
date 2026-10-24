// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { StudyMaterial } from "@/domain/types";
import { PRIVATE_AIRPLANE_ACS_AREAS } from "@/logic/acsAreaMaterialCoverage";
import { AcsAreaMaterialCoveragePanel } from "./AcsAreaMaterialCoveragePanel";

function createMockMaterial(id: string, tags: string[]): StudyMaterial {
  return {
    id,
    title: `Material ${id}`,
    materialType: "study_guide",
    topic: "general",
    reviewStatus: "needs_review",
    priority: "later",
    goalId: null,
    eventId: null,
    notes: "",
    filePath: null,
    originalFileName: null,
    fileSize: null,
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
    lastReviewedAt: null,
    tags,
  };
}

describe("AcsAreaMaterialCoveragePanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders accessible disclosure collapsed by default and expands on click", () => {
    render(<AcsAreaMaterialCoveragePanel materials={[]} />);

    const details = document.querySelector("details.acs-area-material-coverage-details") as HTMLDetailsElement;
    expect(details).toBeTruthy();
    expect(details.open).toBe(false);

    const summary = screen.getByText(/see counts by acs area/i);
    expect(summary).toBeTruthy();

    fireEvent.click(summary);
    expect(details.open).toBe(true);
  });

  it("displays all twelve areas in canonical order with authoritative labels and exact counts", () => {
    // PA.I.A.K1 is in Area I
    // PA.II.A.K1 is in Area II
    const mat1 = createMockMaterial("m1", ["PA.I.A.K1", "PA.I.A.K2"]);
    const mat2 = createMockMaterial("m2", ["PA.I.A.K1"]);
    const mat3 = createMockMaterial("m3", ["PA.II.A.K1"]);

    render(<AcsAreaMaterialCoveragePanel materials={[mat1, mat2, mat3]} />);

    const list = screen.getByTestId("acs-coverage-list");
    expect(list).toBeTruthy();

    // Verify all 12 areas exist in exact order
    const areaItems = PRIVATE_AIRPLANE_ACS_AREAS.map((area) =>
      screen.getByTestId(`acs-coverage-area-${area}`)
    );
    expect(areaItems).toHaveLength(12);

    // Verify canonical order in DOM
    const renderedItems = screen.getAllByTestId(/^acs-coverage-area-/);
    expect(renderedItems.map((el) => el.getAttribute("data-testid"))).toEqual(
      PRIVATE_AIRPLANE_ACS_AREAS.map((area) => `acs-coverage-area-${area}`)
    );

    // Area I: PA.I.A.K1 and PA.I.A.K2 matched (2 codes), across m1 and m2 (2 materials)
    const areaI = screen.getByTestId("acs-coverage-area-I");
    expect(areaI.textContent).toContain("Area of Operation I: Preflight Preparation");
    expect(areaI.textContent).toMatch(/2 of \d+ current ACS codes have tagged study materials across 2 materials\./);

    // Area II: PA.II.A.K1 matched (1 code), across m3 (1 material)
    const areaII = screen.getByTestId("acs-coverage-area-II");
    expect(areaII.textContent).toContain("Area of Operation II: Preflight Procedures");
    expect(areaII.textContent).toMatch(/1 of \d+ current ACS codes have tagged study materials across 1 material\./);

    // Area III: 0 matched
    const areaIII = screen.getByTestId("acs-coverage-area-III");
    expect(areaIII.textContent).toContain("Area of Operation III: Airport and Seaplane Base Operations");
    expect(areaIII.textContent).toMatch(/0 of \d+ current ACS codes have tagged study materials across 0 materials\./);
  });

  it("displays neutral explanatory copy regarding tagged-material availability only", () => {
    render(<AcsAreaMaterialCoveragePanel materials={[]} />);

    const explanation = screen.getByTestId("acs-coverage-explanation");
    expect(explanation.textContent).toBe(
      "These counts show which study materials have ACS tags. They do not show what you have studied or how you are doing."
    );

    const panel = document.querySelector(".acs-area-material-coverage-panel");
    expect(panel).toBeTruthy();
    expect(panel?.querySelector('[role="progressbar"]')).toBeNull();
    expect(panel?.querySelector(".badge")).toBeNull();
    expect(panel?.textContent).not.toContain("%");
  });

  it("displays zero-tag state when there are zero tagged matches across all areas", () => {
    const untaggedMaterial = createMockMaterial("m-untagged", ["NON_ACS_TAG"]);
    render(<AcsAreaMaterialCoveragePanel materials={[untaggedMaterial]} />);

    const zeroMsg = screen.getByTestId("acs-coverage-zero-tags");
    expect(zeroMsg.textContent).toBe("No study materials have these ACS tags.");
  });

  it("does not show zero-tag state when at least one ACS tag is matched", () => {
    const taggedMaterial = createMockMaterial("m-tagged", ["PA.I.A.K1"]);
    render(<AcsAreaMaterialCoveragePanel materials={[taggedMaterial]} />);

    expect(screen.queryByTestId("acs-coverage-zero-tags")).toBeNull();
  });
});
