import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { installOfflineSDKProfile, resolveOfflineSDKProfile, verifyOfflineSDKProfile } from '../src/dcloud-offline-sdk.js'

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function fixtureArchive(root: string, platform: 'android' | 'ios'): string {
  const stage = join(root, `${platform}-stage`)
  const archive = join(root, `${platform}.zip`)
  if (platform === 'android') {
    mkdirSync(join(stage, 'Android-Test-SDK/SDK/libs'), { recursive: true })
    mkdirSync(join(stage, 'Android-Test-SDK/HBuilder-HelloUniApp'), { recursive: true })
    mkdirSync(join(stage, 'Android-Test-SDK/HBuilder-Integrate-AS'), { recursive: true })
    mkdirSync(join(stage, 'Android-Test-SDK/UniPlugin-Hello-AS'), { recursive: true })
    writeFileSync(join(stage, 'Android-Test-SDK/license.md'), 'fixture license\n')
    writeFileSync(join(stage, 'Android-Test-SDK/SDK/libs/lib.5plus.base-release.aar'), 'base')
    writeFileSync(join(stage, 'Android-Test-SDK/SDK/libs/uniapp-v8-release.aar'), 'uniapp')
    writeFileSync(join(stage, 'Android-Test-SDK/SDK/libs/utsplugin-release.aar'), 'uts')
  } else {
    mkdirSync(join(stage, 'SDK/SDK/UTS'), { recursive: true })
    mkdirSync(join(stage, 'SDK/SDK/Libs'), { recursive: true })
    mkdirSync(join(stage, 'SDK/HBuilder-Hello'), { recursive: true })
    mkdirSync(join(stage, 'SDK/HBuilder-uniPluginDemo'), { recursive: true })
    writeFileSync(join(stage, 'SDK/license.md'), 'fixture license\n')
    writeFileSync(join(stage, 'SDK/SDK/UTS/DCloudUTSConfig.h'), 'fixture')
    writeFileSync(join(stage, 'SDK/SDK/Libs/liblibUI.a'), 'fixture')
  }
  execFileSync('zip', ['-X', '-q', '-r', archive, '.'], { cwd: stage })
  return archive
}

test('shared DCloud toolchain installer creates a repository-independent versioned profile', async () => {
  const root = mkdtempSync(join(tmpdir(), 'openim-dcloud-profile-'))
  const androidArchive = fixtureArchive(root, 'android')
  const iosArchive = fixtureArchive(root, 'ios')
  const toolchainsRoot = join(root, 'toolchains')

  const profile = await installOfflineSDKProfile({
    profileID: '5.23.test-alpha',
    hbuilderxVersion: '5.23.test-alpha',
    distribution: 'alpha',
    toolchainsRoot,
    android: { archivePath: androidArchive, sha256: sha256(androidArchive), archiveRoot: 'Android-Test-SDK' },
    ios: { archivePath: iosArchive, sha256: sha256(iosArchive), archiveRoot: 'SDK' },
  })

  assert.equal(profile.profileID, '5.23.test-alpha')
  assert.equal(profile.hbuilderxVersion, '5.23.test-alpha')
  assert.equal(profile.paths.androidSDKRoot, join(toolchainsRoot, '5.23.test-alpha/uniapp/android'))
  assert.equal(profile.paths.iosSDKRoot, join(toolchainsRoot, '5.23.test-alpha/uniapp/ios'))
  assert.equal(profile.sources.android.preservedArchivePath, join(toolchainsRoot, '5.23.test-alpha/archives/android.zip'))
  assert.equal(profile.sources.ios.preservedArchivePath, join(toolchainsRoot, '5.23.test-alpha/archives/ios.zip'))
  assert.equal(existsSync(profile.sources.android.preservedArchivePath), true)
  assert.equal(existsSync(profile.sources.ios.preservedArchivePath), true)
  assert.equal(JSON.parse(readFileSync(profile.profilePath, 'utf8')).dirty, false)

  const repeated = await installOfflineSDKProfile({
    profileID: '5.23.test-alpha',
    hbuilderxVersion: '5.23.test-alpha',
    distribution: 'alpha',
    toolchainsRoot,
    android: { archivePath: androidArchive, sha256: sha256(androidArchive), archiveRoot: 'Android-Test-SDK' },
    ios: { archivePath: iosArchive, sha256: sha256(iosArchive), archiveRoot: 'SDK' },
  })
  assert.deepEqual(repeated, profile)
  assert.deepEqual(verifyOfflineSDKProfile(profile.profilePath), profile)

  const previousProfileEnvironment = process.env.OPENIM_DCLOUD_OFFLINE_SDK_PROFILE
  process.env.OPENIM_DCLOUD_OFFLINE_SDK_PROFILE = profile.profilePath
  try {
    assert.deepEqual(resolveOfflineSDKProfile(), profile)
  } finally {
    if (previousProfileEnvironment == null) delete process.env.OPENIM_DCLOUD_OFFLINE_SDK_PROFILE
    else process.env.OPENIM_DCLOUD_OFFLINE_SDK_PROFILE = previousProfileEnvironment
  }
})

test('shared DCloud toolchain installer rejects an archive mismatch without replacing another version', async () => {
  const root = mkdtempSync(join(tmpdir(), 'openim-dcloud-profile-mismatch-'))
  const androidArchive = fixtureArchive(root, 'android')
  const iosArchive = fixtureArchive(root, 'ios')
  const toolchainsRoot = join(root, 'toolchains')
  await assert.rejects(
    installOfflineSDKProfile({
      profileID: '5.24.test-alpha',
      hbuilderxVersion: '5.24.test-alpha',
      distribution: 'alpha',
      toolchainsRoot,
      android: { archivePath: androidArchive, sha256: '0'.repeat(64), archiveRoot: 'Android-Test-SDK' },
      ios: { archivePath: iosArchive, sha256: sha256(iosArchive), archiveRoot: 'SDK' },
    }),
    /Android offline SDK archive SHA-256 mismatch/,
  )
  assert.equal(existsSync(join(toolchainsRoot, '5.24.test-alpha')), false)

  const installed = await installOfflineSDKProfile({
    profileID: '5.23.test-alpha',
    hbuilderxVersion: '5.23.test-alpha',
    distribution: 'alpha',
    toolchainsRoot,
    android: { archivePath: androidArchive, sha256: sha256(androidArchive), archiveRoot: 'Android-Test-SDK' },
    ios: { archivePath: iosArchive, sha256: sha256(iosArchive), archiveRoot: 'SDK' },
  })
  assert.equal(existsSync(installed.paths.profileRoot), true)

  await assert.rejects(
    installOfflineSDKProfile({
      profileID: '5.23.test-alpha',
      hbuilderxVersion: '5.23.test-alpha',
      distribution: 'alpha',
      toolchainsRoot,
      android: { archivePath: androidArchive, sha256: '1'.repeat(64), archiveRoot: 'Android-Test-SDK' },
      ios: { archivePath: iosArchive, sha256: sha256(iosArchive), archiveRoot: 'SDK' },
    }),
    /different immutable inputs/,
  )
})
