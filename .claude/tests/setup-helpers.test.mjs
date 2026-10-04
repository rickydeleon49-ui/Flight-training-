// Checks for the Claude Code setup helpers in .claude/ (PR #70, SETUP-R2–R7).
// Run with:  node --test .claude/tests/setup-helpers.test.mjs
//
// Everything runs in fresh temporary directories with mock processes:
// - the session hook runs real `npm` offline against a dependency-free fixture
//   (temporary npm cache, no network, no packages) with mock cargo/pkg-config;
// - the screenshot helper runs against a mock Playwright module and dummy
//   HTTP servers on free ports. Every helper run has an outer watchdog and the
//   test kills anything it started, so no check can leave a process behind.
// No owner data, app profile, real browser, Tauri build or network is used.
//
// HFD_SETUP_UNDER_TEST  directory holding the `.claude/` files to check
//                       (default: this checkout), so earlier versions can be
//                       checked too.
// HFD_SETUP_PLAIN_PATH=1  put R4 hook fixtures at a path without spaces (the R2
//                       checks always use their own paths).
// The screenshot runner sets both seam schemes used by earlier versions
// (HFD_SHOT_* and HFD_SCREENSHOT_* plus PATH mocks for npx and `npm root -g`),
// so the same checks can run on any of them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const UNDER_TEST = resolve(process.env.HFD_SETUP_UNDER_TEST || join(HERE, "..", ".."));
const CLAUDE_DIR = join(UNDER_TEST, ".claude");
const NPM_DEPS = join(CLAUDE_DIR, "hooks/npm-deps.sh");
const SCREENSHOT = join(CLAUDE_DIR, "skills/run/screenshot.mjs");
const HOOK_COMMAND = JSON.parse(readFileSync(join(CLAUDE_DIR, "settings.json"), "utf8")).hooks.SessionStart[0].hooks[0].command;
const REAL_NPM = execFileSync("/bin/sh", ["-c", "command -v npm"]).toString().trim();
const NODE = process.execPath;
const PLAIN = process.env.HFD_SETUP_PLAIN_PATH === "1";
// Standard system tools only (macOS keeps sha256sum in /sbin); never the developer's own PATH.
const SYSTEM_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";

const tmp = (label) => mkdtempSync(join(tmpdir(), `hfd-setup ${label}-`));
const sha = (file) => (existsSync(file) ? createHash("sha256").update(readFileSync(file)).digest("hex") : "missing");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
};
function script(path, body) {
  writeFileSync(path, body);
  chmodSync(path, 0o755);
}
const listing = (dir) => readdirSync(dir, { recursive: true }).sort().join("\n");

