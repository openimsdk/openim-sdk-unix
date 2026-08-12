import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  installUniToolchainProfile,
  resolveUniToolchainProfile,
  verifyUniToolchainProfile,
  type UniSurfaceFamily,
  type UniNativePlatform,
  type UniToolchainCatalogV2,
} from '../src/uni-toolchain.js'

const fixtureHostTools = {
  hbuilderxCli: { path: '/fixture/hbuilderx', version: '5.23.test', sha256: 'a'.repeat(64) },
  java: { path: '/fixture/java', version: '17', sha256: 'b'.repeat(64) },
  gradle: { path: '/fixture/gradle', version: '8.14.3', sha256: 'c'.repeat(64) },
  androidSDK: { path: '/fixture/android-sdk', buildToolsVersions: ['36.0.0'], ndkVersions: ['28.2.13676358'] },
  xcode: { path: '/fixture/xcodebuild', version: 'Xcode 26.2' },
  swift: { path: '/fixture/swift', version: 'Swift 6.2.3' },
  cocoapods: { path: '/fixture/pod', version: '1.16.2' },
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function write(path: string, value = 'fixture'): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, value)
}

function archiveFixture(root: string, family: UniSurfaceFamily, platform: UniNativePlatform): { path: string; archiveRoot: string } {
  const stage = join(root, `${family}-${platform}-stage`)
  const archiveRoot = `${family}-${platform}-sdk`
  const sdk = join(stage, archiveRoot)
  if (family === 'uniapp' && platform === 'android') {
    write(join(sdk, 'SDK/libs/lib.5plus.base-release.aar'))
    write(join(sdk, 'SDK/libs/uniapp-v8-release.aar'))
    write(join(sdk, 'SDK/libs/utsplugin-release.aar'))
    write(join(sdk, 'UniPlugin-Hello-AS/app/build.gradle'))
  } else if (family === 'uniapp' && platform === 'ios') {
    write(join(sdk, 'SDK/UTS/DCloudUTSConfig.h'))
    write(join(sdk, 'SDK/Libs/DCloudUTSFoundation.framework/binary'))
    write(join(sdk, 'HBuilder-Hello/HBuilder-Hello.xcodeproj/project.pbxproj'))
    mkdirSync(join(sdk, 'HBuilder-Hello/UTSPlugins'), { recursive: true })
  } else if (family === 'uniappx' && platform === 'android') {
    write(join(sdk, 'SDK/libs/uts-runtime-release.aar'))
    write(join(sdk, 'plugins/uts-kotlin-gradle-plugin-0.0.1.jar'))
    write(join(sdk, 'plugins/uts-kotlin-compiler-plugin-0.0.1.jar'))
    write(join(sdk, 'uniappxnativepackage/app/build.gradle'))
    write(join(sdk, 'uniappxnativepackage/uniappx/build.gradle'))
  } else {
    const plist = `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>AvailableLibraries</key><array><dict><key>SupportedPlatform</key><string>ios</string><key>SupportedArchitectures</key><array><string>arm64</string></array></dict><dict><key>SupportedPlatform</key><string>ios</string><key>SupportedPlatformVariant</key><string>simulator</string><key>SupportedArchitectures</key><array><string>arm64</string><string>x86_64</string></array></dict></array></dict></plist>`
    write(join(sdk, 'SDK/Libs/DCloudUniappRuntime.xcframework/Info.plist'), plist)
    write(join(sdk, 'SDK/Libs/DCloudUTSFoundation.xcframework/Info.plist'), plist)
    write(join(sdk, 'UniAppXDemo/UniAppXDemo.xcodeproj/project.pbxproj'))
    write(join(sdk, 'UniAppXDemo/UniAppXDemo/UniAppBridge.swift'))
    mkdirSync(join(sdk, 'embedded/.git/objects'), { recursive: true })
    write(join(sdk, 'embedded/.git/config'))
    write(join(sdk, '.DS_Store'))
  }
  const archive = join(root, `${family}-${platform}.zip`)
  execFileSync('zip', ['-X', '-q', '-r', archive, archiveRoot], { cwd: stage })
  return { path: archive, archiveRoot }
}

