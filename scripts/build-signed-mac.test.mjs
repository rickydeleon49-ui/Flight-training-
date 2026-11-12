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
  delete base.HFD_NOTARY_PROFILE;
  delete base.HFD_NOTARY_KEY;
  delete base.HFD_NOTARY_KEY_ID;
  delete base.HFD_NOTARY_ISSUER;
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
    assert.match(r.output, /README\.md, Signed Mac builds, step 1/);
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

  it('uses the notary profile named by HFD_NOTARY_PROFILE', () => {
    const r = run(setup(), ['1.2.3'], { FAKE_IDENTITIES: ONE, FAKE_XCRUN_EXIT: '1', HFD_NOTARY_PROFILE: 'my-notary' });
    assert.equal(r.status, 1);
    assert.match(r.output, /keychain profile "my-notary" is missing/);
    assert.deepEqual(r.calls.find((c) => c[0] === 'xcrun'), ['xcrun', 'notarytool', 'history', '--keychain-profile', 'my-notary']);
  });

  it('mentions a locked Mac when the keychain profile does not work', () => {
    const r = run(setup(), ['1.2.3'], { FAKE_IDENTITIES: ONE, FAKE_XCRUN_EXIT: '1' });
    assert.match(r.output, /Mac may be locked/);
  });

  it('refuses a partial API key setting', () => {
    const r = run(setup(), ['1.2.3'], { FAKE_IDENTITIES: ONE, HFD_NOTARY_KEY: '/nonexistent/AuthKey.p8' });
    assert.equal(r.status, 1);
    assert.match(r.output, /set all three of HFD_NOTARY_KEY, HFD_NOTARY_KEY_ID and HFD_NOTARY_ISSUER/);
    assert.deepEqual(r.tools, ['security']);
  });

  it('refuses a missing API key file', () => {
    const r = run(setup(), ['1.2.3'], { FAKE_IDENTITIES: ONE, HFD_NOTARY_KEY: '/nonexistent/AuthKey.p8', HFD_NOTARY_KEY_ID: 'KEY123', HFD_NOTARY_ISSUER: 'issuer-1' });
    assert.equal(r.status, 1);
    assert.match(r.output, /HFD_NOTARY_KEY is not a readable file/);
    assert.deepEqual(r.tools, ['security']);
  });

  it('checks the API key with notarytool instead of a keychain profile', () => {
    const ctx = setup();
    const key = path.join(path.dirname(ctx.repo), 'AuthKey_KEY123.p8');
    fs.writeFileSync(key, 'not a real key\n');
    const r = run(ctx, ['1.2.3'], { FAKE_IDENTITIES: ONE, FAKE_XCRUN_EXIT: '1', HFD_NOTARY_KEY: key, HFD_NOTARY_KEY_ID: 'KEY123', HFD_NOTARY_ISSUER: 'issuer-1' });
    assert.equal(r.status, 1);
    assert.match(r.output, /notary API key KEY123 is not working/);
    assert.doesNotMatch(r.output, /not a real key/);
    assert.deepEqual(r.calls.find((c) => c[0] === 'xcrun'), ['xcrun', 'notarytool', 'history', '--key', key, '--key-id', 'KEY123', '--issuer', 'issuer-1']);
  });
});

describe('build-signed-mac.sh source guarantees', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');
  it('keeps the display awake while it runs', () => {
    assert.ok(source.includes('caffeinate -d -i -u -w $$'));
  });
  it('never strips quarantine or weakens Gatekeeper', () => {
    assert.doesNotMatch(source, /xattr|com\.apple\.quarantine|--master-disable|--add\b|--disable/);
  });
  it('signs via env and a temporary --config, builds the offline DMG, and verifies with the opt-in gate', () => {
    for (const piece of ['HFD_OFFLINE_EXTRACTION=1', 'APPLE_SIGNING_IDENTITY="$IDENTITY"', 'npm run tauri -- build --bundles app --config "$CONFIG"',
      'hardenedRuntime: true', 'NOTARY_AUTH=(--keychain-profile "$NOTARY_PROFILE")', '"${NOTARY_AUTH[@]}" --wait', 'xcrun stapler staple', 'xcrun stapler validate',
      'HFD_EXPECT_DEVELOPER_ID_TEAM="$TEAM_ID" bash scripts/verify-macos-bundle-signature.sh', 'source=Notarized Developer ID', 'shasum -a 256',
      'BUNDLE_ID="com.herflightdeck.app"']) {
      assert.ok(source.includes(piece), piece);
    }
  });
  it('staples the app before the DMG is built, then signs, notarizes and staples the DMG', () => {
    const order = ['--bundles app', 'ditto -c -k --keepParent "$APP" "$APP_ZIP"', 'notarize "$APP_ZIP"', 'xcrun stapler staple "$APP"',
      'xcrun stapler validate "$APP"', 'hdiutil create -volname "Your Flight Deck"', 'codesign --force --sign "$IDENTITY" --timestamp "$DMG"',
      'notarize "$DMG"', 'xcrun stapler staple "$DMG"', 'xcrun stapler validate "$DMG"', 'xcrun stapler validate "${apps[0]}"'];
    let at = -1;
    for (const piece of order) {
      const next = source.indexOf(piece, at + 1);
      assert.ok(next > at, `${piece} must come after the previous step`);
      at = next;
    }
    assert.doesNotMatch(source, /--bundles dmg/);
    assert.ok(source.includes('notarize() {') && source.includes('notarization was not Accepted'));
  });
  it('keeps the committed ad-hoc signingIdentity', () => {
    const conf = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8'));
    assert.equal(conf.bundle.macOS.signingIdentity, '-');
    assert.equal(conf.identifier, 'com.herflightdeck.app');
  });
});
