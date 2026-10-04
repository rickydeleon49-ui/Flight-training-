// Checks for the Claude Code setup helpers in .claude/. Run with:
//   node --test .claude/tests/setup-helpers.test.mjs
// Everything runs in temporary directories with mock processes. No real app,
// browser, network or project dependency is used.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const claudeDir = resolve(here, "..");
const npmDeps = join(claudeDir, "hooks/npm-deps.sh");
const screenshot = join(claudeDir, "skills/run/screenshot.mjs");

const tmp = (prefix) => mkdtempSync(join(tmpdir(), prefix));
const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const freePort = () =>
  new Promise((done) => {
    const s = createServer().listen(0, () => {
      const { port } = s.address();
      s.close(() => done(port));
    });
  });
const waitFor = async (check, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
};

// ---- Session-start hook registration ------------------------------------

const settings = JSON.parse(readFileSync(join(claudeDir, "settings.json"), "utf8"));
const hookCommand = settings.hooks.SessionStart[0].hooks[0].command;

function runRegisteredHook(command, projectDir) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: projectDir };
  delete env.CLAUDE_CODE_REMOTE;
  return spawnSync("/bin/sh", ["-c", command], { env, encoding: "utf8" });
}

function projectWithSpaces() {
  const project = join(tmp("hfd hook "), "checkout with spaces");
  mkdirSync(join(project, ".claude"), { recursive: true });
  cpSync(join(claudeDir, "hooks"), join(project, ".claude/hooks"), { recursive: true });
  return project;
}

test("registered hook runs and does nothing outside cloud sessions, even in a spaced path", () => {
  const project = projectWithSpaces();
  const result = runRegisteredHook(hookCommand, project);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(existsSync(join(project, "node_modules")), false);
});

test("control: the unquoted form fails in a spaced path", () => {
  const project = projectWithSpaces();
  const unquoted = "$CLAUDE_PROJECT_DIR/.claude/hooks/session-start.sh";
  assert.equal(runRegisteredHook(unquoted, project).status, 127);
});

// ---- npm dependency setup -------------------------------------------------

function npmFixture({ pkg = {}, lock = {} } = {}) {
  const dir = tmp("hfd npm ");
  const name = "fixture";
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name, version: "1.0.0", private: true, ...pkg }, null, 2) + "\n",
  );
  writeFileSync(
    join(dir, "package-lock.json"),
    JSON.stringify(
      {
        name,
        version: "1.0.0",
        lockfileVersion: 3,
        requires: true,
        packages: { "": { name, version: "1.0.0" } },
        ...lock,
      },
      null,
      2,
    ) + "\n",
  );
  return dir;
}

function runNpmDeps(dir) {
  const env = {
    ...process.env,
    npm_config_cache: join(dir, ".npm-cache"),
    npm_config_offline: "true",
    npm_config_update_notifier: "false",
  };
  return spawnSync("bash", [npmDeps, dir], { env, encoding: "utf8" });
}

const trackedHashes = (dir) => [sha(join(dir, "package.json")), sha(join(dir, "package-lock.json"))];

test("cold setup installs from the lock and leaves tracked files unchanged", () => {
  const dir = npmFixture();
  const before = trackedHashes(dir);
  const result = runNpmDeps(dir);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /cold/);
  assert.deepEqual(trackedHashes(dir), before);
  assert.equal(
    readFileSync(join(dir, "node_modules/.claude-lock.sha256"), "utf8").trim(),
    before[1],
  );
});

test("warm setup reuses node_modules and leaves tracked files unchanged", () => {
  const dir = npmFixture();
  assert.equal(runNpmDeps(dir).status, 0);
  const before = trackedHashes(dir);
  const result = runNpmDeps(dir);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /warm/);
  assert.deepEqual(trackedHashes(dir), before);
});

test("a marker from a different lock is not trusted", () => {
  const dir = npmFixture();
  assert.equal(runNpmDeps(dir).status, 0);
  writeFileSync(join(dir, "node_modules/.claude-lock.sha256"), "stale\n");
  const result = runNpmDeps(dir);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /cold/);
});

