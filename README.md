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

Before packaging for macOS or Windows, generate the platform icon formats once
with `npm run tauri icon src-tauri/icons/icon.png`.

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
schema's foreign keys and unique indexes are genuinely exercised.
