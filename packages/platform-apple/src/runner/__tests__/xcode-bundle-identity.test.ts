import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'vitest';
import {
  readSdkVersion,
  readXcodeVersion,
  ToolchainFileError,
  type AppleSdkName,
} from '../xcode-bundle-identity.ts';
import { writeXcodeFixture } from './apple-toolchain-fixtures.ts';
import { mkdtempForTestSync } from './tmp-dir.ts';

const VERSION_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>BuildVersion</key>
	<string>2</string>
	<key>CFBundleShortVersionString</key>
	<string>27.1</string>
	<key>CFBundleVersion</key>
	<string>24563</string>
	<key>ProductBuildVersion</key>
	<string>27A9275</string>
</dict>
</plist>
`;

test('the Xcode version is the bundle short version and product build, as xcodebuild prints', () => {
  const developerDir = writeXcodeFixture(mkdtempForTestSync('xcode-'));
  fs.writeFileSync(path.join(developerDir, '..', 'version.plist'), VERSION_PLIST);
  assert.deepEqual(readXcodeVersion(developerDir), { version: '27.1', buildVersion: '27A9275' });
});

test('each runner SDK reads its version and build from its own platform directory', () => {
  const developerDir = writeXcodeFixture(mkdtempForTestSync('xcode-'));
  const directories: Record<AppleSdkName, string> = {
    iphonesimulator: 'iPhoneSimulator',
    iphoneos: 'iPhoneOS',
    appletvsimulator: 'AppleTVSimulator',
    appletvos: 'AppleTVOS',
    macosx: 'MacOSX',
    xrsimulator: 'XRSimulator',
    xros: 'XROS',
  };
  const entries = Object.entries(directories) as [AppleSdkName, string][];
  entries.forEach(([, directory], index) => {
    const sdk = path.join(
      developerDir,
      `Platforms/${directory}.platform/Developer/SDKs/${directory}.sdk`,
    );
    fs.writeFileSync(
      path.join(sdk, 'SDKSettings.json'),
      JSON.stringify({ Version: `30.${index}` }),
    );
    fs.writeFileSync(
      path.join(sdk, 'System/Library/CoreServices/SystemVersion.plist'),
      `<plist><dict><key>ProductBuildVersion</key><string>B${index}</string></dict></plist>`,
    );
  });
  for (const [sdkName] of entries) {
    const index = entries.findIndex(([name]) => name === sdkName);
    assert.deepEqual(readSdkVersion(developerDir, sdkName), {
      version: `30.${index}`,
      buildVersion: `B${index}`,
    });
  }
});

test('a toolchain file without the key it must carry is a typed failure, not an empty value', () => {
  const developerDir = writeXcodeFixture(mkdtempForTestSync('xcode-'));
  const settings = path.join(
    developerDir,
    'Platforms/iPhoneSimulator.platform/Developer/SDKs/iPhoneSimulator.sdk/SDKSettings.json',
  );
  fs.writeFileSync(settings, JSON.stringify({ Version: ' ' }));
  assert.throws(
    () => readSdkVersion(developerDir, 'iphonesimulator'),
    (error: unknown) =>
      error instanceof ToolchainFileError &&
      error.file === settings &&
      error.detail === 'no Version',
  );
  fs.writeFileSync(settings, '{');
  assert.throws(
    () => readSdkVersion(developerDir, 'iphonesimulator'),
    (error: unknown) => error instanceof ToolchainFileError && error.detail === 'not JSON',
  );
});
