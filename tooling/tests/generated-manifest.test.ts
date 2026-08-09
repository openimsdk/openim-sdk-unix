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
    callables: Array<{ apiName: string; semanticProfile: string; sideEffectProbe: string }>
  }
  const output = buildGeneratedOutputs(root).find((item) => item.path === resolve(root, 'pages/index/openim-automation-profiles.uts'))
  assert.ok(output, 'automation profile registry must be a generated output')
  for (const item of disposition.callables) {
    assert.match(
      output.content,
      new RegExp(`apiName: '${item.apiName}', semanticProfile: '${item.semanticProfile}', sideEffectProbe: '${item.sideEffectProbe}'`),
    )
  }
  assert.equal((output.content.match(/apiName:/g) ?? []).length, disposition.callables.length)
})
