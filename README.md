# Her Flight Deck

A personal flight-training companion that keeps study, lessons, goals, notes,
finances, and next steps organized in one private workspace.

**She has not started flight school yet.** She is studying and flying — lessons
and discovery flights while she works out which school and which route to take.
So nothing in the application requires a school, an instructor, or an enrolment
to be useful: those fields stay optional, the roadmap opens on choosing a
training route, and Notes exists for everything that has no home yet.

The product specification lives in [`PRODUCT_SPEC.md`](PRODUCT_SPEC.md) and is
the source of truth for purpose, philosophy, terminology, and visual direction.

**Starting on the Mac?** Use the [GitHub Mac handoff](docs/MAC_GITHUB_HANDOFF_2026-10-02.md)
for a fresh checkout, setup, the Mac agent prompt and a smoke-test results template.
It needs no files from the Windows computer.

**Working across Windows and Mac?** Read the [shared project handoff](docs/PROJECT_HANDOFF.md)
for current task ownership, research, review evidence and continuation prompts.

---

## Running it

Requires Node 20+ and, for the desktop application, a Rust toolchain and the
[Tauri system dependencies](https://tauri.app/start/prerequisites/) for your
platform.

```bash
npm install
npm run tauri dev     # the desktop application
```

`npm run dev` opens the interface in a browser instead. That mode exists so the
UI can be worked on without a Rust toolchain: it runs the same SQL against a
WebAssembly build of SQLite kept in `localStorage`, and file import is disabled.
The real application always uses the desktop database.

| Command | What it does |
| --- | --- |
| `npm run tauri dev` | Desktop application with live reload |
| `npm run tauri build` | Package the desktop application |
| `npm run dev` | Browser-only development mode |
| `npm run typecheck` | Strict TypeScript check |
| `npm test` | Test suite |
| `npm run build` | Typecheck and build the frontend |
| `scripts/desktop-smoke.sh` | Drive the real desktop window (Linux) |
| `scripts/release.sh <version>` | Bump, check, commit and tag a release |

---

## Getting it to her

She should not have to build anything. The release workflow compiles
the target platform installer(s) (defaulting to `macos-only` while Windows
distribution is held on `v0.5.1`). By default, it produces private Actions
CI artifacts for device smoke testing. When `create_draft: true` is selected,
it attaches the exact installers to a private GitHub Release **draft**
targeting that commit, where an owner reviews and tests the exact files before publishing.

**From the browser**, with nothing installed anywhere:

> Actions → **Release** → Run workflow → type the version → choose options → Run

By default (`create_draft: false`), the workflow produces private CI artifacts
only, without creating a tag or release draft. When preparing an official candidate
for review, a maintainer selects `create_draft: true` to create the private draft
targeting that commit with tag name `v<version>`. It checks the version against `scripts/release-policy.json`,
evaluates the target platform (default `macos-only` produces the Apple Silicon Mac DMG;
Windows distribution is held on `v0.5.1` pending security review), and creates
the private release draft. Follow [the release review process](docs/RELEASE_REVIEW_PROCESS.md)
to inspect and test the exact draft assets on physical hardware before publishing.

**Or from a clone**, if you have one:

```bash
scripts/release.sh <version>                  # validates, bumps, checks, commits, tags
git push origin <branch> && git push origin v<version>
```

The release notes are written for her, not for a developer: which file to
take, what each system asks the first time, and that updating keeps
everything she has entered.

Release `v0.5.1` is the current distributable Windows release. Version `0.5.2` was
withdrawn and is permanently retired (see `scripts/release-policy.json`). The unresolved
Windows Defender review blocks **Windows distribution only**; candidate `v0.5.3` is
prepared on an independent **Mac-only release pathway**. A Mac candidate may be released
once its independent Apple Silicon hardware smoke test and draft verification pass,
without waiting for Microsoft Defender resolution. Windows distribution remains held on
`v0.5.1` until authoritative Microsoft clearance of the exact binary or trusted code
signing is achieved. Paid code signing is the long-term path, but is not mandatory if
Microsoft clears the exact binary.

The version is not just bookkeeping — the application takes a copy of her
database whenever it notices the version changed since the last run. So the
workflow refuses to publish if the version you ask for disagrees with the one
in the repository, or if that version has already been released. To ship a
new version, bump it first (`scripts/release.sh`, or edit `package.json`,
`src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` together).

**She will need access to the repository to download it.** It is private, so
that means a GitHub account added as a collaborator. If she does not have one,
download the file yourself and send it to her — it is a single file, and it
runs the same either way.

**Neither installer is currently code-signed.** That requires a paid Apple Developer
account and a Windows code-signing identity; installers remain private review drafts
until verified and tested per the release review process. The Windows hold may be
resolved either by authoritative Microsoft clearance of the exact installer or by
trusted code signing, alongside mandatory physical installed-app validation on
Windows and Apple Silicon hardware.

---

## On a Mac or Windows

Tauri builds for the machine it runs on, so each platform's application has to
be built on that platform. Two ways to get one.

### Let GitHub build it

The **Build desktop app** workflow under the Actions tab produces a
downloadable `.dmg` or `.exe` installer with no local toolchain. Pick a
platform or build both. It is manual-trigger only, because macOS runners bill
at ten times the Linux rate.

### Or build it yourself

**macOS** — once, to set the machine up:

```bash
xcode-select --install                                            # Apple's build tools
brew install node                                                 # or from nodejs.org
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh    # Rust
```

**Windows** — install [Node](https://nodejs.org),
[Rust](https://rustup.rs), and the Visual Studio Build Tools with the
"Desktop development with C++" workload. WebView2 ships with Windows 11; on
Windows 10 the installer fetches it.

Then, on either:

```bash
npm install
npm run tauri dev      # develop, with live reload
npm run tauri build    # package
```

Which leaves you:

```
macOS    src-tauri/target/release/bundle/dmg/Her Flight Deck_<version>_aarch64.dmg
Windows  src-tauri/target/release/bundle/nsis/Her Flight Deck_<version>_x64-setup.exe
```

macOS builds target Apple Silicon (M-series Macs) only.

### Platform security and code signing

Neither installer is currently code-signed. Acquiring an Apple Developer
identity with notarization and a Windows code-signing certificate is the
long-term distribution path, but paid Windows signing is not mandatory if Microsoft
authoritatively clears the exact binary. Physical installed-app validation is
mandatory for each platform included in a release; the Mac-only candidate
requires Apple Silicon validation before publication.

In accordance with [the release review process](docs/RELEASE_REVIEW_PROCESS.md):

- **Drafts stay private:** The default browser run produces a private CI artifact.
  Selecting `create_draft: true` creates an unpublished release draft for owner
  inspection, not an immediate public download.
- **Never bypass platform protections:** If Microsoft Defender, Windows
  SmartScreen, macOS Gatekeeper, or browser Safe Browsing flags an installer,
  the draft must remain private and held from distribution. Never instruct
  users to bypass, disable, or weaken operating system or browser protections
  (such as running quarantine removal commands or lowering Safe Browsing).
  **Owner exception (16 October 2026):** an unsigned Mac build that the owner
  has released may be opened through Apple's documented Privacy & Security →
  **Open Anyway** step after its SHA-256 matches the published checksum. This
  applies only to macOS's "could not verify" (unidentified developer) block,
  never to an actual malware detection, and ends once Developer ID signing and
  notarization are in place.
- **Windows hold resolution:** The Windows hold may be resolved by authoritative
  Microsoft clearance of the exact installer (e.g. Microsoft Security Intelligence
  developer dispute) or by trusted code signing. If a detection cannot be cleared
  or signed, the draft must be discarded and a new version prepared.
- **Mandatory physical hardware testing:** Installers must be verified on physical
  Windows and Apple Silicon hardware before distribution.
- **Checksum verification:** Each draft provides SHA-256 checksums in
  `SHA256SUMS.txt`. Comparing checksums verifies download transmission
  integrity, but does not substitute for platform security clearance.

### It needs a reasonably current system

Every form in the application is a native `<dialog>`. WebKit only supports
that from Safari 15.4, so the macOS bundle declares **12.0** as its minimum —
on anything older the dialogs would simply not open. Windows uses WebView2,
which is evergreen, so any supported Windows 10 or 11 is fine.

---

## Offline PDF reading and search

In the desktop app, prepare a PDF once to search its readable text without a
connection and make a study kit from its pages, with no AI or upload. Search also
finds saved guides, cards, practice questions, notes, instructor questions and
homework. Image-only pages need readable text; OCR is not included. Files over
128 MiB are refused. One extraction worker runs at a time, with a 512 MiB
counted-allocation cap, an 8 MiB per-page budget and a 120-second deadline;
the cap is not a bound on total app or process RSS. Try individual chapters
when a handbook cannot be prepared.

Build gates live here: `.github/workflows/release.yml` sets
`HFD_OFFLINE_EXTRACTION=1` on the installer build step; the private packaging
checks in `.github/workflows/build-desktop.yml` use the same opt-in for both
platforms. `scripts/release.sh` exports it for checks before preparing the tag
(it does not build installers). For a local release build, use
`HFD_OFFLINE_EXTRACTION=1 npm run tauri build`. The Tauri build config
(`src-tauri/tauri.conf.json`) inherits that environment through `npm run build`;
`vite.config.ts` maps it to the existing frontend flag only for builds.
Rust's compile-time gate enables extraction and both native search paths;
`offlineStudyEnabled()` uses the frontend flag plus the desktop check to show
search. Without the release opt-in, native extraction/search remain disabled
and a missing-cache kit keeps the unavailable message; valid caches still work.
In debug builds Rust permits extraction as before; the UI still needs the
explicit `VITE_OFFLINE_EXTRACTION=1` development flag. Browser mode keeps the
desktop features hidden. Setting an environment variable after building does
not enable the installed app.

The owner accepted the [synthetic warning-pressure result](docs/evidence/offline-on2b-2026-10-21/RESULT.md)
on a 32 GiB M5, weaker evidence than a minimum-spec Mac. After the update, check
one real chapter PDF on her 8 GB Mac with her usual apps open; if it is slow,
follow up with the cap lowered to 384 MiB. This round keeps the cap unchanged.

## Optional Gemini study assistant

Settings can connect a personal Gemini API key from
[Google AI Studio](https://aistudio.google.com/app/apikey). The learner signs
in with her Google account, creates a free key, and pastes it into the app once.
The key is kept in a file inside the application data folder, readable by her
account alone where the platform supports it; it is never stored in SQLite,
included in a backup, returned to the webview, or committed to this repository.

It used to live in Windows Credential Manager or macOS Keychain. A keychain
item on macOS belongs to the code signature of the application that saved it,
and this application has no stable signing identity, so every update looked
like a different application and she had to enter the key again. A file in her
own data folder does not care which build is asking.

After connecting, an uploaded PDF, TXT, Markdown, PNG, JPG, or WebP document can
produce a source-based study guide and a set of interactive flashcards. Only
the document whose **Create study aid** button she presses is sent to Google.
The generated result is stored locally in SQLite and remains available offline.
DOCX and RTF files can remain in the library, but must be converted to PDF before
Gemini can analyze them.

**What Google will read.** A PDF up to 50 MB or 1,000 pages, whichever comes
first — that ceiling is Google's and is the same however the file is sent, so a
larger handbook has to be split into the chapter being studied. Text and
Markdown are held to 4 MB, which is roughly what the model can hold in mind at
once; images ride the 100 MB inline request cap, counted after base64 encoding.
The application checks all of this before she clicks, so an oversized file is a
next step rather than a wasted upload.

**How a PDF is sent (GEN-REL-01).** A PDF is uploaded once to Google's Files API
and every study-guide or practice-test request for that same selected file
refers to the uploaded copy instead of sending the whole PDF again. Google keeps
that copy temporarily (48 hours when this was written); the application asks
Google to delete it sooner when the file's contents change, the copy is
replaced or she disconnects Gemini. What the upload is bound to (the selected
file's SHA-256, type, stored path and a hash of the key) is kept only in the
running application's memory: never in SQLite, a backup or a log, and never the
key itself. Before sending, the confirmation offers **Choose a chapter or pages
first**, which opens the existing page chooser and sends nothing; the new part
is sent only after its own **Send to Gemini**. Text and images are still sent
inline with the one request.

**Generations outlive the page (GEN-REL-02).** A study aid or practice test
keeps running while she opens another material or another screen, and its
answer is saved to the material it was made from, as long as that material
still exists with the same file and the same contents (checked by SHA-256);
otherwise it is not saved and she is told. One generation runs at a time across
the app. A validated answer is recorded as a checkpoint in `gemini-jobs.json` in
the app data folder, beside the key file, so a failed save offers **Save
again**, which uses the same answer and does not ask Gemini again. After a reload
or restart, a finished answer waits for her to save or discard it. A generation
cut off by the app closing is shown as interrupted and is never resent by
itself, because nobody knows whether Google finished it. The journal holds no
key, upload reference or document bytes, keeps at most eight jobs, and is not
part of a backup.

**Bounded, honest and cancellable (GEN-REL-03, GEN-REL-04).** One generation
has one five-minute budget for everything it does: uploading, waiting for
Google to prepare the PDF, at most three generation attempts (the backup model
included), the pauses between them and cleanup. Failures say which stage they
reached (could not connect, upload, no answer in time, answer cut short,
connection dropped, quota, refusal, blocked or truncated output). Only a
connection that was never made points at the internet connection. While it
runs, the study aid shows the stage actually reached, the attempt once there
has been a retry, and how long it has been going, never a percentage. **Cancel**
stops it: the job is recorded as cancelled, nothing more is sent and nothing
is saved, and the message does not promise that Google had not already
processed a request it received. If the answer arrived before the cancel did,
it is offered to save or discard rather than saved by itself. After a failure,
cancel or interruption, **Try again** goes through the usual Send confirmation,
and a PDF already prepared with Google is reused.

**Larger flashcard sets (GEN-REL-05).** The **Send this file to Google?** message
lets her choose a target of 20, 40 or 60 flashcards; 40 is the default. The
target is a maximum: a shorter source may produce fewer cards. Gemini is asked to
avoid padding and repeats, and identical cards are removed. Gemini writes the
study guide first, then the cards in batches of up to ten. Each checked batch is
kept as a draft. The whole job shares one five-minute limit, which keeps counting
while the app is closed, and at most nine generation requests. **Try again** can
finish a kept draft while time and requests remain; after that, she discards the
draft and starts again. A finished set waits for her to save it; until she does,
her current study guide, cards and review history stay as they were.

**Which model reads it.** Settings offers two choices once a key is connected.
**Standard** sends documents to Gemini 3.5 Flash (`gemini-3.5-flash`): fast and
inexpensive, and it works with a free Google AI Studio key. **Most capable** sends
them to Gemini 3.8 Flash (`gemini-3.8-flash`): newer and a little more thorough;
it may use slightly more of your Google credits. Standard remains the default.
The choice is stored in a `gemini-model` file beside the key, never in SQLite or
a backup, and a missing or unreadable choice means Standard. The **Send this
file to Google?** message names the model that will read the file, and each
saved study aid says which model made it. Older aids made with Gemini 4 Argon
keep that label. If Gemini 3.8 Flash is unavailable to this key (`403`), temporarily
rate-limited (`429`) or stays busy, the request moves to Gemini 3.5 Flash within
the same bounded attempts. Invalid keys and exhausted daily quotas still stop
the request; turning on billing is not presented as a requirement for this model.

**When Google is busy.** A `503` means Google's own capacity is short for a
moment — nothing to do with her key, her quota, or her document. Generating
retries four times with a growing pause, then tries a backup model once (Gemini
Flash-Lite for Standard, Gemini Flash for Most capable), and
only then reports that Google is busy and the same file will probably work in a
few minutes. The waiting is narrated rather than silent: the Rust side emits
each pause to the window, so "Gemini is reviewing this document" becomes
"Google is busy. Waiting 3 seconds, then trying again — attempt 3 of 4."
Connecting a key retries the same way, so an overloaded model never reads as a
bad key. Settings explains that enabling billing moves the Google Cloud project
to paid Tier 1 with higher rate limits, while making clear that billing cannot
guarantee model capacity.

**Creating study-size parts.** A handbook past those limits is not a dead end.
The Study Library splits the complete PDF on her own machine into consecutive
parts no larger than 50 MB or 1,000 pages. It labels them “Part X of Y,” keeps
their original page ranges and the book's metadata, and gives each part its own
study-guide action. The original stays untouched. Deleted pages are pruned
rather than merely unlinked, so each part carries only the pages it needs.

Google's free-tier terms say submitted content may be used to improve its
products. Do not send medical records, certificates, addresses, logbooks with
personal information, or other sensitive documents. Generated aviation material
is explicitly labelled as a study aid and must be checked against its source,
current FAA guidance, aircraft documents, the flight school, and the instructor.

---

## Her data survives updates

Everything she enters lives in one folder:

```
macOS    ~/Library/Application Support/com.herflightdeck.app/
Windows  %APPDATA%\com.herflightdeck.app\

    her-flight-deck.db     the database
    documents/             imported study materials
    backups/               automatic copies
```

Seven things keep it safe across releases:

**The folder is keyed to the bundle identifier**, `com.herflightdeck.app`.
Installing a new version over an old one leaves it untouched. Changing that
identifier would point the application at an empty folder and look exactly
like data loss, so it must never change.

**A copy is taken before any new version's first run.** The Rust side records
which version last ran; when that changes — or when there is no record at all,
which is when we know least about what wrote the database — it copies the
database aside *before* the frontend opens it, and therefore before any
migration touches it. The ten most recent copies are kept. If a release ever
goes wrong, the previous state is sitting right there.

**Any of those copies can be put back from Settings.** Each one offers "Put
this back": the app stages it, restarts, keeps the current database in a
recoverable `before-restore` copy, and installs the chosen one. These copies
hold the database only, so her uploaded files are deliberately left exactly
where they are. She can also take one on demand before doing anything risky.

**Migrations only ever add.** `npm test` fails the build if a migration drops
or renames anything, or if an already-shipped migration is edited — installed
copies record a checksum of every migration they have applied, and changing
one makes those databases refuse to open. Both guards have deliberate
failure messages explaining what to do instead.

**She can make one complete portable backup.** Settings writes a single
`.hfdbackup` file containing the database (including her profile photo and
flight log) plus every imported study document. She chooses where it is saved,
so it can live on another drive or in a cloud-synced folder. The database's
write-ahead log is folded in first, and travels with the archive if that could
not finish, so a backup can never be missing what she did that morning.

**Settings says whether that backup is still current.** It records when the
last complete backup was saved and which version wrote it, then says so on the
card — and asks for a fresh one when the app has been updated since, or when
two weeks have passed. Saving one before an update, and restoring it if
anything looks wrong afterwards, is the intended routine.

**Restore is deliberately cautious.** The app checks that the archive holds
nothing but a real SQLite database and her documents — the header is verified
before and after extraction — and shows its date, app version, file count and
size before asking for confirmation. It stages the archive without touching
current data, restarts, then moves the current database and documents into a
recoverable `before-restore` copy before installing the restored set. A backup
written by a *newer* version is refused with an explanation rather than
installed, because an older app cannot read a newer training record.

**If the database will not open at all, the app offers the way back.** Instead
of only reporting the error, it shows where her data lives and offers to put
back either a `.hfdbackup` file or one of the automatic copies, then restarts.
None of that needs the database, so it still works when everything else does not.

Two honest limits: the automatic database copies live *inside* that folder and
do not include imported documents, so they protect against a bad update rather
than losing the machine — use **Save complete backup** for portable protection.
And uninstalling on Windows offers to delete application data; leaving that
box unticked is what keeps her records. A complete backup on another drive is
the only thing that survives ticking it.

---

## Architecture

```
src/
  domain/       Types and labels — the vocabulary the whole app speaks
  data/         SqlDatabase interface, drivers, migrations, repositories
  logic/        Pure functions: finance, actions, preparation, progress
  state/        Loading and mutation, exposed through React context
  services/     Document import and opening, across the Tauri boundary
  components/   Design system, layout, and shared Next Action components
  pages/        One directory per area of the product
src-tauri/
  migrations/   Canonical schema SQL
  src/          Thin Rust layer: private file storage and database setup
```

**Repositories, not SQL in components.** Every screen reaches storage through
a repository built on a narrow `SqlDatabase` interface. Swapping local
persistence for a hosted backend means writing one new implementation of that
interface, not touching screens.

**One schema, two runtimes.** The migration SQL in `src-tauri/migrations/` is
compiled into the Rust binary with `include_str!` and imported by the
TypeScript fallback with `?raw`, so the desktop database and the development
database cannot drift apart.

**Logic is pure and tested.** Fund balances, overdue detection, lesson
readiness, and goal evidence are plain functions over domain objects. The
dashboard is assembled by `logic/dashboard.ts` rather than inside the page, so
what it shows is testable.

**Money is integers.** All amounts are whole cents; dollars exist only at the
edges, for display and form input.

**The profile is a real profile.** Settings holds who she is (name,
certificate, current focus), where she trains (school, instructor, home
airport, aircraft, start date — all optional while she is still choosing a
school), her medical expiry, and her accent colour.
The training details pre-fill every new lesson so the instructor and airport
are not retyped; the accent re-themes the whole interface through the token
layer, so no component needed changing to support it.

**Her photo lives in the database, deliberately.** The schema warns against
putting binaries in SQLite and that still holds for study materials, which go
to disk. The profile photo is the exception: it is centre-cropped and
downscaled to 384px before it is ever saved, so a 6 MB phone photo becomes
roughly 8 KB. One small row beats a second file lifecycle and asset-protocol
scope for a single avatar, and it keeps her face in the same private database
as the rest of her.

**Fonts are bundled.** Fraunces and Inter ship with the application rather than
loading from a CDN, so a desktop app that may well be used at an airfield with
no signal always looks right. Fraunces carries its optical-size axis, so
headings are optically adjusted at display sizes. Inter is latin-only; the font
stacks in `tokens.css` cover anything outside that subset. The content security
policy allows no external style or font origins as a result.

---

## Product rules the code enforces

- **No invented progress.** Nothing computes a completion percentage for
  training. Progress is reported as evidence: lessons recorded, materials
  reviewed, checklist items done, confidence entries. The one percentage in the
  application is savings-target progress, which is real arithmetic against an
  amount the user chose.
- **Overdue work is visible, never shaming.** Overdue items get their own card
  with Complete and Reschedule, and rescheduling never destroys anything. There
  are no streaks to break.
- **Nothing is listed twice.** Today's Plan covers work due today and undated
  work; overdue work belongs to Needs Attention.
- **A lesson's cost can only be recorded once.** The repository returns the
  existing transaction, and a partial unique index makes the duplicate
  impossible even if two callers race.
- **One fact, one place.** Exam and checkride dates live on milestones, and
  dated deadlines live in the Schedule — neither is duplicated into the
  profile. The dashboard's "Dates ahead" reads from those, plus the medical
  expiry, rather than keeping its own copies.
- **A missed goal date is not a reproach.** An expired medical stays visible
  because it is a fact she needs; a milestone target that slipped quietly
  drops off rather than lingering as a rebuke. Finished work never reports
  its old due date.
- **One card asks nothing of her.** Why she started sits at the end of the
  dashboard, below the work. It is never analysed, scored, or turned into a
  prompt — it is only shown back to her, and only once she has written it.
- **One page asks nothing first.** Everywhere else a thought is typed, it has
  to belong to a lesson, a material, or a goal. Notes has a title she can leave
  blank and a box. It is the right shape for the stage she is at, where half of
  what is worth writing down does not belong to anything yet.
- **Instructors and official guidance stay authoritative.** The application
  organizes what the user puts into it and says so.

---

## Tests

```bash
npm test
```

Covers Flight Fund calculations, transaction totals, upcoming expense
derivation, overdue detection, completion and rescheduling, lesson preparation
state, goal evidence, encouragement tone, how a free-form note reads back when
she left the title blank, and the duplicate-lesson-expense guard. Repository tests run against real SQLite through `node:sqlite`, so the
schema's foreign keys and unique indexes are genuinely exercised, and the
migration tests apply new migrations to a database that already holds data.

### The desktop smoke test

```bash
scripts/desktop-smoke.sh
```

Three things exist only inside the real desktop shell and cannot be reached
from a browser or a unit test: the Rust migration runner building a real
database, the **native file chooser** the photo input opens, and writes
landing in the SQLite file in application data.

On Linux this drives the actual Tauri window on a virtual display — clicking
through to Settings, opening the GTK file chooser, choosing a generated test
image — and then asserts against the database rather than against pixels.
Screenshots of each step are left in `.smoke/` to look at. It needs `Xvfb`,
`xdotool` and ImageMagick, and it uses a throwaway `XDG_CONFIG_HOME` so it
never touches real training data.

On macOS and Windows there is no equivalent, so the file chooser is worth a
manual look after any change to how photos are added.
