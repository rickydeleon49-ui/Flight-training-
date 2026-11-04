import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { CLAUDE_PRIVACY } from "@/services/provider";
import { PRIVACY_HELP } from "@/pages/StudyLibrary/StudyHowTo";
// @ts-expect-error plain .mjs script without type declarations
import { renderPrivacyHtml } from "../../scripts/build-privacy-page.mjs";
import { PRIVACY_POLICY_URL } from "./privacyPolicy";

const root = join(__dirname, "..", "..");
const policy = readFileSync(join(root, "PRIVACY.md"), "utf8");
const flat = policy.replace(/\s+/g, " ");

describe("privacy policy", () => {
  it("is published at the one exported https address", () => {
    expect(PRIVACY_POLICY_URL).toMatch(/^https:\/\/[a-z0-9-]+\.github\.io\/.+\/privacy\/$/);
    const workflow = readFileSync(join(root, ".github", "workflows", "pages.yml"), "utf8");
    expect(workflow).toContain("node scripts/build-privacy-page.mjs _site");
    expect(workflow).toMatch(/path: _site\n/);
  });

  it("names every host the app's native code contacts", () => {
    const dir = join(root, "src-tauri", "src");
    const files = readdirSync(dir, { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(".rs") && !/(_tests|tests|fake_\w+)\.rs$/.test(f));
    const hosts = new Set<string>();
    for (const f of files) {
      const code = readFileSync(join(dir, f), "utf8").split("#[cfg(test)]")[0]!;
      for (const m of code.matchAll(/"https:\/\/([a-z0-9.-]+)[/"?]/g)) hosts.add(m[1]!);
    }
    expect([...hosts].sort()).toEqual(
      ["api.anthropic.com", "aviationweather.gov", "generativelanguage.googleapis.com", "www.faa.gov"],
    );
    for (const host of hosts) expect(policy).toContain(host);
  });

  it("repeats the in-app retention and sending claims", () => {
    expect(CLAUDE_PRIVACY).toContain("not used for training and are deleted within 30 days");
    expect(flat).toContain("your files are not used for training and are deleted within 30 days");
    const notes = PRIVACY_HELP.flatMap((g) => g.notes);
    expect(notes.find((n) => n.lead === "What {company} keeps")!.text).toContain("up to 48 hours");
    expect(flat).toContain("PDF for up to 48 hours");
    expect(notes.find((n) => n.lead === "Never sent")!.text).toContain("your personal notes, flight logs, profile and other library files");
    expect(flat).toContain("Never sent: your personal notes, flight log, profile and other library files");
  });

  it("states the age rules and the honest key storage", () => {
    expect(flat).toContain("aged 13 and over");
    expect(flat).toContain("18 or over");
    expect(flat).toContain("plain text file");
    expect(flat).toContain("never included in a backup");
    expect(flat).toContain("no analytics");
  });

  it("renders to a standalone HTML page with every section", () => {
    const html: string = renderPrivacyHtml(policy);
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain("<title>Your Flight Deck privacy policy</title>");
    for (const [, heading] of policy.matchAll(/^#{2,3} (.+)$/gm)) {
      expect(html).toContain(`>${heading!.replace(/&/g, "&amp;")}</h`);
    }
    expect(html).toContain('<a href="https://github.com/rickydeleon49-ui/Flight-training-/issues">');
    expect(html).not.toMatch(/<script/i);
  });
});
