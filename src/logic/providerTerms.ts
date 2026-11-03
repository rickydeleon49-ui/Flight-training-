import type { ProviderId } from "@/services/provider";

const googleReuseDuration = "48 hours";
const googleRetention = `up to ${googleReuseDuration}`;
const anthropicRetention = "your files are not used for training and are deleted within 30 days.";

/** Dated summaries of provider terms. Review these when the terms change. */
export const PROVIDER_TERMS = {
  gemini: {
    company: "Google",
    asOf: "Nov 2026",
    termsUrl: "https://ai.google.dev/gemini-api/terms",
    fileCopy: `Google keeps a temporary copy for ${googleRetention} so a study guide and a practice test can use it without uploading it again.`,
    reuse: `if Google already has a copy from the last ${googleReuseDuration}, that copy is used instead`,
    setupFreeTier: "Google states that free-tier content may be used to improve its products.",
    freeTier: "On the free tier Google may use it to improve its products, so send study material only — never anything personal or identifying.",
    help: `Google keeps a copy of the PDF for ${googleRetention}, so it doesn't have to be sent again. On the free tier Google may use it to improve its products, so send study material only.`,
  },
  claude: {
    company: "Anthropic",
    asOf: "Nov 2026",
    termsUrl: "https://www.anthropic.com/legal/commercial-terms",
    privacy: `Anthropic: ${anthropicRetention}`,
    help: `Anthropic says ${anthropicRetention} Send study material only.`,
  },
} as const;

/** Plain-text reference for disclosures that do not render links. */
export function providerTermsNote(id: ProviderId): string {
  const terms = PROVIDER_TERMS[id];
  return `(as of ${terms.asOf}; see ${terms.company}'s terms)`;
}
