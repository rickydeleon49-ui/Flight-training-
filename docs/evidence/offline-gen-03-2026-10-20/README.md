# GEN-03 source evidence

Synthetic data only. Browser parity uses real sql.js persistence and repositories,
GEN-01 kit projection/provenance writers and 03b create/edit writers. Native tests
consume the exact operation fixtures checked against the TypeScript exporter.
No real PDF, packet, profile, provider, key, installer or release was used.

`failing-first-packet-runner.txt` records five actual failures: PDF labels were
appended to content and the packet falsely said “on this Mac”. Seven other cases
passed as parity proof; they were not invented regressions. The first Vite attempt
failed at sandbox temp-file creation; later Vite runs use the permitted runner loader.
`failing-first-ui.txt` includes one real disclaimer gap and one faulty test query
(input textContent instead of its label). The query was corrected; its failure is
not evidence of a product defect. `focused-frontend.txt` preserves that intermediate
query failure. `focused-frontend-final.txt` passes all 161 cases at that stage.
`typecheck-initial.txt` exposed an inferred UUID parameter type in the new test;
its explicit string annotation is corrected. `focused-native.txt` matched zero
tests because the Rust module is named save_tests; `focused-native-save.txt`
actually runs all 54 native save cases. Neither zero-test success nor a sandbox
failure is counted as passing product evidence.

The shared fixtures intentionally retain v1's normalization. No TS/native storage
normalization mismatch was demonstrated, so neither validator was changed.
Counts and stored/imported labels are checked after a durable reopen. Source claims
in source.note are preview-only under v1; the sender disclosure is not trusted or
converted into machine provenance. Per-item identities/origins, PDF provenance,
PDF bytes/page links, history and generation state do not travel. Source notes in
the guide do travel; study text is no longer rewritten to append labels.

Commit-before-ack tests drop the result and reopen the database before replaying
the same prepared operation identity; they do not claim that the in-memory import
preview is restored after restarting the UI. A deliberate later import from a new
preview still creates a new material. The how-to tells her to check the Library
after closing the app before importing again.

The schema-14 helper's sandbox pgrep failure is preserved for the reviewer's
required outside-sandbox rerun. See the round report and gate inventory for exact
exits and test counts. Claude owns independent testing, mutation checks, browser
walkthrough, CI, committing and merging. Everything is left uncommitted.
