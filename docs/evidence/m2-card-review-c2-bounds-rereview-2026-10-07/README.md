# Independent bounded-read corrections re-review

Review baseline main 280dd24b263e57324e282169d31c842122f2a9a5; original dirty implementation HEAD 9028675475616ce338253ae7e4e46ba6b840b72c unchanged.

See [review](../../M2_CARD_REVIEW_C2_BOUNDS_REREVIEW_2026-10-07.md) and [one active correction assignment](../../M2_CARD_REVIEW_C2_CONTRACT_FINISH_PROMPT_2026-10-07.md).

- submitted-source-hashes.json: exact 40-path bare manifest, verified before review and publication.
- submitted/: four exact live delivery-document snapshots; sixth submitted evidence pack published separately byte-identical.
- receipts/checksums.txt/.exit: all 36 submitted evidence checksums pass.
- receipts/review, rereview, completion-review, final-review, pipeline-review (.txt/.exit): five frozen files unchanged, 9/12/16/11/8 pass.
- receipts/submitted-proof.txt/.exit: 40/40 passes, including baseline and four assertion-killed mutants.
- receipts/survival-control.txt/.exit: verifier rejects assertion-disabled survivor as expected.
- diagnostic.test.mjs and receipts/diagnostic.txt/.exit: new frozen file, 1 supported-state control pass / 10 assertion failures, exit 1. Set C2_REVIEW_MODEL to reviewed/final contractModel.mjs. Valid escaped 500-card fixture is 9,020,501 bytes; history transfers it despite absolute 8-MiB cap. Mixed-size initial/pending fixtures parse 900 cards under 600-card requests.
- receipts/query-audit.json/.txt/.exit and query-audit-run.txt/.exit: independently executed audit, only output destination adapted. Actual SQL counts due 218/150/216; history 22/22/22.
- receipts/results.json: independent gate exits; diagnostic failure receipt separately records expected exit 1.

All commands used /opt/homebrew/opt/node@22/bin/node --experimental-strip-types, from repository root. Original submitted stdout/commands/toolchain are preserved separately. Mutation tool outputs were captured in reviewer receipts and the review copy of the submitted pack restored byte-for-byte afterward. Synthetic disposable databases only; no app/profile/provider/native/installed/signing/release activity. No production helper/migration changes. Prior six evidence packs are byte-identical.
