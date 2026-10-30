#!/usr/bin/env node
/**
 * Builds src/data/airportCoords.json: the codes she might type for a US
 * airport (KPAO, PAO, ...) mapped to its rounded position, so the
 * flight log can show a quiet sunset / night hint. Nothing else uses it.
 *
 * Source: OurAirports open data (public domain, The Unlicense)
 *   https://github.com/davidmegginson/ourairports-data
 * pinned to one commit and checked by SHA-256, so a rebuild is reproducible.
 *
 * Usage:
 *   node scripts/build-airport-coords.mjs            # downloads the pinned file once
 *   node scripts/build-airport-coords.mjs airports.csv  # uses a local copy (still verified)
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const SOURCE_COMMIT = "2e34576752d971d8ce38b7187c6588e699535a29"; // main, 29 Oct 2026
export const SOURCE_SHA256 = "f508467c19122ea549200daa215ea477eae2dc5375f339fd4e8226736c5981ea";
export const SOURCE_URL = `https://raw.githubusercontent.com/davidmegginson/ourairports-data/${SOURCE_COMMIT}/airports.csv`;

/** US states and DC, plus the inhabited US territories (they have their own country codes). */
const COUNTRIES = new Set(["US", "PR", "VI", "GU", "AS", "MP"]);
const TYPES = new Set(["small_airport", "medium_airport", "large_airport", "seaplane_base"]);
/** Earlier fields win when two airports share a code (an ident beats someone else's IATA code). */
const CODE_FIELDS = ["ident", "icao_code", "gps_code", "local_code", "iata_code"];

/** Minimal RFC 4180 parser: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const round3 = (value) => Math.round(value * 1000) / 1000;

export function buildCoords(csvText) {
  const [header, ...records] = parseCsv(csvText);
  const col = Object.fromEntries(header.map((name, index) => [name, index]));
  const airports = [];
  for (const row of records) {
    if (row.length < header.length) continue;
    if (!COUNTRIES.has(row[col.iso_country]) || !TYPES.has(row[col.type])) continue;
    const lat = Number(row[col.latitude_deg]);
    const lon = Number(row[col.longitude_deg]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    airports.push({ row, lat: round3(lat), lon: round3(lon) });
  }
  // Bigger airports first, then by ident, so a shared code goes to the one she most likely means.
  const rank = { large_airport: 0, medium_airport: 1, small_airport: 2, seaplane_base: 3 };
  airports.sort(
    (a, b) =>
      rank[a.row[col.type]] - rank[b.row[col.type]] ||
      (a.row[col.ident] < b.row[col.ident] ? -1 : a.row[col.ident] > b.row[col.ident] ? 1 : 0),
  );
  const codesByAirport = airports.map(() => []);
  const taken = new Set();
  for (const field of CODE_FIELDS) {
    airports.forEach((airport, index) => {
      const code = airport.row[col[field]].trim().toUpperCase();
      if (!/^[A-Z0-9]{2,7}$/.test(code) || taken.has(code)) return;
      taken.add(code);
      codesByAirport[index].push(code);
    });
  }
  // One compact row per airport: "CODES|lat|lon", codes space-separated, so the codes of one
  // airport share one position. No names: the app never shows them.
  const rows = [];
  airports.forEach((airport, index) => {
    if (codesByAirport[index].length === 0) return;
    rows.push(`${codesByAirport[index].join(" ")}|${airport.lat}|${airport.lon}`);
  });
  return {
    source: `OurAirports (public domain), davidmegginson/ourairports-data@${SOURCE_COMMIT}`,
    format: "CODES|lat|lon",
    rows,
  };
}

const countCodes = (result) => result.rows.reduce((n, row) => n + row.split("|")[0].split(" ").length, 0);

async function main() {
  const local = process.argv[2];
  let bytes;
  if (local) bytes = readFileSync(local);
  else {
    const response = await fetch(SOURCE_URL);
    if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (sha !== SOURCE_SHA256) throw new Error(`SHA-256 mismatch: expected ${SOURCE_SHA256}, got ${sha}`);
  const result = buildCoords(bytes.toString("utf8"));
  const out = fileURLToPath(new URL("../src/data/airportCoords.json", import.meta.url));
  const json = `${JSON.stringify(result)}\n`;
  writeFileSync(out, json);
  console.log(
    `Wrote ${out}: ${result.rows.length} airports, ${countCodes(result)} codes, ${Buffer.byteLength(json)} bytes`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
