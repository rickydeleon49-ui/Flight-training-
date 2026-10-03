# Mac readiness preflight: usage reference

`scripts/mac-readiness-preflight.mjs` is a read-only report about this checkout, this Mac and, only when you name one, a single artifact. It adds no dependency. Its tests are in `src/logic/macReadinessPreflight.test.ts`. The installed-test procedure it supports is in [the installed-readiness runbook](MAC_INSTALLED_READINESS_PREPARATION_2026-10-03.md).

**Corrected on 3 October 2026 for Codex's [readiness review](MAC_INSTALLED_READINESS_REVIEW_2026-10-03.md) (READINESS-R1 to R3); [accepted by Codex for source integration](MAC_INSTALLED_READINESS_ACCEPTANCE_2026-10-03.md).** The receipt schema is now `hfd-mac-readiness-preflight/2`. The changes since `/1` are listed at the end of this page.

**A report is not a readiness verdict.** `summary.readyForInstalledUse` is always `false`. Several things stay open until a person records them through the runbook:

- test-account isolation
- the signing decision
- the eight installed smoke phases

## What it never does

| Never done | Detail |
| --- | --- |
| Build, mount, install, launch | It never builds or bundles, never mounts a DMG, never copies to `/Applications`, never opens the app. |
| Sign, notarize, staple | No signing, notarization or stapling. Local signature checks use only `codesign -dv` (display) and `codesign --verify` (verification); neither writes. |
| System and account changes | No keychain, account, Gatekeeper or quarantine change. |
| External services | It triggers no GitHub Actions and contacts no provider. |
| Searching | It searches no folder. It reads only the checkout's public configuration and the selected SDK's `SDKSettings.json`. |
| App profile | It never inspects an application profile. |

`--assess` is the only opt-in exception. It runs `spctl --assess` and `stapler validate` on the supplied artifact, and macOS may perform Apple's online notarization lookup during that.

**Command handling:**

- Every command has a 10 s timeout and a 64 KiB output cap, and runs with a minimal environment.
- A command's output counts **only if it exited 0**, with these exceptions:
  - `codesign` reports "not signed at all" through a nonzero exit, which is recorded as unsigned.
  - `codesign --verify` failures are recorded as failed integrity.
  - `spctl` rejected is accepted only together with a nonzero exit.
  - `stapler` "no ticket" is accepted only together with a nonzero exit.
- A missing, denied, timed-out, truncated or unparseable observation stays `UNVERIFIED`.

**Public output uses fixed categories**, never raw output:

- Certificate authorities, Gatekeeper sources, code-signing flags, Rust host triples, the developer directory, branch names and policy status map to known values; anything else becomes `unknown` or `other`.
- Identifiers are reported as `matches-expected`, `differs-from-expected`, `present` or `absent`.
- Paths are never recorded. The only exceptions are the fixed system SDK locations, and artifact names that equal a recorded identity's file name.
- CLI errors never echo the values you typed or raw system error messages, only a fixed error code such as `EEXIST`.

## Usage

```bash
node scripts/mac-readiness-preflight.mjs
```

| Option | Meaning |
| --- | --- |
| `--repo <dir>` | Checkout to inspect (default: current directory) |
| `--artifact <file>` | Hash and size this one file. For a `.dmg`, also display and strictly verify the **disk-image** signature. The inner app is never mounted or inspected. |
| `--app <dir>` | Inspect an already-available `.app` read-only: `Info.plist` fields, executable architectures, signature display and **strict deep verification** |
| `--expected-sha256 <hex>` / `--expected-size <bytes>` | Compare the `--artifact` identity |
| `--expected-identifier <id>` | Default `com.herflightdeck.app` |
| `--sdk <path>` | Select the SDK to check (default `$SDKROOT`, else `/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk`). Only paths under `/Library` or `/Applications` are inspected. |
| `--assess` | Opt in to Gatekeeper and stapled-ticket assessment of the supplied artifact |
| `--json` / `--receipt <file>` | Print the JSON receipt / also write it to a new file (never overwritten) |

To inspect the app inside a DMG, mount it read-only first, as a separately authorized step (runbook §7), then pass `--app`.

