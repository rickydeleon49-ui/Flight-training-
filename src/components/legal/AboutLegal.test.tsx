// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";
import { expectNoA11yViolations } from "@/testing/a11y";
import { ACK_BODY, ACK_BUTTON, ACK_TITLE, AGE_NOTE, LEGAL_ACK_KEY, LEGAL_POINTS, NOTICES_MISSING } from "@/logic/legal";
import { AboutLegal, LegalAcknowledgement, loadNotices } from "./AboutLegal";

let db: TestDatabase;
vi.mock("@/data", async (original) => ({ ...(await original<typeof import("@/data")>()), getDatabase: () => Promise.resolve(db), isTauri: () => false }));

function respond(body: string, ok = true) {
  return vi.fn().mockResolvedValue({ ok, text: async () => body } as Response);
}
beforeEach(async () => { localStorage.clear(); db = await createNodeSqliteDatabase(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); db.close(); });

describe("About & legal", () => {
  it("shows version, every safety point, age note, MIT license link and no a11y violations", async () => {
    const { container } = render(<AboutLegal version="0.6.7" />);
    expect(screen.getByText("Your Flight Deck · Version 0.6.7")).toBeTruthy();
    for (const point of LEGAL_POINTS) expect(screen.getByText(point)).toBeTruthy();
    expect(screen.getByText(AGE_NOTE)).toBeTruthy();
    expect(screen.getByRole("link", { name: "MIT License" }).getAttribute("href")).toMatch(/\/LICENSE$/);
    expect(LEGAL_POINTS.join(" ")).toMatch(/not flight instruction/);
    expect(LEGAL_POINTS.join(" ")).toMatch(/not an official weather briefing/);
    expect(LEGAL_POINTS.join(" ")).toMatch(/without warranty/);
    await expectNoA11yViolations(container);
  });

  it("renders the bundled notices file when you open Licenses", async () => {
    vi.stubGlobal("fetch", respond("Third-party notices\ndiff 9.0.0 BSD-3-Clause"));
    render(<AboutLegal version="" />);
    fireEvent.click(screen.getByRole("button", { name: "Show third-party licenses" }));
    expect((await screen.findByLabelText("Third-party licenses")).textContent).toContain("diff 9.0.0");
    expect(screen.getByRole("button", { name: "Hide third-party licenses" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("says so plainly when the notices file is missing", async () => {
    vi.stubGlobal("fetch", respond("", false));
    render(<AboutLegal version="" />);
    fireEvent.click(screen.getByRole("button", { name: "Show third-party licenses" }));
    expect(await screen.findByText(NOTICES_MISSING)).toBeTruthy();
  });

  it("treats a network error or an HTML fallback page as missing", async () => {
    expect(await loadNotices(vi.fn().mockRejectedValue(new Error("offline")))).toBeNull();
    expect(await loadNotices(respond("<!doctype html><html></html>"))).toBeNull();
  });

  it("the notices file exists in public/ so the build bundles it", () => {
    expect(readFileSync(join(process.cwd(), "public/THIRD_PARTY_NOTICES.txt"), "utf8").length).toBeGreaterThan(0);
  });
});

const ackOpen = () => screen.queryByText(ACK_BODY)?.closest("dialog")?.hasAttribute("open") ?? false;
function Ready() {
  return useAppData().status === "ready" ? <LegalAcknowledgement /> : null;
}

describe("first-launch acknowledgement", () => {
  it("shows once, stores the flag in app settings, and is not shown again", async () => {
    const first = render(<AppDataProvider><Ready /></AppDataProvider>);
    await vi.waitFor(() => expect(ackOpen()).toBe(true));
    expect(screen.getByText(ACK_TITLE).tagName).toBe("H2");
    const button = await screen.findByRole("button", { name: ACK_BUTTON });
    await act(async () => { fireEvent.click(button); });
    expect(ackOpen()).toBe(false);
    const stored = await db.select<{ value: string }>("SELECT value FROM app_metadata WHERE key = ?", [LEGAL_ACK_KEY]);
    expect(stored[0]?.value).toBeTruthy();
    first.unmount();

    render(<AppDataProvider><Ready /></AppDataProvider>);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(ackOpen()).toBe(false);
  });
});
