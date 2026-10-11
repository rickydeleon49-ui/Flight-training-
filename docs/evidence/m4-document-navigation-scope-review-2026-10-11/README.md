# Independent M4 scope review

**CORRECTIONS REQUIRED: M4-R1–R4.** Subject was read only. 19 submitted paths frozen; all 16 original evidence checksums verify. The 7 submitted Node tests pass; new diagnostics reproduce 8 failures with 2 controls passing. The candidate DDL loads into a disposable schema-13 SQLite database, but identity replacement leaves bookmark/reading state with no originating content hash or invalidation state; malformed hashes are accepted.

`submitted/` contains the exact unaccepted submission; `submitted-hashes.json` is relative to that folder. Do not treat its historical local links, claims or implementation prompt as accepted guidance.

Commands: from this directory, `node --test diagnostics.test.mjs` (expected exit 1, 8 failures / 2 controls). Run the original suite from `submitted/` with `node --test docs/evidence/m4-document-navigation-eval-2026-10-11/proof/proof.test.mjs` (exit 0, 7 passed). `python3 schema-probe.py /Users/rickymac/code/Flight-training-m4-viewer-evaluation` demonstrates the DDL issue in memory only. The probe never modifies the subject or registers a migration.

The npm metadata files are exact-version registry responses. MIT metadata for EmbedPDF 2.15.1 is corroborated; this review does not replace it with the moving main branch's different license. Package contents/transitives still require inspection. Sources: [React-PDF documentation](https://raw.githubusercontent.com/wojtekmaj/react-pdf/main/packages/react-pdf/README.md), [Safari 17.4 features](https://webkit.org/blog/15063/webkit-features-in-safari-17-4/), [EmbedPDF current licensing scope](https://raw.githubusercontent.com/embedpdf/embed-pdf-viewer/main/LICENSING.md), [PDFium licensing](https://pdfium.googlesource.com/pdfium/+/refs/heads/main/LICENSE). No viewer was loaded by the submitted proof.

New output copies normalize trailing display whitespace and surplus final blank lines for whitespace hygiene; original scratch outputs and submitted evidence remain unchanged. Frozen PDFs retain required xref padding and the original Markdown retains its hard-break spacing. Check `SHA256SUMS` here for all review-pack files except itself.