// ============================================================ session hook
const TRACKED = ["package.json", "package-lock.json", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock"];
const tracked = (dir) => TRACKED.map((f) => `${f} ${sha(join(dir, f))}`);

/** A checkout-shaped fixture plus mock tools that log their arguments. */
function hookFixture(label, { lock = true, pkg = {}, spaced = !PLAIN, cargoEditsLock = false } = {}) {
  const root = tmp(label);
  const checkout = join(root, spaced ? "Her Flight Deck checkout" : "checkout");
  mkdirSync(join(checkout, ".claude"), { recursive: true });
  mkdirSync(join(checkout, "src-tauri"), { recursive: true });
  cpSync(join(CLAUDE_DIR, "hooks"), join(checkout, ".claude/hooks"), { recursive: true });
  writeFileSync(join(checkout, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0", private: true, scripts: { build: "node build.cjs" }, ...pkg }, null, 2) + "\n");
  if (lock) writeFileSync(join(checkout, "package-lock.json"), JSON.stringify({ name: "fixture", version: "1.0.0", lockfileVersion: 3, requires: true, packages: { "": { name: "fixture", version: "1.0.0" } } }, null, 2) + "\n");
  writeFileSync(join(checkout, "build.cjs"), "const fs=require('fs');fs.mkdirSync('dist',{recursive:true});fs.writeFileSync('dist/index.html','x');\n");
  writeFileSync(join(checkout, "src-tauri/Cargo.toml"), '[package]\nname = "fixture"\nversion = "1.0.0"\n');
  writeFileSync(join(checkout, "src-tauri/Cargo.lock"), "version = 4\n");
  const bin = join(root, "bin");
  mkdirSync(bin);
  const log = join(root, "calls.log");
  // npm: log, optionally force `npm ls` to fail (a simulated damaged cache), then run the real npm.
  script(join(bin, "npm"), `#!/bin/sh\necho "npm $*" >> "${log}"\nif [ "$1" = "ls" ] && [ -n "$SHIM_LS_FAIL" ]; then exit 1; fi\nexec "${REAL_NPM}" "$@"\n`);
  script(join(bin, "cargo"), `#!/bin/sh\necho "cargo $*" >> "${log}"\n${cargoEditsLock ? `echo "# edited" >> "${join(checkout, "src-tauri/Cargo.lock")}"\n` : ""}`);
  script(join(bin, "pkg-config"), "#!/bin/sh\nexit 0\n");
  script(join(bin, "apt-get"), `#!/bin/sh\necho "apt-get $*" >> "${log}"\nexit 1\n`);
  return { root, checkout, bin, log };
}

function runHook(fx, { remote, command = HOOK_COMMAND, extraEnv = {} }) {
  const env = {
    PATH: `${fx.bin}:${dirname(NODE)}:${SYSTEM_PATH}`,
    HOME: fx.root,
    CLAUDE_PROJECT_DIR: fx.checkout,
    npm_config_cache: join(fx.root, "npm-cache"),
    npm_config_offline: "true",
    npm_config_update_notifier: "false",
    ...extraEnv,
  };
  if (remote) env.CLAUDE_CODE_REMOTE = "true";
  // Claude Code runs a command hook through a shell; this is the registered command string.
  const r = spawnSync("/bin/sh", ["-c", command], { cwd: fx.root, env, encoding: "utf8", timeout: 120_000, killSignal: "SIGKILL" });
  const calls = existsSync(fx.log) ? readFileSync(fx.log, "utf8").trim().split("\n").filter(Boolean) : [];
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, calls };
}
const ran = (r, prefix) => r.calls.some((c) => c.startsWith(prefix));

test("R2: local session at a spaced checkout path exits 0 and does nothing", (t) => {
  const fx = hookFixture("local-spaced", { spaced: true });
  t.after(() => rmSync(fx.root, { recursive: true, force: true }));
  const before = listing(fx.checkout);
  const r = runHook(fx, { remote: false });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "");
  assert.deepEqual(r.calls, []);
  assert.equal(listing(fx.checkout), before);
});

test("R2: local session at a plain path exits 0 and does nothing (control)", (t) => {
  const fx = hookFixture("local-plain", { spaced: false });
  t.after(() => rmSync(fx.root, { recursive: true, force: true }));
  const r = runHook(fx, { remote: false });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.calls, []);
});

test("R2: control: the unquoted command form fails at a spaced path", (t) => {
  const fx = hookFixture("unquoted", { spaced: true });
  t.after(() => rmSync(fx.root, { recursive: true, force: true }));
  assert.equal(runHook(fx, { remote: false, command: "$CLAUDE_PROJECT_DIR/.claude/hooks/session-start.sh" }).status, 127);
});

test("R2: remote session at a spaced checkout path reaches setup", (t) => {
  const fx = hookFixture("remote-spaced", { spaced: true });
  t.after(() => rmSync(fx.root, { recursive: true, force: true }));
  const r = runHook(fx, { remote: true });
  assert.notEqual(r.status, 127, "the registered command could not even start the hook");
  assert.equal(r.status, 0, r.stderr);
  assert.ok(ran(r, "npm "), r.calls.join("\n"));
});

