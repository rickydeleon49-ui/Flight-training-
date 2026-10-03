# Codex review evidence — Mac A2 preparation, 3 October 2026

Scope: independent review of Claude's prepared diagnostic observations. No matching A2 source or API was executed.

- `oracle-review.mjs.txt`: reviewer reproduction. Extracts the reviewed fullState function through the installed TypeScript compiler and applies it to synthetic in-memory node:sqlite datasets. Three assertions confirm PREP-R1–R3 counterexamples. QT-02 invocation order is preserved; the synthetic save has asynchronous preparation before joining a FIFO queue. QT-11's saved-branch assertion is mirrored explicitly.
- `oracle-review.json`: independent Node 22.23.3 receipt, exit 0. The embedded hash identifies the reviewed diagnostic.
- `reviewed-hashes.txt`: all nine handoff hashes verified before any correction.
- The raw-engine probe was independently rerun; parsed JSON exactly matched Claude's existing receipt. No duplicate 1,259-line receipt is included.

Run the historical reproduction from a checkout containing the original reviewed diagnostic and TypeScript dependency:

```sh
cp docs/evidence/mac-a2-preparation-review-2026-10-03/oracle-review.mjs.txt /private/tmp/a2-oracle-review.mjs
PATH="/opt/homebrew/opt/node@22/bin:$PATH" node --no-warnings /private/tmp/a2-oracle-review.mjs
```

That original diagnostic remains unpublished local work; it must match SHA-256 `1902070e7136310b74d6bdc6bd53999516c6b88fc85703d5070b13bc0b6d4b4f`. A future corrected helper requires new positive/negative oracle checks, not treating this old counterexample script as its acceptance test.

Codex inspected, but did not repeat, Claude's raw main-baseline logs: 53 frontend and 44 native documents tests passed. No full matrix, APFS capability image, installation or live provider request was performed in this review.
