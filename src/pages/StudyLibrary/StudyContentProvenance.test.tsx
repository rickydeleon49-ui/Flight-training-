// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as platform from "@/services/platform";
import { StudyContentProvenance } from "./StudyContentProvenance";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it.each([true, false])("PDF provenance uses the device's saved wording (phone=%s)", (phone) => {
  const capabilities = platform.deviceCan();
  vi.spyOn(platform, "deviceCan").mockReturnValue({ ...capabilities, revealFiles: !phone });
  render(<StudyContentProvenance sourceMaterialTitle="Synthetic handbook" kind="study-aid" content={{
    provider: "manual", summary: "Synthetic summary",
    summaryPdfProvenance: { status: "valid", label: "Pulled from your PDF on this Mac", sources: [] },
  }} />);
  expect(screen.getByText(phone ? "Saved on this phone" : "Saved on this computer")).toBeTruthy();
  expect(screen.queryByText(phone ? "Saved on this computer" : "Saved on this phone")).toBeNull();
});