test("R4: cold setup uses npm ci and leaves all four tracked files unchanged", (t) => {
  const fx = hookFixture("cold");
  t.after(() => rmSync(fx.root, { recursive: true, force: true }));
  const before = tracked(fx.checkout);
  const r = runHook(fx, { remote: true });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(ran(r, "npm ci"), r.calls.join("\n"));
  assert.ok(!ran(r, "npm install"), "npm install must not run");
  assert.ok(ran(r, "cargo test --locked"));
  assert.deepEqual(tracked(fx.checkout), before);
});

test("R4: warm setup reuses a verified node_modules without reinstalling", (t) => {
  const fx = hookFixture("warm");
  t.after(() => rmSync(fx.root, { recursive: true, force: true }));
  assert.equal(runHook(fx, { remote: true }).status, 0);
  const before = tracked(fx.checkout);
  writeFileSync(fx.log, "");
  const r = runHook(fx, { remote: true });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(ran(r, "npm ls"), r.calls.join("\n"));
  assert.ok(!ran(r, "npm ci") && !ran(r, "npm install"), r.calls.join("\n"));
  assert.deepEqual(tracked(fx.checkout), before);
});

test("R4: a changed lock invalidates the warm cache and reinstalls with npm ci", (t) => {
  const fx = hookFixture("stale-lock");
  t.after(() => rmSync(fx.root, { recursive: true, force: true }));
  assert.equal(runHook(fx, { remote: true }).status, 0);
  for (const file of ["package.json", "package-lock.json"]) {
    const value = JSON.parse(readFileSync(join(fx.checkout, file), "utf8"));
    value.version = "1.0.1";
    if (value.packages) value.packages[""].version = "1.0.1";
    writeFileSync(join(fx.checkout, file), JSON.stringify(value, null, 2) + "\n");
  }
  writeFileSync(fx.log, "");
  const r = runHook(fx, { remote: true });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(ran(r, "npm ci"), r.calls.join("\n"));
});

test("R4: a changed package.json with the same lock invalidates the warm cache", (t) => {
  const fx = hookFixture("stale-package");
  t.after(() => rmSync(fx.root, { recursive: true, force: true }));
  assert.equal(runHook(fx, { remote: true }).status, 0);
  const pkg = JSON.parse(readFileSync(join(fx.checkout, "package.json"), "utf8"));
  pkg.description = "edited";
  writeFileSync(join(fx.checkout, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
  writeFileSync(fx.log, "");
  const r = runHook(fx, { remote: true });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(ran(r, "npm ci"), r.calls.join("\n"));
});

test("R4: an incomplete warm cache (simulated failing npm ls) reinstalls with npm ci", (t) => {
  const fx = hookFixture("damaged");
  t.after(() => rmSync(fx.root, { recursive: true, force: true }));
  assert.equal(runHook(fx, { remote: true }).status, 0);
  writeFileSync(fx.log, "");
  const r = runHook(fx, { remote: true, extraEnv: { SHIM_LS_FAIL: "1" } });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(ran(r, "npm ci"), r.calls.join("\n"));
});

test("R4: a root-name mismatch never rewrites the committed lock", (t) => {
  const fx = hookFixture("name-mismatch", { pkg: { name: "renamed" } });
  t.after(() => rmSync(fx.root, { recursive: true, force: true }));
  const before = tracked(fx.checkout);
  const r = runHook(fx, { remote: true });
  assert.deepEqual(tracked(fx.checkout), before, "the lock must be byte-identical");
  assert.ok(!ran(r, "npm install"), "npm install must not run");
});

test("R4: a real dependency mismatch fails visibly and changes nothing", (t) => {
  const fx = hookFixture("dep-mismatch", { pkg: { dependencies: { "left-pad": "1.3.0" } } });
  t.after(() => rmSync(fx.root, { recursive: true, force: true }));
  const before = tracked(fx.checkout);
  const r = runHook(fx, { remote: true });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /npm ci failed|npm error/);
  assert.deepEqual(tracked(fx.checkout), before);
  assert.ok(!ran(r, "cargo"), "setup must stop before compiling");
});

test("R4: a missing lock fails visibly and no lock is created", (t) => {
  const fx = hookFixture("no-lock", { lock: false });
  t.after(() => rmSync(fx.root, { recursive: true, force: true }));
  const r = runHook(fx, { remote: true });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /package-lock\.json is missing/);
  assert.equal(existsSync(join(fx.checkout, "package-lock.json")), false);
});

