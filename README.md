# Her Flight Deck

A personal flight-training companion that keeps study, lessons, goals, notes,
finances, and next steps organized in one private workspace.

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

She should not have to build anything. Push a version tag and GitHub builds
both installers and publishes them on the repository's **Releases** page,
where she downloads one file and opens it.

**From the browser**, with nothing installed anywhere:

> Actions → **Release** → Run workflow → type the version → Run

It creates the tag, builds both installers, and publishes them. This is the
whole process; you never need a clone.

**Or from a clone**, if you have one:

```bash
scripts/release.sh 0.2.0                       # bumps, checks, commits, tags
git push origin <branch> && git push origin v0.2.0
```

The release notes are written for her, not for a developer: which file to
take, what each system asks the first time, and that updating keeps
everything she has entered.

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

**Neither installer is code-signed**, so each system asks once whether she
meant to open it. That is unavoidable without a paid Apple Developer account
and a Windows code signing certificate; the release notes tell her exactly
what she will see and what to click.

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
macOS    src-tauri/target/release/bundle/dmg/Her Flight Deck_0.1.0_aarch64.dmg
Windows  src-tauri/target/release/bundle/nsis/Her Flight Deck_0.1.0_x64-setup.exe
```

Apple Silicon builds arm64 only. For one binary that also runs on Intel Macs:

```bash
rustup target add x86_64-apple-darwin aarch64-apple-darwin
npm run tauri build -- --target universal-apple-darwin
```

### Neither installer is code-signed

Built and run on the same machine that is fine. An installer downloaded from
GitHub Actions comes from elsewhere, so the first launch needs:

- **macOS** — right-click → Open, or
  `xattr -dr com.apple.quarantine "/Applications/Her Flight Deck.app"`
- **Windows** — SmartScreen shows "Windows protected your PC"; choose
  **More info → Run anyway**

Signing properly needs a paid Apple Developer account and a Windows code
signing certificate. For a private personal application it is not worth it.

### It needs a reasonably current system

Every form in the application is a native `<dialog>`. WebKit only supports
that from Safari 15.4, so the macOS bundle declares **12.0** as its minimum —
on anything older the dialogs would simply not open. Windows uses WebView2,
which is evergreen, so any supported Windows 10 or 11 is fine.

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

Four things keep it safe across releases:

**The folder is keyed to the bundle identifier**, `com.herflightdeck.app`.
Installing a new version over an old one leaves it untouched. Changing that
identifier would point the application at an empty folder and look exactly
like data loss, so it must never change.

**A copy is taken before any new version's first run.** The Rust side records
which version last ran; when that changes it copies the database aside
*before* the frontend opens it, and therefore before any migration touches
it. The ten most recent copies are kept. If a release ever goes wrong, the
previous state is sitting right there.

**Migrations only ever add.** `npm test` fails the build if a migration drops
or renames anything, or if an already-shipped migration is edited — installed
copies record a checksum of every migration they have applied, and changing
one makes those databases refuse to open. Both guards have deliberate
failure messages explaining what to do instead.

**She can copy it out herself.** Settings shows the folder, opens it in
Finder or Explorer, and takes a database copy on demand.

One honest limit: the automatic copies live *inside* that folder, so they
protect against a bad update, not against losing the machine or an uninstaller
that offers to remove application data. For that, copy the folder somewhere
else — the "Open folder" button in Settings is there to make that easy.

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
airport, aircraft, start date), her medical expiry, and her accent colour.
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
- **Instructors and official guidance stay authoritative.** The application
  organizes what the user puts into it and says so.

---

## Tests

```bash
npm test
```

Covers Flight Fund calculations, transaction totals, upcoming expense
derivation, overdue detection, completion and rescheduling, lesson preparation
state, goal evidence, encouragement tone, and the duplicate-lesson-expense
guard. Repository tests run against real SQLite through `node:sqlite`, so the
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
