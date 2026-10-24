import { describe, expect, it } from "vitest";
import {
  PRIVATE_AIRPLANE_ACS_6C_SOURCE,
  resolvePrivateAirplaneAcsEdition,
} from "./aktrAcsEdition";

const privateAirplane = { certificate: "Private Pilot", category: "Airplane" };

describe("Private Airplane AKTR ACS edition resolution", () => {
  it("supports 6C on its effective date and includes FAA source metadata", () => {
    expect(resolvePrivateAirplaneAcsEdition({ ...privateAirplane, testDate: "2024-05-31" })).toEqual({
      status: "current",
      source: PRIVATE_AIRPLANE_ACS_6C_SOURCE,
    });
    expect(PRIVATE_AIRPLANE_ACS_6C_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      published: "2024-04",
      effectiveFrom: "2024-05-31",
      verifiedThrough: "2026-10-23",
      indexUrl: "https://www.faa.gov/training_testing/testing/acs",
    });
  });

  it("keeps dates before the supported edition unresolved", () => {
    expect(resolvePrivateAirplaneAcsEdition({ ...privateAirplane, testDate: "2024-05-30" })).toEqual({
      status: "unresolved",
      reason: "before-supported-edition",
      testDate: "2024-05-30",
    });
  });

  it("resolves later verified dates to the current 6C source", () => {
    expect(
      resolvePrivateAirplaneAcsEdition({ ...privateAirplane, testDate: "2026-10-23" }),
    ).toMatchObject({
      status: "current",
      source: { document: "FAA-S-ACS-6C", effectiveFrom: "2024-05-31" },
    });
  });

  it("leaves dates after the FAA edition was last verified unresolved", () => {
    expect(resolvePrivateAirplaneAcsEdition({ ...privateAirplane, testDate: "2026-10-24" })).toEqual({
      status: "unresolved",
      reason: "after-verified-range",
      testDate: "2026-10-24",
    });
  });

  it.each(["2024-02-30", "2024-5-31", "not-a-date"])(
    "rejects invalid calendar date %s",
    (testDate) => {
      expect(resolvePrivateAirplaneAcsEdition({ ...privateAirplane, testDate })).toEqual({
        status: "unresolved",
        reason: "invalid-test-date",
        testDate,
      });
    },
  );

  it("keeps a missing test date unresolved", () => {
    expect(resolvePrivateAirplaneAcsEdition(privateAirplane)).toEqual({
      status: "unresolved",
      reason: "missing-test-date",
    });
  });

  it.each([
    { certificate: "Commercial Pilot", category: "Airplane" },
    { certificate: "Private Pilot", category: "Rotorcraft" },
  ])("does not infer an edition outside the supported scope: $certificate / $category", (scope) => {
    expect(resolvePrivateAirplaneAcsEdition({ ...scope, testDate: "2026-10-22" })).toEqual({
      status: "unresolved",
      reason: "unsupported-scope",
      testDate: "2026-10-22",
    });
  });
});
