// Screenshots the browser-mode app (`npm run dev`, SQLite in WebAssembly).
// Usage: node .claude/skills/run/screenshot.mjs [route ...] [--out DIR] [--width N] [--dark]
//
// Reuses a server already answering on the port and never signals it. Otherwise
// starts Vite itself and stops it on every exit path: startup timeout, browser
// launch failure, navigation or screenshot failure, and browser-close failure.
//
// Every wait is bounded:
//   - each readiness request is cancelled after PROBE_MS (and never runs past
//     the startup deadline), so a server that accepts connections but never
//     answers cannot hang the helper;
//   - startup gives up after STARTUP_MS;
//   - stopping the server this run started sends SIGTERM to its process group,
//     waits GRACE_MS, then sends SIGKILL and waits KILL_WAIT_MS, and checks that
//     the whole group has gone.
// Any failure, including a failed browser close, exits 1. The first error is
// the one reported; later cleanup errors are printed as well.
//
// Playwright is not a project dependency (the repository gates new packages),
// so this resolves the copy installed globally (`npm root -g`).
//
// Test seams, used only by .claude/tests/setup-helpers.test.mjs:
//   HFD_SHOT_PORT        port to use instead of 1420
//   HFD_SHOT_PLAYWRIGHT  path to a module exporting `chromium`
//   HFD_SHOT_SERVER      JSON argv for the server instead of Vite
//   HFD_SHOT_TIMEOUT_MS  startup budget (default 30000)
//   HFD_SHOT_PROBE_MS    one readiness request (default 2000)
//   HFD_SHOT_GRACE_MS    wait after SIGTERM before SIGKILL (default 5000)
import { spawn, execSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  if (i === -1) return fallback;
  const value = args[i + 1];
  args.splice(i, 2);
  return value;
};
const dark = args.includes("--dark");
if (dark) args.splice(args.indexOf("--dark"), 1);
const outDir = resolve(flag("--out", "screenshots"));
const width = Number(flag("--width", "1280"));
const routes = args.length ? args : ["/"];

const port = Number(process.env.HFD_SHOT_PORT || 1420);
const BASE = `http://localhost:${port}`;
const STARTUP_MS = Number(process.env.HFD_SHOT_TIMEOUT_MS || 30_000);
const PROBE_MS = Number(process.env.HFD_SHOT_PROBE_MS || 2_000);
const GRACE_MS = Number(process.env.HFD_SHOT_GRACE_MS || 5_000);
const KILL_WAIT_MS = 2_000;
const serverArgv = process.env.HFD_SHOT_SERVER
  ? JSON.parse(process.env.HFD_SHOT_SERVER)
  : ["npx", "vite", "--port", String(port), "--strictPort"];

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

/**
 * One bounded readiness request: "up" for any HTTP response, "silent" when the
 * request was cancelled at its time limit (something accepted it but did not
 * answer), "down" when nothing accepted it.
 */
async function probe(timeoutMs) {
  if (timeoutMs <= 0) return "silent";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(BASE, { signal: controller.signal });
    await response.body?.cancel().catch(() => {});
    return "up";
  } catch {
    return controller.signal.aborted ? "silent" : "down";
  } finally {
    clearTimeout(timer);
  }
}

async function loadChromium() {
  if (process.env.HFD_SHOT_PLAYWRIGHT) {
    return (await import(pathToFileURL(process.env.HFD_SHOT_PLAYWRIGHT).href)).chromium;
  }
  const require = createRequire(join(execSync("npm root -g").toString().trim(), "_"));
  return require("playwright").chromium;
}

// Only a server this run started is ever signalled. npx leaves Vite as a child
// that can outlive it, so the detached process group is the unit of ownership.
let server = null;
let serverExited = false;

function groupAlive() {
  try {
    process.kill(-server.pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

function signalGroup(signal) {
  try {
    process.kill(-server.pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error; // already gone is fine
  }
}

async function waitForGroupExit(ms) {
  const end = Date.now() + ms;
  while (groupAlive()) {
    if (Date.now() >= end) return false;
    await sleep(50);
  }
  return true;
}

async function stopServer() {
  if (!server || server.pid === undefined) return; // reused server, or spawn failed
  if (!groupAlive()) return;
  signalGroup("SIGTERM");
  if (await waitForGroupExit(GRACE_MS)) return;
  signalGroup("SIGKILL");
  if (!(await waitForGroupExit(KILL_WAIT_MS))) {
    throw new Error(`The dev server this run started (process group ${server.pid}) did not exit after SIGKILL`);
  }
}

let browser = null;
const pageErrors = [];
let failure = null;
const note = (error) => {
  if (failure === null) failure = error;
  else console.error(`Also failed during cleanup: ${error?.message ?? error}`);
};

try {
  const initial = await probe(PROBE_MS);
  if (initial === "silent") {
    throw new Error(
      `Something is listening on :${port} but did not answer within ${PROBE_MS} ms. It was left running; stop it or free the port.`,
    );
  }
  if (initial === "down") {
    server = spawn(serverArgv[0], serverArgv.slice(1), { stdio: "ignore", detached: true });
    server.on("exit", () => (serverExited = true));
    server.on("error", () => (serverExited = true));
    const deadline = Date.now() + STARTUP_MS;
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`The dev server did not answer on :${port} within ${STARTUP_MS} ms`);
      if ((await probe(Math.min(PROBE_MS, remaining))) === "up") break;
      if (serverExited) throw new Error("The dev server exited before answering");
      await sleep(Math.min(250, deadline - Date.now()));
    }
  }

  mkdirSync(outDir, { recursive: true });
  const chromium = await loadChromium();
  browser = await chromium.launch();
  // A fresh context per run: no cookies or storage carried between runs.
  const context = await browser.newContext({
    viewport: { width, height: 900 },
    colorScheme: dark ? "dark" : "light",
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (m) => m.type() === "error" && pageErrors.push(m.text()));

  for (const route of routes) {
    await page.goto(BASE + route, { waitUntil: "networkidle" });
    await page.waitForTimeout(300);
    const name =
      (route.replace(/^\/|\/$/g, "").replace(/\//g, "_") || "home") + (dark ? "-dark" : "") + ".png";
    const file = join(outDir, name);
    await page.screenshot({ path: file, fullPage: true });
    console.log(file);
  }
} catch (error) {
  note(error);
} finally {
  // Each step runs even if the one before it failed; the first error wins.
  if (browser) {
    try {
      await browser.close();
    } catch (error) {
      note(error);
    }
  }
  try {
    await stopServer();
  } catch (error) {
    note(error);
  }
}

if (failure) {
  console.error(failure?.message ?? failure);
  process.exitCode = 1;
} else if (pageErrors.length) {
  console.error("Browser errors:\n" + pageErrors.join("\n"));
  process.exitCode = 1;
}
