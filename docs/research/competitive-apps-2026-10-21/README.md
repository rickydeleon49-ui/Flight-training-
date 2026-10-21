# Competitive app evidence method — 21 October 2026

Read the [report](../../COMPETITIVE_APP_RESEARCH_2026-10-21.md), [Apple metadata](apple-metadata.json), [review observation register](review-observations.json) and [validation receipt](validation.json).

## Collection

The author used public Apple endpoints, without signing in, purchasing, bypassing access controls or contacting users:

- Metadata: `https://itunes.apple.com/lookup?id=<comma-separated numeric IDs>&country=us` (exact request in the metadata file).
- Reviews: `https://itunes.apple.com/us/rss/customerreviews/id=<numeric ID>/sortBy=mostRecent/json` (exact request and UTC retrieval time per app in the observation file).
- For each review-feed response, select entries containing `im:rating`, in returned order, keeping the first eight. Checkride.bot returned none. Fifteen other apps returned eight each. No app's sample was expanded because its initial reviews were favorable/unfavorable.
- Read each selected review completely, then manually assign zero or more defined themes and a short paraphrase. Preserve public review ID, date, version and numeric star value. Do not infer sentiment from stars alone. Thirteen entries yielded insufficient actionable information and remain `low_information`.
- This is a single-author coding pass, not an inter-rater study, random sample, verified-purchase survey or automated sentiment model. Chinese/Spanish paraphrases are not independently checked. Theme counts mix praise/complaints/requests and overlap.

The metadata includes 18 app IDs. Sixteen were selected for review feeds; ForeFlight and Obsidian are official-product/context comparisons only. One of those 16 had no textual entries, producing 120 unique observations from 15 apps. The report's separate featured reviews and web discussion examples are not added to that count.

## Privacy, copyright and fidelity

The GitHub evidence omits public handles and complete review bodies. No user was identified/profiled. The author retained only the necessary short paraphrases and provenance in the published register. Full-text working copies remain outside the repo, are not review deliverables and must not be committed. Factual allegations, claimed scores, billing behavior, moderation claims and platform names in reviews are not independently verified facts.

Apple ratings/counts are time/country dependent. The direct lookup can differ from cached product pages. Feed entries can later be changed, removed or reordered. A future reproduction should preserve the original observation file, record a new retrieval time and distinguish content changes from collection errors. There is no promise that these 120 entries will remain the latest eight.

## Validation and review

Validate metadata parsing and unique IDs; exact correspondence of 120 observations to the original selected IDs/dates/versions/stars; unique review IDs; valid taxonomy; counts recomputed from individual observations; no full review bodies/handles; introduced relative links/anchors; whitespace/conflict markers; and documentation-only scope. The report is not an application test, a benchmark, a platform smoke test or a competitor defect reproduction.

Publication is requested by the owner for cross-machine access. Claude independently reviews source attribution, coding choices, priority boundaries and prose; the author must not approve/merge its own round. The existing homework/offline implementation lane and Mac loop files are untouched. Feature implementation remains separately assigned.
