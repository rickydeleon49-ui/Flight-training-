/**
 * Refusal paths of scripts/build-signed-mac.sh. Needs no signing identity and
 * never contacts Apple: the script runs as a copy inside a throwaway Git
 * repository, and `security`, `xcrun`, `npm` and `uname` are local doubles that
 * only log their arguments.
 *
 * Run from the repository root: node --test scripts/build-signed-mac.test.mjs
 */
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SCRIPT = path.resolve('scripts/build-signed-mac.sh');
const roots = [];
after(() => { for (const root of roots) fs.rmSync(root, { recursive: true, force: true }); });

const ONE = '  1) 0123456789ABCDEF0123456789ABCDEF01234567 "Developer ID Application: Example Owner (ABCDE12345)"\n     1 valid identities found\n';
const TWO = '  1) 0123456789ABCDEF0123456789ABCDEF01234567 "Developer ID Application: Example Owner (ABCDE12345)"\n'
  + '  2) 89ABCDEF0123456789ABCDEF0123456789ABCDEF "Developer ID Application: Other Owner (ZZZZZ99999)"\n     2 valid identities found\n';
const NONE = '  1) 0123456789ABCDEF0123456789ABCDEF01234567 "Apple Development: Example Owner (QQQQQ11111)"\n     1 valid identities found\n';

function git(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], {
    cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
  });
  assert.equal(r.status, 0, r.stderr);
}

function setup({ tag = 'v1.2.3', dirty = false, laterCommit = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfd-signed-mac-test-'));
  roots.push(root);
  const repo = path.join(root, 'repo');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true });
  fs.mkdirSync(bin);
  fs.copyFileSync(SCRIPT, path.join(repo, 'scripts', 'build-signed-mac.sh'));
  git(repo, 'init', '-q');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'release');
  if (tag) git(repo, 'tag', '-a', tag, '-m', tag);
  if (laterCommit) {
    fs.writeFileSync(path.join(repo, 'later.txt'), 'later\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'later');
  }
  if (dirty) fs.writeFileSync(path.join(repo, 'untracked.txt'), 'dirty\n');
  const log = path.join(root, 'calls.log');
  const double = (name, body) => fs.writeFileSync(path.join(bin, name), `#!${process.execPath}\n`
    + `require('node:fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify([${JSON.stringify(name)}, ...process.argv.slice(2)]) + '\\n');\n${body}`, { mode: 0o755 });
  double('uname', "process.stdout.write('Darwin\\n');");
  double('security', 'process.stdout.write(process.env.FAKE_IDENTITIES ?? "");');
  double('xcrun', 'process.exit(Number(process.env.FAKE_XCRUN_EXIT ?? 1));');
  double('npm', 'process.exit(97);');
  return { repo, bin, log };
}

