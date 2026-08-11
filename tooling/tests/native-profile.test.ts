import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { localNativeConfig, withLocalNativeProfile } from '../src/native-profile.js'

test('local profiles remove remote dependencies instead of combining both sources', () => {
  assert.deepEqual(localNativeConfig('android', { dependencies: [{ id: 'remote' }], minSdkVersion: 21 }), { minSdkVersion: 21 })
  assert.deepEqual(
    localNativeConfig('ios', { 'dependencies-pods': [{ name: 'remote' }], 'dependencies-pod-sources': ['remote'], deploymentTarget: '12.0' }),
    { deploymentTarget: '12.0' },
  )
})

test('local profile restores the committed config byte-for-byte after failure', async () => {
  const root = mkdtempSync(join(tmpdir(), 'openim-native-profile-'))
  const directory = join(root, 'uni_modules/unix-openim-sdk/utssdk/app-ios')
  mkdirSync(directory, { recursive: true })
  const path = join(directory, 'config.json')
  const original = '{"dependencies-pods":[{"name":"remote"}],"deploymentTarget":"12.0"}\n'
  writeFileSync(path, original)

  await assert.rejects(
    withLocalNativeProfile(root, 'ios', async () => {
      assert.equal(readFileSync(path, 'utf8').includes('dependencies-pods'), false)
      throw new Error('fixture')
    }),
    /fixture/,
  )
  assert.equal(readFileSync(path, 'utf8'), original)
})