test('profile v2 installs four immutable Uni SDKs and removes archive metadata', async () => {
  const root = mkdtempSync(join(tmpdir(), 'openim-uni-toolchain-v2-'))
  const fixtures = {
    uniapp: { android: archiveFixture(root, 'uniapp', 'android'), ios: archiveFixture(root, 'uniapp', 'ios') },
    uniappx: { android: archiveFixture(root, 'uniappx', 'android'), ios: archiveFixture(root, 'uniappx', 'ios') },
  }
  const catalog: UniToolchainCatalogV2 = {
    schemaVersion: 2,
    profileID: 'fixture-v2',
    hbuilderx: { version: '5.23.test', distribution: 'alpha', cliSha256: 'a'.repeat(64) },
    sdks: {
      uniapp: {
        android: { archiveFileName: 'classic-android.zip', archiveRoot: fixtures.uniapp.android.archiveRoot, sha256: sha256(fixtures.uniapp.android.path) },
        ios: { archiveFileName: 'classic-ios.zip', archiveRoot: fixtures.uniapp.ios.archiveRoot, sha256: sha256(fixtures.uniapp.ios.path) },
      },
      uniappx: {
        android: { archiveFileName: 'x-android.zip', archiveRoot: fixtures.uniappx.android.archiveRoot, sha256: sha256(fixtures.uniappx.android.path) },
        ios: { archiveFileName: 'x-ios.zip', archiveRoot: fixtures.uniappx.ios.archiveRoot, sha256: sha256(fixtures.uniappx.ios.path) },
      },
    },
  }
  const profile = await installUniToolchainProfile({
    catalog,
    toolchainsRoot: join(root, 'toolchains'),
    archives: {
      uniapp: {
        android: { archivePath: fixtures.uniapp.android.path, archiveRoot: fixtures.uniapp.android.archiveRoot, sha256: sha256(fixtures.uniapp.android.path) },
        ios: { archivePath: fixtures.uniapp.ios.path, archiveRoot: fixtures.uniapp.ios.archiveRoot, sha256: sha256(fixtures.uniapp.ios.path) },
      },
      uniappx: {
        android: { archivePath: fixtures.uniappx.android.path, archiveRoot: fixtures.uniappx.android.archiveRoot, sha256: sha256(fixtures.uniappx.android.path) },
        ios: { archivePath: fixtures.uniappx.ios.path, archiveRoot: fixtures.uniappx.ios.archiveRoot, sha256: sha256(fixtures.uniappx.ios.path) },
      },
    },
    observedHostTools: fixtureHostTools,
  })

  assert.equal(profile.schemaVersion, 2)
  assert.equal(profile.profileID, 'fixture-v2')
  assert.equal(profile.dirty, false)
  assert.equal(existsSync(join(profile.sdks.uniappx.ios.sdkRoot, 'embedded/.git')), false)
  assert.equal(existsSync(join(profile.sdks.uniappx.ios.sdkRoot, '.DS_Store')), false)
  assert.deepEqual(verifyUniToolchainProfile(profile.profilePath), profile)
  assert.equal(readFileSync(profile.activationScript, 'utf8').includes('OPENIM_UNI_TOOLCHAIN_PROFILE='), true)

  const before = process.env.OPENIM_UNI_TOOLCHAIN_PROFILE
  process.env.OPENIM_UNI_TOOLCHAIN_PROFILE = profile.profilePath
  try {
    assert.deepEqual(resolveUniToolchainProfile(), profile)
  } finally {
    if (before == null) delete process.env.OPENIM_UNI_TOOLCHAIN_PROFILE
    else process.env.OPENIM_UNI_TOOLCHAIN_PROFILE = before
  }
})

test('profile v2 refuses to overwrite a profile with different immutable inputs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'openim-uni-toolchain-v2-conflict-'))
  const fixtures = {
    uniapp: { android: archiveFixture(root, 'uniapp', 'android'), ios: archiveFixture(root, 'uniapp', 'ios') },
    uniappx: { android: archiveFixture(root, 'uniappx', 'android'), ios: archiveFixture(root, 'uniappx', 'ios') },
  }
  const archives = {
    uniapp: {
      android: { archivePath: fixtures.uniapp.android.path, archiveRoot: fixtures.uniapp.android.archiveRoot, sha256: sha256(fixtures.uniapp.android.path) },
      ios: { archivePath: fixtures.uniapp.ios.path, archiveRoot: fixtures.uniapp.ios.archiveRoot, sha256: sha256(fixtures.uniapp.ios.path) },
    },
    uniappx: {
      android: { archivePath: fixtures.uniappx.android.path, archiveRoot: fixtures.uniappx.android.archiveRoot, sha256: sha256(fixtures.uniappx.android.path) },
      ios: { archivePath: fixtures.uniappx.ios.path, archiveRoot: fixtures.uniappx.ios.archiveRoot, sha256: sha256(fixtures.uniappx.ios.path) },
    },
  }
  const catalog: UniToolchainCatalogV2 = {
    schemaVersion: 2,
    profileID: 'immutable-v2',
    hbuilderx: { version: '5.23.test', distribution: 'alpha', cliSha256: 'a'.repeat(64) },
    sdks: {
      uniapp: {
        android: { archiveFileName: 'a.zip', archiveRoot: archives.uniapp.android.archiveRoot, sha256: archives.uniapp.android.sha256 },
        ios: { archiveFileName: 'b.zip', archiveRoot: archives.uniapp.ios.archiveRoot, sha256: archives.uniapp.ios.sha256 },
      },
      uniappx: {
        android: { archiveFileName: 'c.zip', archiveRoot: archives.uniappx.android.archiveRoot, sha256: archives.uniappx.android.sha256 },
        ios: { archiveFileName: 'd.zip', archiveRoot: archives.uniappx.ios.archiveRoot, sha256: archives.uniappx.ios.sha256 },
      },
    },
  }
  await installUniToolchainProfile({ catalog, toolchainsRoot: join(root, 'toolchains'), archives, observedHostTools: fixtureHostTools })
  const changed = structuredClone(catalog)
  changed.hbuilderx.cliSha256 = 'b'.repeat(64)
  await assert.rejects(
    installUniToolchainProfile({ catalog: changed, toolchainsRoot: join(root, 'toolchains'), archives, observedHostTools: fixtureHostTools }),
    /different immutable inputs/,
  )
})
