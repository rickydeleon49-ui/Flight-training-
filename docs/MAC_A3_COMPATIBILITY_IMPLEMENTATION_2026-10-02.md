# A3 WebKit compatibility — implementation report, 2 October 2026

**Publication follow-up:** [Codex accepted A3-R1–R4 source and regressions](MAC_A3_COMPATIBILITY_ACCEPTANCE_2026-10-02.md) and committed the reviewed implementation as `66e8178`. The local/uncommitted labels below describe the implementer handoff before that acceptance; required exact-head CI and merge govern publication.

Implements audit finding A3 ([audit](FULL_REPOSITORY_AUDIT_2026-09-29.md#a3--p1-the-declared-macos-120-minimum-exceeds-the-tested-browser-compatibility)) from [Claude's A3 prompt](CLAUDE_MAC_A3_COMPATIBILITY_PROMPT_2026-10-02.md). Source-level correction with capability-removal tests only.

**Revised for Codex's modal-stack review A3-R1–R3** ([review](MAC_A3_COMPATIBILITY_REVIEW_2026-10-02.md), [regressions](MAC_A3_COMPATIBILITY_REVIEW_REGRESSIONS_2026-10-02.md) and [correction prompt](CLAUDE_MAC_A3_CORRECTION_PROMPT_2026-10-02.md), on PR #47 branch `codex/mac-a3-review`); see [the correction section](#codex-review-a3-r1r3-modal-stack-corrections). **Revised again for the re-review's A3-R4** ([re-review](MAC_A3_COMPATIBILITY_REREVIEW_2026-10-02.md), [regression](MAC_A3_NESTED_DIALOG_REVIEW_REGRESSION_2026-10-02.md), [prompt](CLAUDE_MAC_A3_NESTED_DIALOG_CORRECTION_PROMPT_2026-10-02.md)); see [the R4 section](#codex-re-review-a3-r4-nested-fallback-lifetime).

**Limits:** Early macOS 12.0–12.2 WebKit, current installed WKWebView and VoiceOver behavior remain **UNVERIFIED**; these tests cannot close that platform gate. This is the implementer's report, **not Codex acceptance**.

## Identity and ownership

- **Task / date / roles:** A3 browser-API compatibility, 2 October 2026. Implementer: Claude (Mac). Independent reviewer and Git coordinator: Codex. Gemini not assigned.
- **Machine / toolchain:**
  - MacBook Air (Mac17,3), Apple M5, 32 GB, macOS 26.6.
  - Node 22.23.3 / npm 10.9.9 via scoped `PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/opt/rustup/bin:$PATH`; rustc 1.99.0.
  - `SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk` for native checks.
- **Repository / branch / base:** `~/code/Flight-training-`, branch `codex/mac-webkit-compatibility-a3` (upstream unset), created from `origin/main` = `8b61d8766a4aaf6a12443b9c48445ffe8cc43db7` (PR #46 merged). The checkout was on a clean, synchronized `main` before branching.
- **Code availability:** LOCAL UNCOMMITTED. Nothing committed or pushed.
- **Before the R4 correction:** Same branch and HEAD; `origin/main` was still `8b61d87`. Both re-reviewed hashes (`useModalDialog.ts` `7f7d43c4…`, `Dialog.fallback.test.ts` `637a43c2…`) matched. No competing changes.
- **Before the R1–R3 corrections:** Same branch and HEAD; `origin/main` was still `8b61d87`. All 15 reviewed source hashes matched Codex's review exactly. No competing changes.
- **Other owners checked:**
  - No remote or local `*a3*`/`*webkit*` branch existed.
  - A2 (`fix/atomic-study-material-saves`) remains Windows-local and absent from GitHub. No material-save, SQL-driver or attachment-ownership code was touched.

## Platform API decision (primary sources)

| API | First WebKit / macOS evidence | Available on macOS 12.0 WebKit? | Decision |
| --- | --- | --- | --- |
| `structuredClone` | [WebKit: Safari 15.4](https://webkit.org/blog/12445/new-webkit-features-in-safari-15-4/), which lists macOS Monterey 12.3 | No (12.0–12.2) | Narrow `ToolkitState` copy; no polyfill |
| `<dialog>` / `showModal` / `::backdrop` | Same WebKit 15.4 post; Apple [Safari 15.4 release notes](https://developer.apple.com/documentation/safari-release-notes/safari-15_4-release-notes) ("Added support for the `<dialog>` element") | No | Native path kept; shared fallback when `showModal`/`close` are missing |
| `inert` | Apple [Safari 15.5 release notes](https://developer.apple.com/documentation/safari-release-notes/safari-15_5-release-notes) ("Added support for the `inert` attribute") | No | Fallback does not rely on it; the attribute is set as a harmless extra |
| `crypto.randomUUID` | WebKit [bug 229240](https://bugs.webkit.org/show_bug.cgi?id=229240) "Implement Crypto.randomUUID()", landed 2021-08-20 (commit `6cbcdb03d5b4`), after the Safari 15.0 branch. **No Apple release note names the first shipping version** (searched the 14.1, 15, 15.2, 15.4, 15.5, 15.6, 16, 16.1 and 16.4 notes). | Treated as **possibly absent** | Keep native; v4 fallback from `getRandomValues` |
| `crypto.getRandomValues` | WebKit bugs [54342](https://bugs.webkit.org/show_bug.cgi?id=54342) / [54346](https://bugs.webkit.org/show_bug.cgi?id=54346) (2011) and later fixes | Yes | Secure randomness source for the fallback; fail loudly if missing |

The minimum OS (`LSMinimumSystemVersion` 12.0), support policy and build target are unchanged. Transpilation does not supply these APIs, so feature detection is used.

## Codex review A3-R1–R3: modal-stack corrections

The counter-based exclusion and stack-length layering from the first version were replaced by one coherent stack model in `useModalDialog.ts`. Every stack change (open or close, in any order) recomputes the state from the live stack.

| Finding | Correction | Maintained regressions (`Dialog.fallback.test.ts`, "fallback modal stack (Codex A3-R1–R3 regressions)") |
| --- | --- | --- |
| **A3-R1:** Opening sibling dialogs A, then B, then C left B exposed, because an earlier "expose" outweighed later hides. | `reconcileExclusion()` derives the excluded set from the **current top modal only**: the siblings along its path to `<body>`. Everything else, including a modal that used to be on top, returns to its recorded original `aria-hidden`/`inert`. A nested modal's ancestor dialog stays on its path and so stays reachable, while that ancestor's other content is excluded. | "A3-R1: hides the previous sibling modal when a third modal opens" (Codex's diagnostic) · "A3-R1: re-exposes each lower modal as the ones above close, in reverse and out of order" (preserves an original `aria-hidden="false"`) · "A3-R1: keeps a nested modal's own ancestor dialog reachable while hiding the rest" |
| **A3-R2:** `setLayer(stack.length)` reused a live layer after a lower modal closed. With A, then B, A closing, then C, B and C both got 1004, and DOM order decided paint. | Each new modal's layer is **one above the highest layer still open** (`max(live layers) + 1`); its backdrop sits one below it. The new top therefore paints above every survivor regardless of DOM order. Numbering restarts only when no modal is open. | "A3-R2: gives a new top modal a higher layer after a lower modal closed" (Codex's diagnostic, plus backdrop ordering) · "A3-R2: keeps strict paint order across reopening in every DOM order" (A/B/C, C/B/A, B/C/A) |
| **A3-R3:** B's saved focus target could sit inside A after A closed underneath, so focus returned into a closed dialog. | Each entry keeps `restoreTo`. When any modal closes, modals still open whose target lies inside it **inherit its target**, which forms the restoration chain. Only the closing *top* modal moves focus, and only to a target that is connected, not in the closing modal, not in a closed dialog or a `[hidden]`/`[inert]`/`[aria-hidden="true"]` region, and inside the surviving top modal if one remains. Otherwise focus goes to the first focusable element of the surviving top modal or, with none left, focus is released from the closed dialog to the page. Closing a lower modal never moves focus. | "A3-R3: returns focus to the surviving opener when the lower modal closes first" (Codex's diagnostic) · "A3-R3: restores into the surviving lower modal, not a closed middle one" · "A3-R3: never focuses a removed prior target; stays in the surviving modal or leaves the page" |

**Negative control:** the 8 regressions against the reviewed hook gave 7 failed / 15 passed (the nested case already passed and is kept as a guard). With the corrected hook, all 45 focused A3 tests pass. **Codex's diagnostic file, run verbatim** as a temporary test and then deleted, passes 3 of 3. [Sanitized receipt](evidence/mac-a3-compat-2026-10-02/stack-regressions-r1r3.txt).

**Unchanged and still covered:** native modal path, guarded dismissal, refusal during cleanup, StrictMode, unmount, Quick Find, and the secure UUID and toolkit behavior. The 37 original tests are unchanged and pass.

## Codex re-review A3-R4: nested fallback lifetime

| Finding | Correction | Maintained regressions (`Dialog.fallback.test.ts`, "nested fallback dialog lifetime (Codex A3-R4)") |
| --- | --- | --- |
| **A3-R4 (P1):** A nested fallback Dialog is rendered inside its parent `<dialog>`. Closing the parent while the child stays open put the child and its backdrop under `dialog:not([open]) { display: none }`, an invisible but still active modal. (Also, a fixed backdrop inside the parent's transformed box could not cover the viewport.) | In the fallback, Dialog and QuickFind render their presentation (backdrop plus `<dialog>`) through a **React portal into `<body>`** (`useModalDialog` returns `portalTarget`). React ownership, context and event bubbling are kept. There is no imperative reparenting, the parent is not forced open, and the child's owner still controls its dismissal. A child therefore stays visible, viewport-wide and modal while its owner keeps it open, whatever happens to its parent. The portal is chosen with `useSyncExternalStore`, whose server snapshot is `false`, so server rendering (`renderToStaticMarkup`, used by a gated bench) stays inline. The native path is unchanged. With the fallback at body level, a nested child's parent is a lower modal and is excluded while the child is on top, as the native top layer makes it inert. | "A3-R4: keeps an open nested modal outside closed ancestors when its parent closes first" (Codex's diagnostic) · "…presents the still-open child and its backdrop at viewport level, above the parent" · "…sends Escape and backdrop requests only to the open child's owner" · "…keeps a refusing child visible and modal after its parent closes" · "…returns focus to the page opener and clears exclusion when the child finally closes" (includes reopen) · "…cleans up when the whole tree unmounts with the child open" · "…behaves the same under StrictMode" · "…renders inline, without a portal, when rendered on a server" |

**Negative control:** the 8 R4 regressions against the three reviewed files (hook rebuilt by reverse edit and verified equal to `7f7d43c4…`; Dialog/QuickFind from the reviewed backup, verified) gave **5 failed / 3 passed**. The 3 behaviors that were already correct are kept as guards: Escape routing, unmount cleanup and server rendering. On the corrected source, all **53** focused A3 tests pass, **Codex's R4 diagnostic passes verbatim** (1 of 1), and the gated server-rendering bench passes. [Sanitized receipt](evidence/mac-a3-compat-2026-10-02/nested-lifetime-r4.txt).

**Adapted DOM-shape assertions (same behaviors):** 8 earlier tests asserted `aria-hidden` on `<main>` itself. With body-level dialogs, the page's body-level region is excluded instead, so they now assert "inside an `aria-hidden` + `inert` region". The original-attribute checks moved to that region. The former "nested ancestor stays reachable" test now asserts native-like behavior: the parent is excluded while its child is on top and reachable again after the child closes. It is renamed "A3-R1/R4: makes a nested modal the only reachable one, excluding its parent until it closes".

## Issue-to-fix map

| Issue (A3 locations) | Fix | Maintained regression tests |
| --- | --- | --- |
| `toolkitRepository.ts:13,17` and `toolkit.ts:47` call `structuredClone`, which rejects fresh/corrupt toolkit loads at startup. **Also found:** with valid input, `normalizeToolkitState` returned readiness items that *were* the shared default constants and reused the input's arrays, so edits could leak into the defaults, the input, or other normalizations, even on modern WebKit. | `copyToolkitData` copies arrays and plain objects deeply and keeps primitives. It is documented as JSON-shaped toolkit data only, not a general structured clone. `defaultToolkitState()` gives a fresh owned default. `normalizeToolkitState` returns a copy that shares nothing with its input or the defaults. The repository and the provider's pre-load placeholder use the factory. Values, schema and serialization are unchanged (asserted byte-for-byte). | `src/logic/toolkitDefaults.test.ts` (11, `structuredClone` removed): fresh / empty / corrupt / `null` / number / string stored state; invalid field types; valid stored values preserved with an identical JSON round trip; no sharing with the input, between normalizations or between factory calls. An `afterEach` asserts the shared defaults never changed. |
| `Dialog.tsx:41` and `QuickFind.tsx:68` call `showModal` without a guard. | New `src/components/ui/useModalDialog.ts`. **Native path** (both `showModal` and `close` exist): unchanged platform behavior; QuickFind still focuses its input after `showModal`. **Fallback:** the same element gets `open`, `role="dialog"`, `aria-modal="true"` and `tabindex=-1`, plus a React backdrop sibling (`.modal-fallback-backdrop`) and CSS for fixed positioning and hiding closed dialogs. The hook provides initial focus (QuickFind input; otherwise the first focusable element), Tab/Shift+Tab containment, refocusing when focus escapes, Escape as a *request* to the owner, backdrop click as a request, focus return to the opener, and background exclusion. That exclusion is pointer (backdrop), keyboard (containment) and assistive technology (`aria-hidden`/`inert` on siblings along the path to `<body>`, counted per modal). A modal stack gives keys and focus only to the top modal. Each modal exposes its own path, so an earlier modal cannot leave a later one hidden. Close is controlled by `open`: `dismissible=false` and refusals during async cleanup leave the dialog visible and modal. In the fallback, clicks on the dialog box itself do not dismiss. | `src/components/ui/Dialog.fallback.test.ts` (14 original + 8 stack regressions + 8 R4 regressions = 30; `showModal`/`close` removed; jsdom also lacks `inert`/`::backdrop`): semantics/name/backdrop/initial focus; Tab and Shift+Tab wrap; focus pulled back; `aria-hidden`/`inert` applied and the original `aria-hidden="false"` restored; Escape/backdrop through the owner with focus return; box clicks ignored; `dismissible=false`; owner refusal stays modal; three open/close cycles leave nothing behind; unmount cleanup; StrictMode; **layered**: top-only keys/focus, z-order, lower dialog intact with focus restored, and a lower dialog closing first does not restore the background or take focus. Native regression: `showModal`/`close` used, no fallback attributes, cancel still prevented. `src/components/quickfind/QuickFind.test.ts` (4, real provider and SQLite): Ctrl+K, focused input, `aria-hidden` background, ArrowDown/Enter to the exact route; Escape and backdrop with focus return; Tab containment, sidebar event, clean reopen; native path still uses `showModal` and the native close event. |
| `id.ts` assumes `crypto.randomUUID`. | Native `randomUUID` when present. Otherwise `uuidV4FromBytes(crypto.getRandomValues(new Uint8Array(16)))`, which pins version 4 and variant `10xx` bits. Throws a clear error when neither exists. No `Math.random`, time or counters. The database identity rule (ids made by the app, never SQLite) is unchanged. | `src/lib/id.test.ts` (7): native path used; fallback after removing `randomUUID`, with 2,000 distinct well-formed ids, `getRandomValues` once per id and no `Math.random`; exact injected-byte output; refusal with no `Math.random` or `Date.now`; 25 repository records with valid distinct ids through the fallback; exact formatting of zero, ascending and patterned bytes; input not mutated; wrong length rejected. |
| End-to-end startup | No further production change. | `src/state/legacyWebKitStartup.test.ts` (1): with `structuredClone`, `randomUUID`, `showModal` and `close` all removed, the real provider starts on a fresh database (starter-pack records get v4 ids; toolkit equals the defaults and is owned). Adding a material through the real Study Library "Add to your library" dialog (fallback modal) creates a v4 id and closes. |

**Test hygiene:** `src/testing/capabilities.ts` sets an API to `undefined` (as an older engine would lack it) and restores the exact original property descriptor. Every case restores globals and prototypes, clears mocks, unmounts and clears the DOM. Disposable in-memory SQLite and synthetic records only. Existing suites that install successful `showModal` mocks are unchanged and keep covering the native path.

## Negative controls

The 37 new tests were run against the **original** production files from `8b61d87` (the 6 changed modules swapped in temporarily, then restored and verified by SHA-256). Result: exit 1, **34 failed / 3 passed**. The 3 passes are the native-path regressions, which are expected to pass on both.

Behavior-meaningful original failures:
- `structuredClone is not a function` ×3
- `element.showModal is not a function` ×3
- `crypto.randomUUID is not a function` ×4
- 2 sharing assertions: editing a normalized toolkit changed its input or the next result, independent of `structuredClone`

The rest fail because the new helpers do not exist in the original source. [Sanitized summary](evidence/mac-a3-compat-2026-10-02/negative-control-summary.txt). The control ran before a later type-only cast in `QuickFind.test.ts` (no runtime change).

The Dialog suite caught one real defect in the first version of the hook during development: an earlier modal had hidden a later sibling modal before it opened. It was fixed by the hide/expose counting above, and the layered tests now cover it.

## Verification receipts

| Exact command | Tested source | Exit / counts | Shared summary |
| --- | --- | --- | --- |
| `npx --no-install vitest run src/lib/id.test.ts src/logic/toolkitDefaults.test.ts` (focused) | Final logic | 0; 18 passed (after a `tsc`-only status-literal fix) | — |
| `npx --no-install vitest run src/components/ui/Dialog.fallback.test.ts` | First hook version | **1**; 4 failed / 10 passed (layered hidden-sibling defect, plus an over-broad test selector) | Fixed as described |
| Same, after fixes | Final | 0; 14 passed | — |
| `npx --no-install vitest run src/components/quickfind/QuickFind.test.ts` | Final | 0; 4 passed | — |
| `npx --no-install vitest run src/state/legacyWebKitStartup.test.ts` | Final | 0; 1 passed (first run failed on a wrong dialog name in the test) | — |
| Negative control (above) | Original modules | 1; 34 failed / 3 passed | [negative-control-summary.txt](evidence/mac-a3-compat-2026-10-02/negative-control-summary.txt) |
| Gate attempt 1 (sequential) | Final, before the test cast | `npm run build` **2**: `QuickFind.test.ts(127,20) TS2339`. All other steps 0 | [local-gate-summary.txt](evidence/mac-a3-compat-2026-10-02/local-gate-summary.txt) |
| First-version gate: `npm ci` | First version (reviewed hashes) | 0; 165 packages, 0 vulnerabilities (warm cache) | same |
| `npm test` | same | 0; 65 files passed / 3 skipped; 639 passed / 4 skipped (602 plus 37 new) | same |
| `npm run build` | same | 0; entry chunk 385.51 kB (119.91 kB gzip), against 381.14 / 118.32 kB on main | same |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | same (no Rust change) | 0 | same |
| `SDKROOT=…26.5.sdk cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | same | 0 (incremental) | same |
| `SDKROOT=… cargo test --locked --manifest-path src-tauri/Cargo.toml` | same | 0; 246 passed, 6 ignored | same |
| `npm run test:cargo-lock` | same | 0 | same |
| `git diff --check` plus a trailing-whitespace/final-newline scan of the untracked files | same | 0; clean | same |

**R1–R3 correction receipts:**

| Exact command | Tested source | Exit / counts | Shared summary |
| --- | --- | --- | --- |
| `npx --no-install vitest run src/components/ui/Dialog.fallback.test.ts` with the 8 new regressions | Reviewed hook (`4ff06f12…`) | **1**; 7 failed / 15 passed | [stack-regressions-r1r3.txt](evidence/mac-a3-compat-2026-10-02/stack-regressions-r1r3.txt) |
| Same | Corrected hook, first run | **1**; 21 / 22 (test setup set its original `aria-hidden` after exclusion; test fixed, no source change) | same |
| `npx --no-install vitest run` on the five A3 suites | Corrected | 0; **45 passed** | same |
| Codex's diagnostic run verbatim (temporary file, then deleted) | Corrected | 0; **3 passed** | same |
| **Final gate:** `npm ci` | Corrected diff | 0; 165 packages, 0 vulnerabilities | [local-gate-summary-r1r3.txt](evidence/mac-a3-compat-2026-10-02/local-gate-summary-r1r3.txt) |
| `npm test` | same | 0; 65 files passed / 3 skipped; **647 passed** / 4 skipped (639 plus 8) | same |
| `npm run build` | same | 0; entry chunk 385.75 kB (119.98 kB gzip) | same |
| `cargo fmt --check` · `cargo clippy --locked … -D warnings` (SDK 26.5) · `cargo test --locked` · `npm run test:cargo-lock` · `git diff --check` plus an untracked-file whitespace scan | same (no Rust change) | All 0; 246 Rust passed, 6 ignored | same |

**R4 correction receipts:**

| Exact command | Tested source | Exit / counts | Shared summary |
| --- | --- | --- | --- |
| `npx --no-install vitest run src/components/ui/Dialog.fallback.test.ts` with the supplied regression added | Reviewed sources | **1**; 1 failed / 22 passed | [nested-lifetime-r4.txt](evidence/mac-a3-compat-2026-10-02/nested-lifetime-r4.txt) |
| Same, after the portal change | Corrected, first run | **1**; 8 DOM-shape assertions failed (see above); adapted | same |
| `… Dialog.fallback.test.ts -t "A3-R4"` | Reviewed sources (negative control) | **1**; 5 failed / 3 passed / 22 skipped | same |
| `npx --no-install vitest run` on the five A3 suites | Corrected | 0; **53 passed** | same |
| Codex's R4 diagnostic run verbatim (temporary file, then deleted) | Corrected | 0; 1 passed | same |
| `HFD_BENCH=1 npx --no-install vitest run src/pages/StudyLibrary/StudyLibrary.bench.test.ts` (server rendering) | Corrected | 0; 1 passed | same |
| **Final gate:** `npm ci` · `npm test` · `npm run build` · `cargo fmt --check` · `cargo clippy --locked … -D warnings` (SDK 26.5) · `cargo test --locked` · `npm run test:cargo-lock` · `git diff --check` plus an untracked-file whitespace scan | Corrected diff | All 0. **655 passed** / 4 skipped (65 files). Entry chunk 386.00 kB (120.10 kB gzip). 246 Rust passed / 6 ignored. 165 packages, 0 vulnerabilities | [local-gate-summary-r4.txt](evidence/mac-a3-compat-2026-10-02/local-gate-summary-r4.txt) |

No performance benchmark or DMG build was rerun (unchanged scope). Raw logs are local under `.smoke/mac-a3-compat/` (`gate/`, `gate-attempt1-build-failed/`, `gate-r1r3/`, `gate-r4/`).

## Changed files and final hashes (SHA-256, after R4; files not marked R4 are unchanged since the re-review)

```text
0d94f3857d5ef2a204f95981dd4bf158d73ca85031943712d0673e0cdf4f2085  src/lib/id.ts
53d0a3ccb96b2c26ee3a634c5701729a543576279c2608595fa77b76c349a33c  src/logic/toolkit.ts
f2d13871ae89fa295cdd09e26b31e143f68672d1a0c30f6e8be5ff7de5944c24  src/data/repositories/toolkitRepository.ts
7088890a9ec3c9de5c0fbb511c33ce2888892d797b37468bfff4b971d7ac25b7  src/state/AppDataContext.tsx
c93948147f255f63442bb6db999e7f660a3d0aff87d5090bb78c93c8018bc8c9  src/components/ui/Dialog.tsx                (R4)
69062aeb727b6d0930c052063a254b7adf949d5d9fb71898cd3741596eed470d  src/components/ui/useModalDialog.ts        (new; R1–R3, R4)
b191a4c454a4bb16cd65db9982eb9b122a053e4d879f4ccaf5f325c08591de06  src/components/ui/ui.css
35ecd1c78b8b973e18abb3db069f9d73d8185baf0af3ae5d1e394769b8629249  src/components/quickfind/QuickFind.tsx      (R4)
73750df11058f6eb5460dae469a5cb7001e9aeffac9040a1600f7ed07dc13d09  src/components/quickfind/quickFind.css
7dead87ec20670b2bf18100ef9f2ca037a91e3165cca608a9d53663231aa79c4  src/testing/capabilities.ts                (new)
5c9bd554ac3ad75435e11ef232f59bdca619bf7db60272f63e18a2b00d78119b  src/lib/id.test.ts                         (new)
55a11a659cc06af753dcce70806fe7acac6f13fe7cc0342aace4cf9bcf9c1dc0  src/logic/toolkitDefaults.test.ts          (new)
ee46287fbba1f1115cdd8b32d325fe577220dc401b5db8b261b16663b9d59931  src/components/ui/Dialog.fallback.test.ts  (new; R1–R3, R4 regressions)
61627d5467dd5d59c6801f8a31b4031f0cf616e800e06965e1ce2835712154cc  src/components/quickfind/QuickFind.test.ts (new; R4 shape assertions)
173c1f6374cd195cbcb3cf4012d09027b719f6f21fb329b91622ad8fd48e2c72  src/state/legacyWebKitStartup.test.ts      (new)
```

No dependency, lockfile, migration, Rust, configuration or bundle-identifier change.

## Limitations and remaining gates

- **Capability simulation, not WebKit.** The tests remove APIs in Node/jsdom. They cannot show old WebKit's actual layout of the fallback (fixed centering, backdrop stacking, `100vh`), its focus quirks, or VoiceOver's reading of `role="dialog"`/`aria-modal` and `aria-hidden`.
- **Stacking.** The fallback uses z-index rather than the native top layer. Since R4 the fallback dialogs and backdrops are body-level portals, so page ancestors no longer affect their stacking. Only other body-level fixed elements matter, such as the undo bar at z-index 60, below the 1002+ modal layers.
- **Focus scope.** Containment covers standard focusable elements, not elements made focusable by other means. No such element exists in the dialogs today.
- **Native focus return.** On the native path, focus return after close remains the engine's behavior (unchanged).
- **Still required on real systems:**
  - installed **macOS 12.0–12.2** (fallback path) and a current macOS (native path) on Apple Silicon: launch, fresh toolkit, Dialog and Quick Find keyboard/pointer behavior, VoiceOver, id creation;
  - Windows WebView2 regression.

  MAC-03 remains UNVERIFIED.
- **Unchanged:** A2, A4 and A6, backup v3 / v1 / v2 restore, migrations, release holds, the frozen v0.5.3 candidate and the open-source plan's conditions. No installed launch, DMG, signing or account changes were made.

Leave uncommitted for Codex review.