test("a dependency missing from the lock fails visibly without rewriting it", () => {
  const dir = npmFixture({ pkg: { dependencies: { "left-pad": "1.3.0" } } });
  const before = trackedHashes(dir);
  const result = runNpmDeps(dir);
  assert.notEqual(result.status, 0);
  assert.deepEqual(trackedHashes(dir), before);
});

test("a root-name mismatch never rewrites the lock", () => {
  const dir = npmFixture({ pkg: { name: "fixture-renamed" } });
  const before = trackedHashes(dir);
  runNpmDeps(dir);
  assert.deepEqual(trackedHashes(dir), before);
});

// ---- Screenshot helper cleanup -------------------------------------------

// A stand-in dev server that records its pid. With `listen: false` it never
// answers, to exercise the startup timeout.
function mockServerScript(dir, { listen = true } = {}) {
  const file = join(dir, "server.mjs");
  writeFileSync(
    file,
    `import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(join(dir, "server.pid"))}, String(process.pid));
${listen ? `createServer((q, s) => s.end("ok")).listen(Number(process.env.HFD_SHOT_PORT));` : ""}
setInterval(() => {}, 1000);
`,
  );
  return file;
}

// A stand-in for Playwright. `fail` names the step that throws.
function mockPlaywright(dir, fail) {
  const file = join(dir, "playwright.mjs");
  writeFileSync(
    file,
    `import { writeFileSync } from "node:fs";
const fail = ${JSON.stringify(fail ?? null)};
const boom = (step) => { if (fail === step) throw new Error("mock " + step + " failure"); };
const page = {
  on() {},
  async goto() { boom("goto"); },
  async waitForTimeout() {},
  async screenshot({ path }) { boom("screenshot"); writeFileSync(path, "png"); },
};
const browser = {
  async newContext() { boom("newContext"); return { async newPage() { return page; } }; },
  async close() { boom("close"); },
};
export const chromium = { async launch() { boom("launch"); return browser; } };
`,
  );
  return file;
}

async function runScreenshot({ fail, listen = true, reuse = false } = {}) {
  const dir = tmp("hfd shot ");
  const port = await freePort();
  const env = {
    ...process.env,
    HFD_SHOT_PORT: String(port),
    HFD_SHOT_PLAYWRIGHT: mockPlaywright(dir, fail),
    HFD_SHOT_SERVER: JSON.stringify([process.execPath, mockServerScript(dir, { listen })]),
    HFD_SHOT_TIMEOUT_MS: "1500",
  };
  let existing = null;
  if (reuse) {
    existing = spawn(process.execPath, [mockServerScript(dir)], { env, stdio: "ignore" });
    await waitFor(() => fetch(`http://localhost:${port}`).then(() => true, () => false));
    rmSync(join(dir, "server.pid"));
  }
  const result = spawnSync(process.execPath, [screenshot, "/", "--out", join(dir, "out")], {
    env,
    encoding: "utf8",
  });
  const pidFile = join(dir, "server.pid");
  const startedPid = existsSync(pidFile) ? Number(readFileSync(pidFile, "utf8")) : null;
  return { result, startedPid, existing };
}

for (const fail of [undefined, "launch", "newContext", "goto", "screenshot", "close"]) {
  test(`owned server is stopped ${fail ? `after a ${fail} failure` : "after success"}`, async () => {
    const { result, startedPid } = await runScreenshot({ fail });
    assert.equal(result.status, fail ? 1 : 0, result.stderr);
    if (fail) assert.match(result.stderr, new RegExp(`mock ${fail} failure`));
    assert.ok(startedPid, "the helper started its own server");
    assert.ok(await waitFor(() => !alive(startedPid)), "owned server still running");
  });
}

test("owned server is stopped after a startup timeout", async () => {
  const { result, startedPid } = await runScreenshot({ listen: false });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /did not answer/);
  assert.ok(await waitFor(() => !alive(startedPid)), "owned server still running");
});

for (const fail of [undefined, "launch"]) {
  test(`a server that was already running is left alone ${fail ? "after a failure" : ""}`, async () => {
    const { result, startedPid, existing } = await runScreenshot({ reuse: true, fail });
    try {
      assert.equal(result.status, fail ? 1 : 0, result.stderr);
      assert.equal(startedPid, null, "the helper should not start a second server");
      assert.ok(alive(existing.pid), "the existing server was stopped");
    } finally {
      existing.kill();
    }
  });
}
