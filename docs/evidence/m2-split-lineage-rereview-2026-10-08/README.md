# Split lineage independent round-one correction re-review

Planning/proof only. See `../../M2_SPLIT_LINEAGE_SCOPE_REREVIEW_2026-10-08.md` and the round-two assignment. Four new assertions fail; two controls pass. Corrected15-case proof, frozen 7-case import-forwarded diagnostic and actual 4-mutation driver pass. Submitted source has not been accepted for production.

`submitted/` holds exact submitted document bytes; `submitted-manifest.json` freezes those six paths and all 19 correction-pack files as paths relative to the implementation checkout. The correction pack is published byte-for-byte alongside this review. Its source hashes describe the submitted checkout, not main's tracking/banners. Original 9 and first reviewer 20 checksums remain intact.

Independent runs used an isolated `/tmp/m2-lineage-rereview` layout containing the submitted packs and shipped migrations, with Node22 PATH. Commands (one receipt per command; exits retained):

- `node --test docs/evidence/m2-split-lineage-scope-corrections-2026-10-08/proof/proof.test.mjs` -> proof.txt/.exit
- `node --import ./docs/evidence/m2-split-lineage-scope-corrections-2026-10-08/diagnostics/forwardingAdapter.mjs --test docs/evidence/m2-split-lineage-review-2026-10-08/diagnostics/lineage-review.test.mjs` -> frozen.txt/.exit
- `node docs/evidence/m2-split-lineage-scope-corrections-2026-10-08/proof/mutationChecks.mjs` -> mutations.txt/.exit (only in an isolated copy; submitted driver mutates adjacent files)
- `node --test review.test.mjs` -> review.txt/.exit; published identical assertions with an import adjusted to repository evidence layout at `diagnostics/lineage-round2.test.mjs`.

No application/native full suite, physical installed test or future schema13 native validator run is claimed. Synthetic temporary files only. Prior accepted C2 remains intact. Raw TAP receipts intentionally preserve whitespace.