test("R4: a Cargo.lock change during setup fails the hook (four-file guard)", (t) => {
  const fx = hookFixture("cargo-guard", { cargoEditsLock: true });
  t.after(() => rmSync(fx.root, { recursive: true, force: true }));
  const r = runHook(fx, { remote: true });
  assert.notEqual(r.status, 0, "a rewritten Cargo.lock must not pass silently");
  assert.match(r.stderr, /changed a tracked manifest or lockfile/);
});

test("R4: npm-deps does not trust a marker from a different setup", { skip: !existsSync(NPM_DEPS) && "no npm-deps.sh in this version" }, (t) => {
  const fx = hookFixture("npm-deps-marker");
  t.after(() => rmSync(fx.root, { recursive: true, force: true }));
  const env = { PATH: `${fx.bin}:${dirname(NODE)}:${SYSTEM_PATH}`, HOME: fx.root, npm_config_cache: join(fx.root, "npm-cache"), npm_config_offline: "true", npm_config_update_notifier: "false" };
  const once = spawnSync("bash", [NPM_DEPS, fx.checkout], { env, encoding: "utf8" });
  assert.equal(once.status, 0, once.stderr);
  const marker = readdirSync(join(fx.checkout, "node_modules")).find((n) => n.startsWith(".claude"));
  assert.ok(marker, "a setup marker is written after npm ci");
  writeFileSync(join(fx.checkout, "node_modules", marker), "stale");
  const twice = spawnSync("bash", [NPM_DEPS, fx.checkout], { env, encoding: "utf8" });
  assert.equal(twice.status, 0, twice.stderr);
  assert.match(twice.stdout, /cold/);
});

// ============================================================ screenshot helper
function freePort() {
  return new Promise((done) => {
    const s = createNetServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => done(port));
    });
  });
}

/** Dummy dev server. Modes: ok, never-listen, ignore-term (a parent and a child that both ignore SIGTERM), silent (accepts, never answers), exit. */
const SERVER_SOURCE = `
import { createServer } from "node:http";
import { appendFileSync } from "node:fs";
import { spawn } from "node:child_process";
const record = (pid) => appendFileSync(process.env.MOCK_SERVER_PIDS, pid + "\\n");
record(process.pid);
const mode = process.env.MOCK_SERVER_MODE || "ok";
const port = Number(process.env.HFD_SHOT_PORT);
if (process.argv.includes("--child")) {
  process.on("SIGTERM", () => {});
  setInterval(() => {}, 1000);
} else {
  if (mode === "exit") process.exit(1);
  if (mode === "ignore-term") {
    process.on("SIGTERM", () => {});
    const child = spawn(process.execPath, [process.argv[1], "--child"], { stdio: "ignore" });
    record(child.pid);
  }
  if (mode === "silent") createServer(() => {}).listen(port, "127.0.0.1");
  else if (mode !== "never-listen") createServer((q, s) => s.end("ok")).listen(port, "127.0.0.1");
  setInterval(() => {}, 1000);
}
`;

/** Mock Playwright. MOCK_PW_FAIL names the failing step; "goto+close" fails navigation, then close. */
const PLAYWRIGHT_SOURCE = `
const fs = require("fs");
const fail = process.env.MOCK_PW_FAIL || "";
const boom = (step) => { if (fail === step || (fail === "goto+close" && (step === "goto" || step === "close"))) throw new Error("mock " + step + " failure"); };
const page = () => ({
  on() {},
  async goto() { boom("goto"); },
  async waitForTimeout() {},
  async screenshot({ path }) { boom("screenshot"); fs.writeFileSync(path, "png"); },
});
exports.chromium = {
  async launch() {
    boom("launch");
    return {
      async newContext() { boom("newContext"); return { async newPage() { return page(); } }; },
      async newPage() { return page(); },
      async close() { boom("close"); },
    };
  },
};
`;

