# Her Flight Deck — where things stand

_Last updated: 5 September 2026 · version 0.1.0 · branch `claude/her-flight-deck-spec-sxa0a5`_

The application is built and working. Nineteen commits, ~15,000 lines, 151
tests passing. Every one of the seven areas in `PRODUCT_SPEC.md` is
implemented with real persistence behind it — there are no placeholder
screens and no buttons that do nothing.

What is left is not building. It is getting the file into her hands, and
finding out whether the two builds I could not run actually work.

---

## Do this next

### 1. Publish the installers

In the repository, go to **Actions → Release → Run workflow**, type `0.1.0`,
and run it. That creates the tag, builds the Mac and Windows installers, and
puts them on the **Releases** page with instructions written for her.

Nothing needs to be installed anywhere to do this.

> I could not do it from here: this session's credentials are scoped to the
> working branch, so pushing a tag is refused, and the GitHub tools available
> to me are read-only for releases. That is why the workflow can create the
> tag itself.

### 2. Decide how she gets the file

The repository is **private**, so downloading from the Releases page needs a
GitHub account with access to it.

| Option | What it means |
| --- | --- |
| **Send her the file** | You download the `.dmg` or `.exe` and pass it to her. Simplest — it is one file and runs identically. |
| Add her as a collaborator | She needs a GitHub account, then downloads it herself each time. |
| Make the repository public | The code is only source; her data never goes near it. But it is your call, and you deliberately made it private. |

### 3. Tell her about the first-run prompt

Neither installer is code-signed, so each system asks once:

- **Mac** — "Apple could not verify…" → **System Settings → Privacy &
  Security → Open Anyway**
- **Windows** — blue "Windows protected your PC" → **More info → Run anyway**

Once per machine. The release notes say this too, in her words.

---

## What is built

| Area | State |
| --- | --- |
| **Flight Deck** | Today's Flight Plan with the four sections, most-important-next, next flight with real preparation items, current milestone, study focus, needs attention, dates ahead, encouragement, and her why |
| **Flight Path** | Milestones as a route with waypoints; add, rename, restatus, reorder, delete. Goals with checklists, notes, confidence and evidence |
| **Study Library** | Real file import into private storage, metadata, tags, filters, search, document workspace, missing-file handling |
| **Schedule** | Lessons and events, month grid, preparation checklists, attached materials, costs, status |
| **Flight Journal** | Structured debriefs, history, and a second view collecting instructor feedback across lessons |
| **Questions** | Running list with statuses and answers; unasked ones surface before the next lesson |
| **Finances** | Flight Fund derived entirely from the ledger, upcoming costs, savings target, cost insights |
| **Settings** | Profile, where she trains, key dates, why she started, photo, accent colour, demo data, complete portable backup and safe restore |

### The core workflow runs end to end

Create a lesson → attach preparation → attach study material → both appear on
Today's Flight Plan → complete it → write the debrief → its conclusion becomes
a next action on the plan → record what the lesson cost. Driven in a browser
against an empty database; all eight steps pass.

### Her data survives updates

- One folder holds everything, keyed to the bundle identifier
  `com.herflightdeck.app` — **this must never change**, or the application
  will look at an empty folder and it will read as data loss.
- The database is copied aside before the first run of any new version,
  before any migration touches it. Ten kept.
- Tests fail the build if a migration drops or renames anything, or if an
  already-shipped migration is edited.
- Settings shows the folder and can save or restore one portable `.hfdbackup`
  containing the database, profile photo, flight log, and uploaded documents.

---

## What is verified, and what is not

### Verified by running it

- 174 tests, including real SQLite for repositories and migrations
- The Linux desktop app: window, Rust migrations, native GTK file chooser,
  photo reaching the real database (`scripts/desktop-smoke.sh`)
- The release binary boots and runs under the production content security
  policy with embedded assets
- An update copies her database aside — simulated 0.1.0 → 0.1.1 with her name
  and why note intact in the copy
- Fonts load with no external requests

### Not verified — no Mac or Windows here

- **The macOS build has never run.** Config and icons are right, but the
  first build is the proof.
- **The Windows build has never run.** Same. This is the likeliest thing to
  fail first.
- The **native file chooser on Mac and Windows** — verified only on Linux.
  After any change to how photos or materials are added, add one by hand.

If either build fails, the Actions log will say why, and it is almost
certainly a small fix.

---

## Known limits

**Automatic update backups live inside the folder they protect.** They save
you from a bad update, not from a lost machine. Complete `.hfdbackup` files can
be saved elsewhere and include uploaded documents, but the user still has to
make one periodically.

**No automatic updates.** A new version means downloading and running the
installer again. Her data is preserved. Tauri has an updater, but pointing it
at a private repository means embedding a token in the application, which is
worse than the problem.

**Unsigned installers.** Removing the first-run prompt entirely needs a paid
Apple Developer account and a Windows code signing certificate.

**Demo data has no photo.** Inventing a face for a fictional trainee seemed
worse than leaving it blank.

---

## Worth doing, roughly in order

1. **Windows and macOS smoke checks.** The Linux script cannot be ported, but
   a short written checklist she or you can run after an update would catch
   the same class of problem.
2. **Study material previews.** The spec asks for a preview "when supported";
   today it opens in the system viewer. An embedded PDF view is listed as a
   future feature in the spec, not a V1 requirement.
3. Anything in spec §44 — flashcards, study timer, calendar sync, spending
   charts. All explicitly out of scope for the first release.

---

## Things not to re-derive

- `tauri-plugin-sql` resolves a `sqlite:` URL against the **config**
  directory, not the data directory. Documents and backups were moved to
  match; on Linux those are different places and the mismatch is silent.
- `deleteAppDataOnUninstall` is **not** a field this Tauri version accepts. It
  fails the build outright.
- Errors crossing the Tauri boundary arrive as **plain strings**, not `Error`
  instances. Narrowing only on `Error` throws away the real message.
- Every form is a native `<dialog>`, which needs WebKit 15.4 — hence macOS
  **12.0** as the declared minimum. Do not lower it.
- The version number is not bookkeeping: the pre-update backup only happens
  when the version changes. `scripts/release.sh` and the release workflow both
  refuse releases that would skip it.
- The browser dev mode (`npm run dev`) runs the same SQL against WebAssembly
  SQLite. It is for working on the interface, never the product's storage.
