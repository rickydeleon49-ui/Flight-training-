/**
 * Her Flight Deck - Accepted-Main Shipped Migration Ledger (M4-R21)
 *
 * The single sanctioned way for the lifecycle proof to obtain shipped migration SQL and the
 * binary's schema ceiling. Both come from the verified accepted-main reference tree extracted under
 * scratch/accepted-main/ by scripts/prepare-accepted-main.mjs:
 *   - the ledger directory is discovered from that listing (never this worktree's own stale copy),
 *   - the ceiling is parsed from schema-ceiling.txt, which was itself parsed out of
 *     git show <pinned>:src-tauri/src/lib.rs,
 *   - every extracted .sql must match src/data/migration-checksums.json, or nothing runs.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const here = path.dirname(new URL(import.meta.url).pathname);
const packRoot = path.resolve(here, "..");

/**
 * The accepted-main reference tree. Resolved at call time and overridable via
 * M4_ACCEPTED_MAIN_ROOT so a disposable module copy in a temp directory can still be exercised
 * against the real verified reference bytes.
 */
export const referenceRoot = () => process.env.M4_ACCEPTED_MAIN_ROOT ?? path.join(packRoot, "scratch", "accepted-main");
export const ledgerDir = () => path.join(referenceRoot(), "src-tauri", "migrations");
export const checksumFile = () => path.join(referenceRoot(), "src/data/migration-checksums.json");
export const ceilingFile = () => path.join(referenceRoot(), "schema-ceiling.txt");
export const candidateDdlPath = () => path.join(packRoot, "candidate", "candidate_migration_0015.sql");
export const CANDIDATE_PROVISIONAL_VERSION = 15; // documented provisional number, never registered

const sha256File = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");

/** The accepted-base ceiling, parsed from the extracted reference (no literals in this suite). */
export function readCeiling(file = ceilingFile()) {
  const m = /CURRENT_SCHEMA_VERSION=(\d+)/.exec(fs.readFileSync(file, "utf8"));
  if (!m) throw new Error(`schema ceiling unreadable from ${file}`);
  return Number(m[1]);
}

/**
 * Discovers and verifies the shipped migration ledger: fails on a missing checksum entry, an extra
 * or absent file, a digest mismatch, or a count that disagrees with the accepted-base ceiling.
 */
export function loadVerifiedLedger(dir = ledgerDir(), checksums = checksumFile(), ceilingFrom = ceilingFile()) {
  if (!fs.existsSync(dir)) throw new Error(`migration ledger directory missing: ${dir}`);
  if (!fs.existsSync(checksums)) {
    throw new Error("accepted-main migration-checksums.json missing; run scripts/prepare-accepted-main.mjs first");
  }
  const checksumMap = JSON.parse(fs.readFileSync(checksums, "utf8"));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    if (!checksumMap[f]) throw new Error(`ledger file ${f} has no checksum entry`);
    const actual = sha256File(path.join(dir, f));
    if (actual !== checksumMap[f]) throw new Error(`checksum mismatch for ${f}: expected ${checksumMap[f]}, got ${actual}`);
  }
  for (const name of Object.keys(checksumMap)) {
    if (!files.includes(name)) throw new Error(`checksum manifest lists ${name} but the ledger does not contain it`);
  }
  const ceiling = readCeiling(ceilingFrom);
  if (files.length !== ceiling) throw new Error(`ledger holds ${files.length} migrations but the accepted base is ${ceiling}`);
  return { files, ceiling };
}

/** Applies the verified ledger to a disposable database and records the plugin's own version rows. */
export function applyShippedMigrations(db, dir = ledgerDir(), checksums = checksumFile(), ceilingFrom = ceilingFile()) {
  const { files, ceiling } = loadVerifiedLedger(dir, checksums, ceilingFrom);
  for (const f of files) db.exec(fs.readFileSync(path.join(dir, f), "utf8"));
  db.exec("CREATE TABLE IF NOT EXISTS _sqlx_migrations (version INTEGER PRIMARY KEY);");
  for (const f of files) db.prepare("INSERT OR REPLACE INTO _sqlx_migrations(version) VALUES (?)").run(Number(f.slice(0, 4)));
  return { count: files.length, ceiling };
}

export function candidateDdlText() {
  return fs.readFileSync(candidateDdlPath(), "utf8");
}

/**
 * Faithful isolated replica of the accepted backup gate (src-tauri/src/backup.rs:609-637):
 * discover the migration ledger table, read MAX(version), refuse anything above this binary's ceiling.
 */
export function probeBinaryCompatibility(db, binaryCeiling) {
  const table = ["_sqlx_migrations", "schema_migrations"].find((name) => {
    const row = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name=?").get(name);
    return row && row.n === 1;
  });
  if (!table) return { compatible: false, error: "That backup does not contain Her Flight Deck migration history." };
  const newest = Number(db.prepare(`SELECT COALESCE(MAX(version), 0) AS v FROM ${table}`).get().v);
  if (newest > binaryCeiling) {
    return { compatible: false, newest, ceiling: binaryCeiling, error: "That backup was created by a newer database format. Update the app first." };
  }
  return { compatible: true, newest, ceiling: binaryCeiling };
}
