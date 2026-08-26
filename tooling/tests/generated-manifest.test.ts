import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { buildGeneratedOutputs } from '../src/generate.js'
import {
  GENERATED_MANIFEST_PATH,
  PUBLIC_GENERATOR_AUTHORITY_INPUTS,
  buildGeneratedManifest,
  verifyPublicAuthorityRegeneration,
  verifyDeletionRegeneration,
} from '../src/generated-manifest.js'
import { sha256 } from '../src/source.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

test('generated manifest covers every generated output with its content hash', () => {
  const manifest = buildGeneratedManifest(root)
  const outputs = buildGeneratedOutputs(root)

  assert.equal(manifest.schemaVersion, 2)
  assert.deepEqual(
    manifest.inputs.map(({ path, sha256: hash, bytes }) => ({ path, hash, bytes })),
    PUBLIC_GENERATOR_AUTHORITY_INPUTS.map((path) => {
      const content = readFileSync(resolve(root, path))
      return { path, hash: sha256(content), bytes: content.byteLength }
    }),
  )

  assert.deepEqual(
    manifest.outputs.map(({ path, sha256: hash }) => ({ path, hash })),
    outputs.map((output) => ({
      path: output.path.slice(root.length + 1),
      hash: sha256(output.content),
    })),
  )
})

test('forward generation authority excludes the facade migration importer', () => {
  assert.ok(PUBLIC_GENERATOR_AUTHORITY_INPUTS.includes('tooling/src/template-authority.ts'))
  assert.ok(PUBLIC_GENERATOR_AUTHORITY_INPUTS.includes('tooling/src/test-profile.ts'))
  assert.ok(PUBLIC_GENERATOR_AUTHORITY_INPUTS.includes('tooling/src/platform-implementation-types.ts'))
  assert.ok(PUBLIC_GENERATOR_AUTHORITY_INPUTS.includes('tooling/src/signature.ts'))
  assert.equal(PUBLIC_GENERATOR_AUTHORITY_INPUTS.includes('tooling/src/import-contract.ts' as never), false)
})

test('committed generated manifest is current and deterministic', () => {
  const expected = `${JSON.stringify(buildGeneratedManifest(root), null, 2)}\n`
  assert.equal(readFileSync(resolve(root, GENERATED_MANIFEST_PATH), 'utf8'), expected)
})

test('deleting every generated output and regenerating twice reproduces repository bytes', () => {
  if (existsSync(resolve(root, 'contracts/enterprise/delta.json'))) {
    const result = verifyPublicAuthorityRegeneration(root)
    assert.equal(result.outputCount, buildGeneratedOutputs(root).length)
    assert.equal(result.deterministic, true)
    return
  }
  const result = verifyDeletionRegeneration(root)
  assert.equal(result.outputCount, buildGeneratedOutputs(root).length)
  assert.equal(result.repositoryIdentical, true)
  assert.equal(result.deterministic, true)
})

test('generated interface declares every public constant and callable', () => {
  const source = readFileSync(resolve(root, 'uni_modules/unix-openim-sdk/utssdk/interface.uts'), 'utf8')
  assert.match(source, /export declare const OpenIMMessageStatusNotExist : OpenIMMessageStatus/)
  assert.match(source, /export declare function off\(subscription:OpenIMSDKEventSubscription\) : void/)
  assert.match(source, /export declare function offAll\(eventName:OpenIMSDKEventName\) : void/)
  assert.match(source, /export declare const login : \(userID:string,token:string,operationID\?:string\|null\) => Promise<string>/)
})

test('generated automation profile registry matches every callable disposition', () => {
  const disposition = JSON.parse(readFileSync(resolve(root, 'contracts/base/test-disposition.json'), 'utf8')) as {
    callables: Array<{
      apiName: string
      semanticProfile: string
      sideEffectProbe: string
      negativeProfiles: string[]
      negativeProducers: Array<{ profile: string; producer: { key: string; suite: string; scenario: string; platforms: string[] } }>
      cleanupAction: string
      cleanupRule?: string
      cleanupProducer?: { key: string; suite: string; scenario: string; platforms: string[] }
      validationAxes: string[]
      validationAxesByPlatform: { android: string[]; ios: string[]; harmony: string[] }
    }>
  }
  const output = buildGeneratedOutputs(root).find((item) => item.path === resolve(root, 'pages/index/openim-automation-profiles.uts'))
  assert.ok(output, 'automation profile registry must be a generated output')
  const producerSource = (producer: { key: string; suite: string; scenario: string; platforms: string[] }) => (
    `{ key: ${JSON.stringify(producer.key)}, suite: ${JSON.stringify(producer.suite)}, scenario: ${JSON.stringify(producer.scenario)}, platforms: [${producer.platforms.map((platform) => JSON.stringify(platform)).join(', ')}] }`
  )
  const axesByPlatformSource = (axes: { android: string[]; ios: string[]; harmony: string[] }) => (
    `{ android: [${axes.android.map((axis) => JSON.stringify(axis)).join(', ')}], ios: [${axes.ios.map((axis) => JSON.stringify(axis)).join(', ')}], harmony: [${axes.harmony.map((axis) => JSON.stringify(axis)).join(', ')}] }`
  )
  for (const item of disposition.callables) {
    const negativeProfiles = `[${item.negativeProfiles.map((profile) => JSON.stringify(profile)).join(', ')}]`
    const negativeProducers = `[${item.negativeProducers.map((value) => `{ profile: ${JSON.stringify(value.profile)}, producer: ${producerSource(value.producer)} }`).join(', ')}]`
    const cleanupProducer = item.cleanupProducer == null
      ? 'null'
      : `{ action: ${JSON.stringify(item.cleanupAction)}, rule: ${JSON.stringify(item.cleanupRule ?? '')}, producer: ${producerSource(item.cleanupProducer)} }`
    const expected = `{ apiName: ${JSON.stringify(item.apiName)}, semanticProfile: ${JSON.stringify(item.semanticProfile)}, sideEffectProbe: ${JSON.stringify(item.sideEffectProbe)}, negativeProfiles: ${negativeProfiles}, negativeProducers: ${negativeProducers}, cleanupAction: ${JSON.stringify(item.cleanupAction)}, cleanupRule: ${JSON.stringify(item.cleanupRule ?? '')}, cleanupProducer: ${cleanupProducer}, validationAxes: [${item.validationAxes.map((axis) => JSON.stringify(axis)).join(', ')}], validationAxesByPlatform: ${axesByPlatformSource(item.validationAxesByPlatform)} }`
    assert.ok(output.content.includes(expected), `missing generated callable profile: ${item.apiName}`)
  }
  assert.match(output.content, /validationAxes : Array<string>/)
  assert.match(output.content, /validationAxesByPlatform : OpenIMAutomationValidationAxesByPlatform \| null/)
  assert.equal((output.content.match(/apiName:/g) ?? []).length, disposition.callables.length)
})
