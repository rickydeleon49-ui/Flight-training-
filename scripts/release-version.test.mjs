/**
 * Version bookkeeping of scripts/release.sh, bump-version.mjs and
 * check-release-version.mjs, run against a throwaway Git repository (no cargo,
 * npm or network: those are local doubles).
 *
 * Run from the repository root: node --test scripts/release-version.test.mjs
 */
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const roots = [];
after(() => { for (const root of roots) fs.rmSync(root, { recursive: true, force: true }); });

const IOS_DIR = 'src-tauri/gen/apple';
const PLIST = `${IOS_DIR}/her-flight-deck_iOS/Info.plist`;
const YML = `${IOS_DIR}/project.yml`;
const MAC_FILES = ['package.json', 'package-lock.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock'];

function write(root, rel, content) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), content);
}

function git(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], {
    cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

function setup({ version = '1.0.0', iosVersion = version, ios = true, npmLeavesFile = false, origin = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfd-release-version-test-'));
  roots.push(root);
  const repo = path.join(root, 'repo');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  for (const f of ['release.sh', 'bump-version.mjs', 'check-release-version.mjs']) {
    write(repo, `scripts/${f}`, fs.readFileSync(path.resolve('scripts', f), 'utf8'));
  }
  write(repo, 'scripts/release-policy.json', JSON.stringify({ retiredVersions: [] }));
  write(repo, 'package.json', JSON.stringify({ name: 'x', version }, null, 2) + '\n');
  write(repo, 'package-lock.json', JSON.stringify({ name: 'x', version, packages: { '': { version } } }, null, 2) + '\n');
  write(repo, 'src-tauri/tauri.conf.json', JSON.stringify({ version }, null, 2) + '\n');
  write(repo, 'src-tauri/Cargo.toml', `[package]\nname = "her-flight-deck"\nversion = "${version}"\n`);
  write(repo, 'src-tauri/Cargo.lock', `[[package]]\nname = "her-flight-deck"\nversion = "${version}"\n`);
  if (ios) {
    write(repo, YML, `targets:\n  app:\n    info:\n      properties:\n        CFBundleShortVersionString: ${iosVersion}\n        CFBundleVersion: "21"\n`);
    write(repo, PLIST, `<plist><dict>\n\t<key>CFBundleShortVersionString</key>\n\t<string>${iosVersion}</string>\n\t<key>CFBundleVersion</key>\n\t<string>21</string>\n</dict></plist>\n`);
  }
  git(repo, 'init', '-q');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'base');
  git(repo, 'branch', '-M', 'main');
  if (origin) {
    const bare = path.join(root, 'origin.git');
    git(root, 'init', '-q', '--bare', bare);
    git(repo, 'remote', 'add', 'origin', bare);
    git(repo, 'push', '-q', 'origin', 'main');
  }
  const double = (name, body) => fs.writeFileSync(path.join(bin, name), `#!${process.execPath}\n${body}`, { mode: 0o755 });
  // cargo check: sync Cargo.lock with Cargo.toml the way the real one does.
  double('cargo', `const fs=require('node:fs');const m=process.argv[process.argv.indexOf('--manifest-path')+1];
const dir=require('node:path').dirname(m);const v=fs.readFileSync(m,'utf8').match(/^version\\s*=\\s*"([^"]+)"/m)[1];
const lock=require('node:path').join(dir,'Cargo.lock');fs.writeFileSync(lock,fs.readFileSync(lock,'utf8').replace(/(name = "her-flight-deck"\\nversion = )"[^"]+"/,'$1"'+v+'"'));`);
  double('npm', npmLeavesFile ? "require('node:fs').writeFileSync('stray.txt','x');" : '');
  return { repo, bin };
}

function runRelease(ctx, ...args) {
  const r = spawnSync('bash', ['scripts/release.sh', ...args], {
    cwd: ctx.repo, encoding: 'utf8',
    env: { ...process.env, PATH: `${ctx.bin}:${process.env.PATH}`, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
  });
  return { status: r.status, output: r.stdout + r.stderr };
}

function runNode(ctx, script, ...args) {
  const r = spawnSync(process.execPath, [`scripts/${script}`, ...args], {
    cwd: ctx.repo, encoding: 'utf8', env: { ...process.env, PATH: `${ctx.bin}:${process.env.PATH}` },
  });
  return { status: r.status, output: r.stdout + r.stderr };
}

describe('bump-version.mjs file list', () => {
  it('ends with a CHANGED line naming the Mac files and both iOS files', () => {
    const ctx = setup();
    const r = runNode(ctx, 'bump-version.mjs', '1.1.0');
    assert.equal(r.status, 0, r.output);
    const line = r.output.trim().split('\n').pop();
    assert.match(line, /^CHANGED: /);
    assert.deepEqual(line.replace('CHANGED: ', '').split(' ').sort(), [...MAC_FILES, YML, PLIST].sort());
    assert.match(fs.readFileSync(path.join(ctx.repo, PLIST), 'utf8'), /<string>1\.1\.0<\/string>/);
  });

  it('omits the iOS files when the iOS project is absent', () => {
    const ctx = setup({ ios: false });
    const r = runNode(ctx, 'bump-version.mjs', '1.1.0');
    assert.equal(r.status, 0, r.output);
    assert.deepEqual(r.output.trim().split('\n').pop().replace('CHANGED: ', '').split(' ').sort(), [...MAC_FILES].sort());
  });
});

describe('check-release-version.mjs --agree (iOS marketing version)', () => {
  it('passes when every file agrees', () => {
    const r = runNode(setup(), 'check-release-version.mjs', '1.0.0', '--agree');
    assert.equal(r.status, 0, r.output);
  });

  it('fails naming the iOS files when they are behind', () => {
    const r = runNode(setup({ iosVersion: '0.9.0' }), 'check-release-version.mjs', '1.0.0', '--agree');
    assert.equal(r.status, 1);
    assert.match(r.output, /project\.yml CFBundleShortVersionString=0\.9\.0/);
    assert.match(r.output, /Info\.plist CFBundleShortVersionString=0\.9\.0/);
  });
});

describe('release.sh', () => {
  it('commits exactly the reported files (iOS included) with --no-tag', () => {
    const ctx = setup();
    const r = runRelease(ctx, '1.1.0', '--no-tag');
    assert.equal(r.status, 0, r.output);
    const files = git(ctx.repo, 'show', '--name-only', '--format=', 'HEAD').trim().split('\n').sort();
    assert.deepEqual(files, [...MAC_FILES, YML, PLIST].sort());
    assert.equal(git(ctx.repo, 'status', '--porcelain'), '');
  });

  it('refuses to tag when a bump commit is still needed', () => {
    const ctx = setup();
    const r = runRelease(ctx, '1.1.0');
    assert.equal(r.status, 1);
    assert.match(r.output, /--no-tag/);
    assert.equal(git(ctx.repo, 'tag').trim(), '');
    assert.match(git(ctx.repo, 'log', '-1', '--format=%s'), /base/);
  });

  it('tags a prepared main whose HEAD is origin/main', () => {
    const ctx = setup({ origin: true });
    const r = runRelease(ctx, '1.0.0');
    assert.equal(r.status, 0, r.output);
    assert.match(git(ctx.repo, 'tag'), /v1\.0\.0/);
  });

  it('refuses to tag a prepared commit that is not origin/main', () => {
    const ctx = setup({ origin: true });
    fs.writeFileSync(path.join(ctx.repo, 'extra.txt'), 'x');
    git(ctx.repo, 'add', '.');
    git(ctx.repo, 'commit', '-q', '-m', 'local only');
    const r = runRelease(ctx, '1.0.0');
    assert.equal(r.status, 1);
    assert.match(r.output, /HEAD is not origin\/main/);
    assert.equal(git(ctx.repo, 'tag').trim(), '');
  });

  it('repairs iOS files that lag behind the Mac version instead of treating the repo as prepared', () => {
    const ctx = setup({ iosVersion: '0.9.0' });
    const r = runRelease(ctx, '1.0.0', '--no-tag');
    assert.equal(r.status, 0, r.output);
    assert.match(git(ctx.repo, 'show', '--name-only', '--format=', 'HEAD'), /Info\.plist/);
  });

  it('--no-tag commits but makes no tag and says so', () => {
    const ctx = setup();
    const r = runRelease(ctx, '1.1.0', '--no-tag');
    assert.equal(r.status, 0, r.output);
    assert.match(r.output, /without a tag/);
    assert.equal(git(ctx.repo, 'tag').trim(), '');
    assert.match(git(ctx.repo, 'log', '-1', '--format=%s'), /release: 1\.1\.0/);
  });

  it('fails with the file names when files are left uncommitted after the commit', () => {
    const ctx = setup({ npmLeavesFile: true });
    const r = runRelease(ctx, '1.1.0', '--no-tag');
    assert.equal(r.status, 1);
    assert.match(r.output, /bump left uncommitted files: .*stray\.txt/);
    assert.equal(git(ctx.repo, 'tag').trim(), '');
  });

  it('rejects a bad version or a second version argument', () => {
    assert.equal(runRelease(setup(), '1.2').status, 1);
    assert.equal(runRelease(setup(), '1.2.3', '1.2.4').status, 1);
  });
});

describe('release.yml', () => {
  it('runs the version-agreement check that includes iOS', () => {
    const workflow = fs.readFileSync('.github/workflows/release.yml', 'utf8');
    assert.ok(workflow.includes('node scripts/check-release-version.mjs "$VERSION" --agree'));
  });
});
