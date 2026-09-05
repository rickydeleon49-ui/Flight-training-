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

---

## On a Mac

Tauri builds for the machine it runs on, so a macOS application has to be
built on macOS. Two ways to get one.

### Build it yourself

Once, to set the machine up:

```bash
xcode-select --install                                            # Apple's build tools
brew install node                                                 # or from nodejs.org
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh    # Rust
```

Then, in the project:

```bash
npm install
npm run tauri dev      # develop, with live reload
npm run tauri build    # package
```

The build leaves you:

```
src-tauri/target/release/bundle/macos/Her Flight Deck.app
src-tauri/target/release/bundle/dmg/Her Flight Deck_0.1.0_aarch64.dmg
```

Apple Silicon builds arm64 only by default. For one binary that also runs on
Intel Macs:

```bash
rustup target add x86_64-apple-darwin aarch64-apple-darwin
npm run tauri build -- --target universal-apple-darwin
```

### Or let GitHub build it

The **Build macOS app** workflow under the Actions tab produces a downloadable
`.dmg` without a local toolchain. It is manual-trigger only, because macOS
runners bill at ten times the Linux rate.

### Things macOS does differently

**The app is not code-signed.** Built and run on the same Mac that is fine —
macOS only quarantines files that arrive from elsewhere. A `.dmg` you download
from GitHub Actions *is* from elsewhere, so the first launch needs either a
right-click → Open, or:

```bash
xattr -dr com.apple.quarantine "/Applications/Her Flight Deck.app"
```

Signing it properly needs a paid Apple Developer account; for a private
personal application it is not worth it.

**It needs a reasonably current macOS.** Every form in the application is a
native `<dialog>`, which WebKit only supports from Safari 15.4 — macOS 12.3,
or an older system with Safari updated. The bundle declares 12.0 as its
minimum. On anything older the dialogs simply will not open, so the floor is
deliberate rather than cautious.

**Where her data lives:**

```
~/Library/Application Support/com.herflightdeck.app/
    her-flight-deck.db     the database
    documents/             imported study materials
```

That directory is what to back up, and what to delete for a clean start.
Nothing is written anywhere else, and nothing leaves the machine.

**`scripts/desktop-smoke.sh` is Linux only.** There is no equivalent for the
macOS file chooser, so after changing how photos or study materials are added,
open Settings and add one by hand.

---

## Privacy

This is a private personal application, and the repository holds source code
only.

- Imported study materials are copied into the Tauri application data directory
  and referenced from the database by relative path.
- The SQLite database lives in that same application data directory — never in
  the project.
- `.gitignore` blocks personal document formats, local databases, and the
  directories uploads would land in.
- Demo data is clearly fictional and is only ever loaded on request from
  Settings.

Nothing is uploaded anywhere.

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
