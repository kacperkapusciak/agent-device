import { beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { AppError } from '@agent-device/kernel/errors';
import { appleRunnerTestHost } from '../test-host.ts';
import {
  appleSelectionLink,
  STUBBED_APPLE_TOOLCHAIN,
  stubAppleSelectionLink,
  writeXcodeFixture,
} from './apple-toolchain-fixtures.ts';
import {
  readRunnerXcodeVersion,
  requireRunnerToolchainFingerprint,
} from '../runner-toolchain-identity.ts';
import { XCODE_SELECT_LINK_PATH } from '../xcode-bundle-identity.ts';
import { mkdtempForTestSync } from './tmp-dir.ts';

stubAppleSelectionLink();

/** Every field differs from the stubbed toolchain, so a half read from the wrong Xcode shows. */
const XCODE_B_TOOLCHAIN = {
  xcodeVersion: '27.0',
  xcodeBuildVersion: '18A100',
  sdkVersion: '27.0',
  sdkBuildVersion: '24A100',
};
const FINGERPRINT_A = { ...STUBBED_APPLE_TOOLCHAIN, sdkName: 'iphonesimulator' };
const FINGERPRINT_B = { ...XCODE_B_TOOLCHAIN, sdkName: 'iphonesimulator' };

let xcodeA: string;
let xcodeB: string;

beforeEach(() => {
  xcodeA = writeXcodeFixture(mkdtempForTestSync('xcode-a-'));
  xcodeB = writeXcodeFixture(mkdtempForTestSync('xcode-b-'), XCODE_B_TOOLCHAIN);
});

function readFingerprint() {
  return requireRunnerToolchainFingerprint('iphonesimulator', undefined);
}

test('a client DEVELOPER_DIR names the Xcode the fingerprint is read from', () => {
  appleRunnerTestHost.update({ commandDeveloperDir: () => xcodeB });
  assert.deepEqual(readFingerprint(), FINGERPRINT_B);
});

test('a DEVELOPER_DIR carrying a trailing newline names the dir alone', () => {
  appleRunnerTestHost.update({ commandDeveloperDir: () => `${xcodeB}\n` });
  assert.deepEqual(readFingerprint(), FINGERPRINT_B);
});

test('a DEVELOPER_DIR naming the Xcode.app bundle reads its Contents/Developer', () => {
  appleRunnerTestHost.update({ commandDeveloperDir: () => path.resolve(xcodeB, '../..') });
  assert.deepEqual(readFingerprint(), FINGERPRINT_B);
});

test('without DEVELOPER_DIR the host selection link names the Xcode, and a moved link moves it', () => {
  appleRunnerTestHost.update({ commandDeveloperDir: () => undefined });
  appleSelectionLink.target = xcodeA;
  assert.deepEqual(readFingerprint(), FINGERPRINT_A);
  appleSelectionLink.target = xcodeB;
  assert.deepEqual(readFingerprint(), FINGERPRINT_B);
});

test('a selection link whose Xcode is gone fails instead of reading another Xcode', () => {
  appleRunnerTestHost.update({ commandDeveloperDir: () => undefined });
  appleSelectionLink.target = path.join(mkdtempForTestSync('deleted-xcode-'), 'Xcode.app');
  assert.throws(
    readFingerprint,
    (error: unknown) =>
      error instanceof AppError &&
      error.details?.reason === 'apple_toolchain_unreadable' &&
      error.details?.file === XCODE_SELECT_LINK_PATH &&
      error.details?.detail === 'dangling selection link',
  );
});

test('a selection link this process cannot read fails instead of reading the default Xcode', () => {
  appleRunnerTestHost.update({ commandDeveloperDir: () => undefined });
  vi.spyOn(fs, 'readlinkSync').mockImplementation(() => {
    throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
  });
  assert.throws(
    readFingerprint,
    (error: unknown) =>
      error instanceof AppError &&
      error.details?.reason === 'apple_toolchain_unreadable' &&
      error.details?.file === XCODE_SELECT_LINK_PATH &&
      error.details?.detail === 'EACCES',
  );
});

test('a bundle swapped behind a stable selection path is read from the bundle now standing there', () => {
  const stable = path.join(mkdtempForTestSync('xcode-stable-'), 'Xcode.app');
  fs.symlinkSync(path.resolve(xcodeA, '../..'), stable);
  appleRunnerTestHost.update({
    commandDeveloperDir: () => path.join(stable, 'Contents/Developer'),
  });
  assert.deepEqual(readFingerprint(), FINGERPRINT_A);

  fs.rmSync(stable);
  fs.symlinkSync(path.resolve(xcodeB, '../..'), stable);
  assert.deepEqual(readFingerprint(), FINGERPRINT_B);
});

test('a developer dir without an Xcode bundle fails with the file it could not read', () => {
  const commandLineTools = mkdtempForTestSync('command-line-tools-');
  appleRunnerTestHost.update({ commandDeveloperDir: () => commandLineTools });
  assert.throws(
    readFingerprint,
    (error: unknown) =>
      error instanceof AppError &&
      error.details?.reason === 'apple_toolchain_unreadable' &&
      error.details?.file === path.join(fs.realpathSync(commandLineTools), '..', 'version.plist'),
  );
  assert.equal(readRunnerXcodeVersion(), undefined);
});

test('a failure report reads the selected Xcode without waiting for a cache decision', () => {
  appleRunnerTestHost.update({ commandDeveloperDir: () => xcodeB });
  assert.equal(readRunnerXcodeVersion(), '27.0');
});