const WATCHDOG_MS = 15_000;

/**
 * Runs the helper with an outer watchdog. Returns its exit code, stderr, elapsed
 * time, whether the watchdog fired, and the pids of every dummy server process
 * this run's helper started (recorded by the dummy itself).
 */
async function runScreenshot(t, { pwFail = "", serverMode = "ok", external = null } = {}) {
  const root = tmp("shot");
  const port = await freePort();
  const serverFile = join(root, "server.mjs");
  writeFileSync(serverFile, SERVER_SOURCE);
  const globalModules = join(root, "global", "node_modules");
  mkdirSync(join(globalModules, "playwright"), { recursive: true });
  const playwright = join(globalModules, "playwright", "index.js");
  writeFileSync(playwright, PLAYWRIGHT_SOURCE);
  const bin = join(root, "bin");
  mkdirSync(bin);
  script(join(bin, "npm"), `#!/bin/sh\nif [ "$1" = "root" ]; then echo "${globalModules}"; exit 0; fi\nexit 1\n`);
  script(join(bin, "npx"), `#!/bin/sh\nexec "${NODE}" "${serverFile}" "$@"\n`);
  const ownedPids = join(root, "owned.pids");
  const env = {
    PATH: `${bin}:${dirname(NODE)}:${SYSTEM_PATH}`,
    HOME: root,
    // consolidated and pushed seams
    HFD_SHOT_PORT: String(port),
    HFD_SHOT_PLAYWRIGHT: playwright,
    HFD_SHOT_SERVER: JSON.stringify([NODE, serverFile]),
    HFD_SHOT_TIMEOUT_MS: "1500",
    HFD_SHOT_PROBE_MS: "500",
    HFD_SHOT_GRACE_MS: "500",
    // seams of the earlier Mac version
    HFD_SCREENSHOT_PORT: String(port),
    HFD_SCREENSHOT_STARTUP_MS: "1500",
    MOCK_PW_FAIL: pwFail,
    MOCK_SERVER_MODE: serverMode,
    MOCK_SERVER_PIDS: ownedPids,
  };

  let externalServer = null;
  if (external) {
    externalServer = createHttpServer(external === "silent" ? () => {} : (q, s) => s.end("existing"));
    await new Promise((r) => externalServer.listen(port, "127.0.0.1", r));
  }

  const started = Date.now();
  const child = spawn(NODE, [SCREENSHOT, "/", "--out", join(root, "out")], { cwd: root, env, stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));
  let watchdogFired = false;
  const watchdog = setTimeout(() => {
    watchdogFired = true;
    child.kill("SIGKILL");
  }, WATCHDOG_MS);
  const code = await new Promise((r) => child.on("exit", (c) => r(c)));
  clearTimeout(watchdog);
  const elapsedMs = Date.now() - started;

  // Give a just-signalled group a moment, then read who is still alive.
  await sleep(200);
  const pids = existsSync(ownedPids) ? readFileSync(ownedPids, "utf8").trim().split("\n").filter(Boolean).map(Number) : [];
  const survivors = pids.filter(alive);

  // Reviewer-owned cleanup: whatever the helper left, the test removes.
  t.after(async () => {
    for (const pid of pids) {
      try { process.kill(-pid, "SIGKILL"); } catch {}
      try { process.kill(pid, "SIGKILL"); } catch {}
    }
    if (externalServer) {
      externalServer.closeAllConnections?.();
      await new Promise((r) => externalServer.close(() => r()));
    }
    rmSync(root, { recursive: true, force: true });
  });
  return { code, stderr, elapsedMs, watchdogFired, pids, survivors, root, port, externalServer };
}

const shotDone = (r) => assert.equal(r.watchdogFired, false, `helper still running at the ${WATCHDOG_MS} ms watchdog`);

test("R3: success writes the screenshot and stops the owned server", async (t) => {
  const r = await runScreenshot(t);
  shotDone(r);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(existsSync(join(r.root, "out", "home.png")));
  assert.ok(r.pids.length > 0, "the helper started its own server");
  assert.deepEqual(r.survivors, [], "owned server processes survived");
});

