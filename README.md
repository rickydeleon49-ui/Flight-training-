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

She should not have to build anything. The release workflow prepares
both installers and attaches them to a private GitHub Release **draft**,
where an owner reviews the exact files before publishing.

**From the browser**, with nothing installed anywhere:

> Actions → **Release** → Run workflow → type the version → Run

It checks the version against `scripts/release-policy.json`, builds the macOS
and Windows installers, and creates a private release draft. Follow
[the release review process](docs/RELEASE_REVIEW_PROCESS.md) to inspect and
test the exact draft assets before publishing.

**Or from a clone**, if you have one:

```bash
scripts/release.sh <version>                  # validates, bumps, checks, commits, tags
git push origin <branch> && git push origin v<version>
```

The release notes are written for her, not for a developer: which file to
take, what each system asks the first time, and that updating keeps
everything she has entered.

Release `v0.5.1` is the current distributable version. Version `0.5.2` was
withdrawn and is permanently retired (see `scripts/release-policy.json`). Any
future release will be prepared as `0.5.3` or later after all verification
gates are satisfied.

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
until verified and tested per the release review process.

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
long-term distribution path.

In accordance with [the release review process](docs/RELEASE_REVIEW_PROCESS.md):

- **Drafts stay private:** Workflow runs produce private release drafts for
  owner inspection, not immediate public downloads.
- **Never bypass platform protections:** If Microsoft Defender, Windows
  SmartScreen, macOS Gatekeeper, or browser Safe Browsing flags an installer,
  the draft must remain private and held from distribution. Never instruct
  users to bypass, disable, or weaken operating system or browser protections
  (such as running quarantine removal commands or lowering Safe Browsing).
- **Vendor review for detections:** Any flagged installer must be investigated
  and submitted for vendor analysis (e.g. Microsoft Security Intelligence
  developer dispute). If a detection cannot be resolved or signed, the draft
  must be discarded and a new version prepared.
- **Checksum verification:** Each draft provides SHA-256 checksums in
  `SHA256SUMS.txt`. Comparing checksums verifies download transmission
  integrity, but does not substitute for platform security clearance.

### It needs a reasonably current system

Every form in the application is a native `<dialog>`. WebKit only supports
that from Safari 15.4, so the macOS bundle declares **12.0** as its minimum —
on anything older the dialogs would simply not open. Windows uses WebView2,
which is evergreen, so any supported Windows 10 or 11 is fine.

---

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
once; images ride the 100 MB inline request cap. The application checks all of
this before she clicks, so an oversized file is a next step rather than a wasted
upload.

**When Google is busy.** A `503` means Google's own capacity is short for a
moment — nothing to do with her key, her quota, or her document. Generating
retries four times with a growing pause, then tries Gemini Flash-Lite once, and
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