function run(ctx, args, env = {}) {
  const base = { ...process.env };
  delete base.APPLE_SIGNING_IDENTITY;
  const r = spawnSync('bash', [path.join(ctx.repo, 'scripts', 'build-signed-mac.sh'), ...args], {
    cwd: ctx.repo, encoding: 'utf8',
    env: { ...base, PATH: `${ctx.bin}:${process.env.PATH}`, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', ...env },
  });
  const calls = fs.existsSync(ctx.log) ? fs.readFileSync(ctx.log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
  return { status: r.status, output: r.stdout + r.stderr, calls, tools: calls.map((c) => c[0]).filter((t) => t !== 'uname') };
}

describe('build-signed-mac.sh refusals', () => {
  for (const bad of [[], ['1.2'], ['v1.2.3'], ['1.2.3-beta'], ['1.2.3', 'extra']]) {
    it(`rejects bad version arguments ${JSON.stringify(bad)}`, () => {
      const r = run(setup(), bad, { FAKE_IDENTITIES: ONE });
      assert.equal(r.status, 1);
      assert.match(r.output, /Usage: scripts\/build-signed-mac\.sh <version>/);
      assert.deepEqual(r.calls, []);
    });
  }

  it('refuses a dirty working tree', () => {
    const r = run(setup({ dirty: true }), ['1.2.3'], { FAKE_IDENTITIES: ONE });
    assert.equal(r.status, 1);
    assert.match(r.output, /working tree is not clean/);
    assert.deepEqual(r.tools, []);
  });

  it('refuses when the tag does not exist', () => {
    const r = run(setup({ tag: null }), ['1.2.3'], { FAKE_IDENTITIES: ONE });
    assert.equal(r.status, 1);
    assert.match(r.output, /tag v1\.2\.3 does not exist/);
    assert.deepEqual(r.tools, []);
  });

  it('refuses when HEAD is not exactly the tag', () => {
    const r = run(setup({ laterCommit: true }), ['1.2.3'], { FAKE_IDENTITIES: ONE });
    assert.equal(r.status, 1);
    assert.match(r.output, /is not tag v1\.2\.3/);
    assert.deepEqual(r.tools, []);
  });

  it('refuses with owner guidance when no Developer ID Application identity exists', () => {
    const r = run(setup(), ['1.2.3'], { FAKE_IDENTITIES: NONE });
    assert.equal(r.status, 1);
    assert.match(r.output, /No valid "Developer ID Application" signing identity/);
    assert.match(r.output, /MAC_SIGNING_LOCAL_2026-10-28\.md/);
    assert.deepEqual(r.tools, ['security']);
  });

  it('refuses an ambiguous keychain', () => {
    const r = run(setup(), ['1.2.3'], { FAKE_IDENTITIES: TWO });
    assert.equal(r.status, 1);
    assert.match(r.output, /more than one Developer ID Application identity/);
    assert.deepEqual(r.tools, ['security']);
  });

  it('refuses an APPLE_SIGNING_IDENTITY that is not in the keychain', () => {
    const r = run(setup(), ['1.2.3'], { FAKE_IDENTITIES: ONE, APPLE_SIGNING_IDENTITY: 'Developer ID Application: Someone Else (YYYYY88888)' });
    assert.equal(r.status, 1);
    assert.match(r.output, /APPLE_SIGNING_IDENTITY is not a valid identity/);
    assert.deepEqual(r.tools, ['security']);
  });

  it('refuses an APPLE_SIGNING_IDENTITY that is not Developer ID Application', () => {
    const r = run(setup(), ['1.2.3'], { FAKE_IDENTITIES: NONE, APPLE_SIGNING_IDENTITY: 'Apple Development: Example Owner (QQQQQ11111)' });
    assert.equal(r.status, 1);
    assert.match(r.output, /must name a "Developer ID Application/);
  });

  it('stops before building when the hfd-notary profile does not work', () => {
    const r = run(setup(), ['1.2.3'], { FAKE_IDENTITIES: ONE, FAKE_XCRUN_EXIT: '1' });
    assert.equal(r.status, 1);
    assert.match(r.output, /keychain profile "hfd-notary" is missing/);
    assert.match(r.output, /notarytool store-credentials hfd-notary --key <AuthKey_KEYID.p8> --key-id <KEYID> --issuer <issuer ID>[\s\S]*--apple-id <your Apple ID> --team-id ABCDE12345/);
    assert.deepEqual(r.tools, ['security', 'xcrun']);
    assert.deepEqual(r.calls.find((c) => c[0] === 'xcrun'), ['xcrun', 'notarytool', 'history', '--keychain-profile', 'hfd-notary']);
  });
});

describe('build-signed-mac.sh source guarantees', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');
  it('never strips quarantine or weakens Gatekeeper', () => {
    assert.doesNotMatch(source, /xattr|com\.apple\.quarantine|--master-disable|--add\b|--disable/);
  });
  it('signs via env and a temporary --config, builds the offline DMG, and verifies with the opt-in gate', () => {
    for (const piece of ['HFD_OFFLINE_EXTRACTION=1', 'APPLE_SIGNING_IDENTITY="$IDENTITY"', 'npm run tauri -- build --bundles dmg --config "$CONFIG"',
      'hardenedRuntime: true', '--keychain-profile "$NOTARY_PROFILE" --wait', 'xcrun stapler staple', 'xcrun stapler validate',
      'HFD_EXPECT_DEVELOPER_ID_TEAM="$TEAM_ID" bash scripts/verify-macos-bundle-signature.sh', 'source=Notarized Developer ID', 'shasum -a 256',
      'BUNDLE_ID="com.herflightdeck.app"']) {
      assert.ok(source.includes(piece), piece);
    }
  });
  it('keeps the committed ad-hoc signingIdentity', () => {
    const conf = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8'));
    assert.equal(conf.bundle.macOS.signingIdentity, '-');
    assert.equal(conf.identifier, 'com.herflightdeck.app');
  });
});
