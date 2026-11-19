/** FAA source facts for the supported Private Pilot Airplane ACS edition. */
export const PRIVATE_AIRPLANE_ACS_6C_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  published: "2024-04",
  effectiveFrom: "2024-05-31",
  verifiedThrough: "2026-11-19",
  indexUrl: "https://www.faa.gov/training_testing/testing/acs",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export type PrivateAirplaneAcsEditionResolution =
  | {
      status: "current";
      source: typeof PRIVATE_AIRPLANE_ACS_6C_SOURCE;
      /** Set when the test date is after the last FAA check; show acsCheckedNote(). */
      checkedThrough?: string;
    }
  | {
      status: "unresolved";
      reason:
        | "unsupported-scope"
        | "missing-test-date"
        | "invalid-test-date"
        | "before-supported-edition";
      testDate?: string;
    };

export interface PrivateAirplaneAcsEditionInput {
  certificate: string;
  category: string;
  testDate?: string | null;
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Soft note for the UI when the test date is after the last FAA check. */
export function acsCheckedNote(
  r: PrivateAirplaneAcsEditionResolution,
): string | null {
  if (r.status !== "current" || !r.checkedThrough) return null;
  return `Checked against ${r.source.document} as of ${r.checkedThrough}. Confirm it is still current.`;
}

/**
 * Resolve dates on or after the 6C effective date. Dates after the last
 * check still resolve to 6C with a checkedThrough flag. Older test dates and unsupported certificate/category combinations stay unresolved.
 */
export function resolvePrivateAirplaneAcsEdition(
  input: PrivateAirplaneAcsEditionInput,
): PrivateAirplaneAcsEditionResolution {
  if (input.certificate !== "Private Pilot" || input.category !== "Airplane") {
    return {
      status: "unresolved",
      reason: "unsupported-scope",
      ...(input.testDate ? { testDate: input.testDate } : {}),
    };
  }
  if (input.testDate == null || input.testDate === "") {
    return { status: "unresolved", reason: "missing-test-date" };
  }
  if (!isCalendarDate(input.testDate)) {
    return { status: "unresolved", reason: "invalid-test-date", testDate: input.testDate };
  }
  if (input.testDate < PRIVATE_AIRPLANE_ACS_6C_SOURCE.effectiveFrom) {
    return { status: "unresolved", reason: "before-supported-edition", testDate: input.testDate };
  }
  if (input.testDate > PRIVATE_AIRPLANE_ACS_6C_SOURCE.verifiedThrough) {
    return {
      status: "current",
      source: PRIVATE_AIRPLANE_ACS_6C_SOURCE,
      checkedThrough: PRIVATE_AIRPLANE_ACS_6C_SOURCE.verifiedThrough,
    };
  }
  return { status: "current", source: PRIVATE_AIRPLANE_ACS_6C_SOURCE };
}