## Statuses and exit codes

| Status | Meaning |
| --- | --- |
| `PASS` | Observed now, by commands that succeeded, and matches the expectation |
| `FAIL` | Observed now and contradicts the expectation, including an observed integrity failure; or a required input is missing or malformed |
| `UNVERIFIED` | Not observable here, or the observation failed; no expected value; no recorded execution; or a version without evidence |
| `USER_ACTION` | Needs the owner: the test account, the signing decision and credentials |

| Exit code | Meaning |
| --- | --- |
| `0` | Report produced with no `FAIL`. This is **not** "ready". |
| `1` | At least one `FAIL` |
| `2` | Usage error, internal error or receipt-write error |

## Checks

| ID | What | PASS requires |
| --- | --- | --- |
| R-VERSION | five version sources agree | all five are valid and identical |
| R-IDENTIFIER | `tauri.conf.json` identifier | equals the expected identity. Otherwise `differs-from-expected`, `missing` or `malformed` (never echoed). |
| R-MIN-MACOS | `minimumSystemVersion` against the release policy | both valid version strings, and equal |
| R-POLICY | macOS candidate version and `aarch64` against the repository | valid and equal |
| R-SIGNING-CONFIG | signing-related config and Apple secret *names* in workflows | always `USER_ACTION`; absent references do not prove that secrets are absent |
| R-SOURCE | HEAD, branch category, modified and untracked counts | clean tree; git commands exited 0 |
| H-OS | macOS version and build against a **valid** configured minimum | `sw_vers` exited 0 and the version meets the minimum. With an invalid minimum the result is `UNVERIFIED`; on a non-macOS platform it is `FAIL`. |
| H-ARCH | native arm64 host and Node process | arm64, not translated |
| H-TOOLCHAIN | Node, npm, rustc (host category) and Cargo | all identified, Node 22, `aarch64-apple-darwin` |
| H-SDK | selected SDK (`--sdk`, `SDKROOT` or default): presence, directory type, metadata, version | the version read from valid metadata is **26.5**, the one version with recorded native-build evidence. See the table below for the other cases. |
| H-TOOLS | read-only inspection tools at their system paths | all present |
| P-TEST-ACCOUNT, P-SIGNING | owner prerequisites | never; always `USER_ACTION` |
| P-INSTALLED-SMOKE, P-A2-SOURCE | installed phases (0 of 8 recorded) and the A2 source gate | never; always `UNVERIFIED` |
| A-EXISTS, A-SIZE, A-SHA256 | artifact existence, size and hash (also matched to the recorded identities) | matches the supplied expectations |
| A-APP-METADATA | `--app`: identifier, minimum macOS, version, arm64 executable | `plutil` and `lipo` exited 0 and the values match. For a DMG: `UNVERIFIED` (never mounted). |
| A-APP-SIGNATURE | `--app`: `display` and `integrity` sub-observations | `codesign -dv` exited 0; `codesign --verify --deep --strict` exited 0; identifier `matches-expected`; a `developer-id-application` authority; hardened runtime; team present; secure timestamp |
| A-DMG-SIGNATURE | `.dmg` artifact: the disk-image **container** signature | display exited 0; `codesign --verify --strict` exited 0; `developer-id-application`; team; secure timestamp. **No** runtime flag or bundle identifier is required; the image's own identifier is only `present`/`absent`. |
| A-INNER-APP-SIGNATURE | `.dmg` artifact: the unopened app | never; always `UNVERIFIED` |
| A-GATEKEEPER | `--assess`: Gatekeeper verdict, source category, stapled ticket | `accepted` (exit 0) and `stapled` |

H-SDK outcomes other than PASS:

| Situation | Status |
| --- | --- |
| Version 27.0 (recorded build failure) | `FAIL` |
| Absent path, or not a directory | `FAIL` |
| Other version, or missing, malformed or unreadable metadata | `UNVERIFIED` |

The default SDK version is reported separately, and identifying it is not proof that a build links.

