// Screenshots the browser-mode app (`npm run dev`, SQLite in WebAssembly).
// Usage: node .claude/skills/run/screenshot.mjs [route ...] [--out DIR] [--width N] [--dark]
//
// Reuses a server already listening on the port and never stops it. Otherwise
// starts Vite itself and stops it on every exit path: startup timeout, browser
// launch failure, navigation or screenshot failure, and browser-close failure.
//
// Playwright is not a project dependency (the repository gates new packages),
// so this resolves the copy installed globally in the cloud container.
//
// Test seams, used only by .claude/tests/setup-helpers.test.mjs:
//   HFD_SHOT_PORT        port to use instead of 1420
//   HFD_SHOT_PLAYWRIGHT  path to a module exporting `chromium`
//   HFD_SHOT_SERVER      JSON argv for the server instead of Vite
//   HFD_SHOT_TIMEOUT_MS  how long to wait for the server to answer
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
const startupMs = Number(process.env.HFD_SHOT_TIMEOUT_MS || 30000);
const serverArgv = process.env.HFD_SHOT_SERVER
  ? JSON.parse(process.env.HFD_SHOT_SERVER)
  : ["npx", "vite", "--port", String(port), "--strictPort"];

const isUp = () => fetch(BASE).then(() => true, () => false);

async function loadChromium() {
  if (process.env.HFD_SHOT_PLAYWRIGHT) {
    return (await import(pathToFileURL(process.env.HFD_SHOT_PLAYWRIGHT).href)).chromium;
  }
  const require = createRequire(join(execSync("npm root -g").toString().trim(), "_"));
  return require("playwright").chromium;
}

// Only a server this script started is ever stopped.
let server = null;
let serverExited = false;
// The whole process group is signalled, because npx leaves Vite as a child
// that can outlive it; a group that is already gone is not an error.
function stopServer() {
  if (!server) return;
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch (error) {
    if (error.code !== "ESRCH") throw error; // ESRCH: already gone
  }
}

let browser = null;
const errors = [];
let failure = null;

try {
  if (!(await isUp())) {
    server = spawn(serverArgv[0], serverArgv.slice(1), { stdio: "ignore", detached: true });
    server.on("exit", () => (serverExited = true));
    server.on("error", () => (serverExited = true));
    const deadline = Date.now() + startupMs;
    while (!(await isUp())) {
      if (serverExited) throw new Error("The dev server exited before answering");
      if (Date.now() > deadline) throw new Error(`The dev server did not answer on :${port}`);
      await new Promise((r) => setTimeout(r, 250));
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
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

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
  failure = error;
} finally {
  // Each step runs even if the one before it fails; the first error wins.
  if (browser) {
    try {
      await browser.close();
    } catch (error) {
      failure ??= error;
    }
  }
  try {
    stopServer();
  } catch (error) {
    failure ??= error;
  }
}

if (failure) {
  console.error(failure.message ?? failure);
  process.exitCode = 1;
} else if (errors.length) {
  console.error("Browser errors:\n" + errors.join("\n"));
  process.exitCode = 1;
}
