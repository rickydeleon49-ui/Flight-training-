// @vitest-environment jsdom
/** POLISH-1111: the data-folder note is one short plain line, not an "On macOS:" paragraph. */
import { createElement as h } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/services/backups", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/backups")>();
  return { ...actual, backupsAvailable: () => true, dataDirectory: () => Promise.resolve("/tmp/hfd"), listBackups: () => Promise.resolve([]) };
});
const { DataRecovery } = await import("./DataRecovery");
afterEach(cleanup);

it("keeps the data folder note short and without platform labels", async () => {
  render(h(DataRecovery, { error: "x" } as never));
  const note = await screen.findByText(/Copy this whole folder somewhere safe first/);
  expect(note.textContent).toMatch(/Open folder shows it in /);
  expect(note.textContent!.length).toBeLessThan(110);
  expect(document.body.textContent).not.toContain("On macOS:");
  expect(document.body.textContent).not.toContain("Application Support folder");
});
