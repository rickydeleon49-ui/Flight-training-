import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { bumpIosBuildNumber } from './bump-version.mjs';
import { checkBuildIncreased, checkInfoPlist, checkSigning, pngHasAlpha } from './testflight-checks.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

function png(colorType, extraChunk) {
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'latin1');
    data.copy(out, 8);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    ...(extraChunk ? [chunk(extraChunk, Buffer.from([0]))] : []),
    chunk('IDAT', deflateSync(Buffer.from([0, 0, 0, 0]))),
  ]);
}

test('pngHasAlpha detects RGBA, gray+alpha and tRNS, and passes plain RGB', () => {
  assert.equal(pngHasAlpha(png(6)), true);
  assert.equal(pngHasAlpha(png(4)), true);
  assert.equal(pngHasAlpha(png(2, 'tRNS')), true);
  assert.equal(pngHasAlpha(png(2)), false);
  assert.throws(() => pngHasAlpha(Buffer.from('nope')));
});

test('the shipped 1024 app icon has no alpha channel', () => {
  const icon = path.join(root, 'src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png');
  assert.equal(pngHasAlpha(readFileSync(icon)), false);
});

test('checkInfoPlist reports missing keys, wrong bundle id and non-integer build', () => {
  const good = {
    CFBundleIdentifier: 'com.herflightdeck.app', CFBundleShortVersionString: '0.6.7', CFBundleVersion: '3',
    ITSAppUsesNonExemptEncryption: false, UILaunchStoryboardName: 'LaunchScreen', MinimumOSVersion: '16.0',
  };
  assert.deepEqual(checkInfoPlist(good), []);
  assert.equal(checkInfoPlist({ ...good, ITSAppUsesNonExemptEncryption: undefined }).length, 1);
  assert.equal(checkInfoPlist({ ...good, CFBundleIdentifier: 'x.y' }).length, 1);
  assert.equal(checkInfoPlist({ ...good, CFBundleVersion: '0.6.7' }).length, 1);
});

test('checkBuildIncreased needs a strictly larger whole number', () => {
  assert.deepEqual(checkBuildIncreased('2', undefined), []);
  assert.deepEqual(checkBuildIncreased('3', '2'), []);
  assert.equal(checkBuildIncreased('2', '2').length, 1);
  assert.equal(checkBuildIncreased('1.2', '0').length, 1);
});

test('checkSigning wants an Apple Distribution authority', () => {
  assert.deepEqual(checkSigning('Authority=Apple Distribution: A (TEAM)\n'), []);
  assert.equal(checkSigning('Authority=Apple Development: A (TEAM)\n').length, 1);
});

test('bumpIosBuildNumber raises only the build number, skipping past a recorded upload', (t) => {
  const dir = mkdtempSync(path.join(realpathSync(tmpdir()), 'tf-bump-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const apple = 'src-tauri/gen/apple';
  mkdirSync(path.join(dir, apple, 'her-flight-deck_iOS'), { recursive: true });
  cpSync(path.join(root, apple, 'project.yml'), path.join(dir, apple, 'project.yml'));
  cpSync(path.join(root, apple, 'her-flight-deck_iOS/Info.plist'), path.join(dir, apple, 'her-flight-deck_iOS/Info.plist'));
  const read = (f) => readFileSync(path.join(dir, apple, f), 'utf8');
  // Start from build 1 so the test does not depend on the repo's current build number.
  const pin = (f, re, to) => writeFileSync(path.join(dir, apple, f), read(f).replace(re, to));
  pin('her-flight-deck_iOS/Info.plist', /(CFBundleVersion<\/key>\s*<string>)[^<]*/, '$11');
  pin('project.yml', /CFBundleVersion: "[^"]*"/, 'CFBundleVersion: "1"');
  const short = read('her-flight-deck_iOS/Info.plist').match(/CFBundleShortVersionString<\/key>\s*<string>([^<]*)/)[1];
  const first = bumpIosBuildNumber(dir);
  assert.equal(bumpIosBuildNumber(dir, 10), 11);
  assert.ok(first >= 2);
  assert.match(read('her-flight-deck_iOS/Info.plist'), /CFBundleVersion<\/key>\s*<string>11</);
  assert.match(read('project.yml'), /CFBundleVersion: "11"/);
  assert.equal(read('her-flight-deck_iOS/Info.plist').match(/CFBundleShortVersionString<\/key>\s*<string>([^<]*)/)[1], short);
});
