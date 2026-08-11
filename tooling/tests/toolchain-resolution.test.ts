import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { resolveHBuilderXCLI, resolvePublicNativeRoot, verifyToolchain } from '../src/compile.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const lockText = readFileSync(resolve(root, 'toolchain.lock.json'), 'utf8')
const lock = JSON.parse(lockText)

test('toolchain lock contains no machine-specific workspace path', () => {
  assert.equal(lock.schemaVersion, 2)
  assert.doesNotMatch(lockText, /\/(?:Users|Volumes)\//)
  assert.equal(lock.hbuilderx.cliPath, undefined)
  assert.equal(lock.publicNative.source.defaultRoot, undefined)
})

test('Public package requires iOS 14 consistently', () => {
  const iosConfig = JSON.parse(readFileSync(resolve(
    root,
    'uni_modules/unix-openim-sdk/utssdk/app-ios/config.json',
  ), 'utf8'))
  const pluginPackage = JSON.parse(readFileSync(resolve(
    root,
    'uni_modules/unix-openim-sdk/package.json',
  ), 'utf8'))

  assert.equal(lock.minimumPlatforms.ios, '14.0')
  assert.equal(iosConfig.deploymentTarget, '14.0')
  assert.equal(pluginPackage.uni_modules.platforms.client['uni-app-x'].app.ios.minVersion, '14')
})

test('toolchain paths resolve from environment or verified siblings', () => {
  const cli = resolveHBuilderXCLI(lock, { [lock.hbuilderx.cliEnvironmentVariable]: '/tmp/explicit-hbuilderx-cli' })
  assert.equal(cli, '/tmp/explicit-hbuilderx-cli')

  const nativeRoot = resolvePublicNativeRoot(root, lock.publicNative.source)
  assert.equal(
    resolve(nativeRoot),
    resolve(root, '..', 'openim-sdk-core-v3.8.3-locked'),
  )
})

test('resolved toolchain proves Core revision and local native artifact hashes', () => {
  const isEnterpriseComposition = existsSync(resolve(root, 'contracts/enterprise/delta.json'))
  const verified = verifyToolchain(root, { verifyPublicNative: !isEnterpriseComposition })
  assert.equal(verified.hbuilderx.cliSha256, lock.hbuilderx.cliSha256)
})
