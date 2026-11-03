import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { ProviderId } from "@/services/provider";
import { PROVIDER_TERMS, providerTermsNote } from "./providerTerms";
import { PRIVACY_HELP } from "@/pages/StudyLibrary/StudyHowTo";

it("gives every provider a date and official HTTPS terms URL", () => {
  const urls: Record<ProviderId, string> = {
    gemini: "https://ai.google.dev/gemini-api/terms",
    claude: "https://www.anthropic.com/legal/commercial-terms",
  };
  expect(Object.keys(PROVIDER_TERMS).sort()).toEqual(Object.keys(urls).sort());
  for (const id of Object.keys(urls) as ProviderId[]) {
    expect(PROVIDER_TERMS[id].asOf).toBe("Nov 2026");
    expect(PROVIDER_TERMS[id].termsUrl).toBe(urls[id]);
    expect(new URL(PROVIDER_TERMS[id].termsUrl).protocol).toBe("https:");
  }
});

it("dates and references the Study Library's provider summaries", () => {
  const note = PRIVACY_HELP.flatMap(group => group.notes).find(note => note.lead === "What {company} keeps")!;
  expect(note.text).toContain(providerTermsNote("gemini"));
  expect(note.claude).toContain(providerTermsNote("claude"));
});

it("keeps retention durations out of all other non-test src files", () => {
  const root = join(__dirname, "..");
  const offenders = readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter(file => !/(^|\/)(__tests__|__snapshots__)(\/|$)|\.(test|spec)\.|\.snap$/.test(file))
    .filter(file => file !== "logic/providerTerms.ts")
    .filter(file => statSync(join(root, file)).isFile())
    .filter(file => /48 hours|within 30 days/.test(readFileSync(join(root, file), "utf8")));
  expect(offenders).toEqual([]);
});