for (const step of ["launch", "newContext", "goto", "screenshot"]) {
  test(`R3: a ${step} failure exits 1 with its own error and stops the owned server`, async (t) => {
    const r = await runScreenshot(t, { pwFail: step });
    shotDone(r);
    assert.equal(r.code, 1, r.stderr);
    assert.match(r.stderr, new RegExp(`mock ${step} failure`));
    assert.deepEqual(r.survivors, [], "owned server processes survived");
  });
}

test("R3: a startup timeout exits 1 and stops the owned server", async (t) => {
  const r = await runScreenshot(t, { serverMode: "never-listen" });
  shotDone(r);
  assert.equal(r.code, 1, r.stderr);
  assert.match(r.stderr, /did not (answer|start)/);
  assert.deepEqual(r.survivors, []);
});

test("R3: a server that exits before answering is reported and leaves nothing behind", async (t) => {
  const r = await runScreenshot(t, { serverMode: "exit" });
  shotDone(r);
  assert.equal(r.code, 1, r.stderr);
  assert.deepEqual(r.survivors, []);
});

test("R5: a browser-close failure after successful screenshots exits 1 and still stops the owned server", async (t) => {
  const r = await runScreenshot(t, { pwFail: "close" });
  shotDone(r);
  assert.equal(r.code, 1, "a failed browser close must not exit 0");
  assert.match(r.stderr, /mock close failure/);
  assert.deepEqual(r.survivors, [], "cleanup did not continue to the server");
});

test("R5: when navigation and then browser close both fail, the navigation error is the one reported", async (t) => {
  const r = await runScreenshot(t, { pwFail: "goto+close" });
  shotDone(r);
  assert.equal(r.code, 1, r.stderr);
  assert.match(r.stderr, /mock goto failure/);
  // The close failure may be reported as a secondary note, but it must never become the thrown error.
  assert.doesNotMatch(r.stderr, /^(Uncaught )?Error: mock close failure/m, "the close error replaced the original one");
  assert.deepEqual(r.survivors, []);
});

test("R6: an owned server that ignores SIGTERM is killed within the bound, parent and child", async (t) => {
  const r = await runScreenshot(t, { serverMode: "ignore-term" });
  shotDone(r);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(r.pids.length >= 2, "the dummy server should record its parent and child");
  assert.deepEqual(r.survivors, [], "owned processes survived termination");
  assert.ok(r.elapsedMs < 12_000, `took ${r.elapsedMs} ms`);
});

test("R7: an owned server that accepts but never answers ends at the startup deadline and is stopped", async (t) => {
  const r = await runScreenshot(t, { serverMode: "silent" });
  shotDone(r);
  assert.equal(r.code, 1, r.stderr);
  assert.match(r.stderr, /did not (answer|start)/);
  assert.deepEqual(r.survivors, [], "owned server survived");
  assert.ok(r.elapsedMs < 10_000, `took ${r.elapsedMs} ms`);
});

test("R7: a pre-existing server that never answers ends promptly and is left running", async (t) => {
  const r = await runScreenshot(t, { external: "silent" });
  shotDone(r);
  assert.equal(r.code, 1, r.stderr);
  assert.ok(r.elapsedMs < 10_000, `took ${r.elapsedMs} ms`);
  assert.ok(r.externalServer.listening, "the external server must still be listening");
  // Any dummy the helper may have started in its place must be gone.
  assert.deepEqual(r.survivors, []);
});

for (const pwFail of ["", "launch", "goto+close"]) {
  test(`R3: a reused server is left running (${pwFail || "success"})`, async (t) => {
    const r = await runScreenshot(t, { pwFail, external: "ok" });
    shotDone(r);
    assert.equal(r.code, pwFail ? 1 : 0, r.stderr);
    assert.deepEqual(r.pids, [], "the helper should not start a second server");
    const body = await fetch(`http://localhost:${r.port}`).then((res) => res.text());
    assert.equal(body, "existing", "the reused server must still answer");
  });
}