**Signature design notes.** Apple's [TN2206](https://developer.apple.com/library/archive/technotes/tn2206/_index.html) recommends `codesign --verify --deep --strict --verbose=2` for apps, and a printed `Sealed Resources` line is not evidence of intact resources. Apple's [disk-image packaging example](https://developer.apple.com/forums/thread/701581) signs an image with `--timestamp` and its own `-i` identifier, without `--options runtime`. Requiring runtime only of apps is an inference from that example, not an observed artifact result. For disk images TN2206 also gives `spctl -a -t open --context context:primary-signature`, which this tool runs only with `--assess`.

## JSON receipt schema (`hfd-mac-readiness-preflight/2`)

```text
{
  schema: "hfd-mac-readiness-preflight/2",
  generatedAt, tool,
  mode: { artifactInspection, assess },
  repository: { package: "her-flight-deck"|"unrecognized", version|"unresolved", identifier (expected value or category), minimumSystemVersion|"invalid or missing" },
  artifact: null | {
    kind: "app"|"disk-image"|"file", name: recorded file name | "Her Flight Deck.app" | "not recorded", pathRecorded: "never",
    bytes?, sha256?, knownIdentity?,
    bundleIdentifier?: expected value | "differs-from-expected" | "unread", minimumSystemVersion?, version?, executableArchitectures?,
    signing?: {
      display: { state: "observed"|"unsigned"|"display-failed"|"missing"|"denied"|"timeout"|"truncated"|"error",
                 signatureKind?: "adhoc"|"certificate"|"unknown",
                 identifier?: "matches-expected"|"differs-from-expected"|"present"|"absent",
                 flags?: [known flag | "other"], hardenedRuntime?, teamIdentifier?: "present"|"not set"|"absent",
                 authorityKinds?: [ "developer-id-application"|"developer-id-installer"|"apple-development"|"apple-distribution"|
                                    "developer-id-certification-authority"|"apple-root-ca"|"apple-code-signing-certification-authority"|
                                    "apple-wwdr-certification-authority"|"apple-software-signing"|"unknown" ],
                 secureTimestamp?, sealedResourcesLine?: "present"|"none"|"absent" },   // a printed line, not integrity
      integrity: { state: "verified"|"failed"|"missing"|"denied"|"timeout"|"truncated"|"error",
                   reason?: "sealed-resource-invalid"|"signature-invalid"|"not-signed"|"verification-failed" }
    },
    assessment?: { gatekeeper: "accepted"|"rejected"|"unparsed"|<command state>,
                   source: "notarized-developer-id"|"developer-id"|"unnotarized-developer-id"|"no-usable-signature"|"apple-system"|"mac-app-store"|"unknown",
                   stapledTicket: "stapled"|"not stapled"|"unknown"|<command state> }
  },
  checks: [ { id, category, status, summary (fixed text with validated values), observed } ],
  summary: { counts, exitCode: 0|1, readyForInstalledUse: false, notReadyBecause: ["ID: STATUS"] },
  safety: { mounted, installed, launched, built, signed, notarized, keychainOrAccountChanged, ciTriggered,
            providerContacted, appProfileInspected: all false; appleOnlineLookupPossible: only with --assess and an artifact }
}
```

**Changes from `/1`:**

- `A-SIGNATURE` is split into `A-APP-SIGNATURE` and `A-DMG-SIGNATURE`, with `display` and `integrity` sub-objects. `A-INNER-APP-SIGNATURE` is new.
- H-SDK now observes `selectedBy`, `presence`, `metadata`, `evidencedVersions` and `knownIncompatibleVersions`.
- Authority kinds, sources, flags and identifiers are categories.
- `repository.name` is replaced by `repository.package`, and `pathRecorded` is `"never"`.
- The home-directory replacement is removed. Fixed categories make it unnecessary, and it could corrupt valid values.

## Validation

```bash
npx vitest run src/logic/macReadinessPreflight.test.ts
```

The suite has 34 tests. Commands go through an injected runner, except in the real bounded-runner and CLI tests. SDK paths use an isolated synthetic filesystem that never falls through to this Mac's files. Fixtures are task-owned temporary directories. The R1–R3 regressions and their names are in the runbook's correction map (§10).
