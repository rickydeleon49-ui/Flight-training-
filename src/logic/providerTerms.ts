import type { ProviderId } from "@/services/provider";

const googleReuseDuration = "48 hours";
const googleRetention = `up to ${googleReuseDuration}`;
const anthropicRetention = "how long Anthropic keeps your files, and whether they are used for training, is set by Anthropic's own terms and privacy policy.";

/** Dated summaries of provider terms. Review these when the terms change. */
export const PROVIDER_TERMS = {
  gemini: {
    company: "Google",
    asOf: "Nov 2026",
    reviewed: "8 November 2026",
    termsUrl: "https://ai.google.dev/gemini-api/terms",
    fileCopy: `Google may keep a temporary copy (currently ${googleRetention}, see Google's terms) so a study guide and a practice test can use it without uploading it again.`,
    reuse: `if Google already has a copy from the last ${googleReuseDuration}, that copy is used instead`,
    setupFreeTier: "Google states that free-tier content may be used to improve its products, and its terms require you to be 18 or older.",
    freeTier: "On the free tier Google may use it to improve its products, so send study material only — never anything personal or identifying.",
    help: `Google may keep a copy of the PDF (currently ${googleRetention}) so it doesn't have to be sent again. On the free tier Google may use it to improve its products, so send study material only. Retention can change; see Google's terms.`,
  },
  claude: {
    company: "Anthropic",
    asOf: "Nov 2026",
    reviewed: "8 November 2026",
    termsUrl: "https://www.anthropic.com/legal/commercial-terms",
    privacy: `Anthropic: ${anthropicRetention}`,
    help: `Anthropic: ${anthropicRetention} Send study material only.`,
  },
} as const;

/** Plain-text reference for disclosures that do not render links. */
export function providerTermsNote(id: ProviderId): string {
  const terms = PROVIDER_TERMS[id];
  return `(last reviewed ${terms.reviewed}; see ${terms.company}'s terms)`;
}
