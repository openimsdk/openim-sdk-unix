import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { buildEnterpriseGeneratedOutputs, generateEnterprise } from './enterprise-compose.js'
import { sha256 } from './source.js'

export const ENTERPRISE_GENERATED_MANIFEST_PATH = 'contracts/enterprise/generated-manifest.json'

export const ENTERPRISE_GENERATOR_AUTHORITY_INPUTS = [
  'contracts/base/contract.json',
  'contracts/enterprise/delta.json',
  'contracts/enterprise/native-abi/harmony.json',
  'sdk-src/uts/app-android/index.enterprise.template.uts',
  'sdk-src/uts/app-ios/index.enterprise.template.uts',
  'sdk-src/uts/app-harmony/index.template.uts',
  'sdk-src/uts/app-harmony/facade-projection.json',
  'sdk-src/uts/app-android/events.prelude.uts',
  'sdk-src/uts/app-ios/events.prelude.uts',
  'sdk-src/native/android/OpenIMDriverRuntime.kt',
  'sdk-src/native/ios/OpenIMDriverRuntime.swift',
  'sdk-src/native/harmony/OpenIMHarmonyDriver.ets',
  'tooling/src/contract-integrity.ts',
  'tooling/src/enterprise-compose.ts',
  'tooling/src/enterprise-generated-manifest.ts',
  'tooling/src/generate.ts',
  'tooling/src/harmony-bindings.ts',
  'tooling/src/harmony-monomorphize.ts',
  'tooling/src/harmony-platform-driver.ts',
  'tooling/src/model.ts',
  'tooling/src/platform-driver.ts',
  'tooling/src/source.ts',
  'tooling/src/test-contract.ts',
  'uni_modules/unix-openim-sdk/utssdk/app-harmony/libs/imsdk.har',
] as const

export type EnterpriseAuthority = 'public' | 'private'

export interface EnterpriseGeneratedManifestInput {
  authority: EnterpriseAuthority
  path: string
  sha256: string
  bytes: number
}

export interface EnterpriseGeneratedManifestOutput {
  path: string
  sha256: string
  bytes: number
}

export interface EnterpriseGeneratedManifest {
  schemaVersion: 2
  edition: 'enterprise'
  generator: 'tooling/src/enterprise-compose.ts#buildEnterpriseGeneratedOutputs'
  inputs: EnterpriseGeneratedManifestInput[]
  outputs: EnterpriseGeneratedManifestOutput[]
}

export interface EnterpriseDeletionRegenerationResult {
  outputCount: number
  deterministic: boolean
  repositoryIdentical: boolean
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function relativeProjectPath(root: string, path: string): string {
  const value = relative(resolve(root), resolve(path))
  assert(value.length > 0, `Generated output cannot be the project root: ${path}`)
  assert(!isAbsolute(value) && value !== '..' && !value.startsWith(`..${sep}`), `Generated output escapes project root: ${path}`)
  return value.split(sep).join('/')
}

function projectPath(root: string, path: string): string {
  assert(path.length > 0 && !isAbsolute(path), `Manifest path must be project-relative: ${path}`)
  const value = resolve(root, path.split('/').join(sep))
  relativeProjectPath(root, value)
  return value
}

function copyProjectFile(sourceRoot: string, destinationRoot: string, path: string): void {
  const destination = projectPath(destinationRoot, path)
  mkdirSync(dirname(destination), { recursive: true })
  copyFileSync(projectPath(sourceRoot, path), destination)
}

function authorityForInput(path: string): EnterpriseAuthority {
  return path.startsWith('contracts/base/') || path.includes('OpenIMDriverRuntime') || path.startsWith('tooling/')
    ? 'public'
    : 'private'
}

function authorityRoot(publicRoot: string, privateRoot: string, authority: EnterpriseAuthority): string {
  return authority === 'public' ? publicRoot : privateRoot
}

function readOutputBytes(root: string, paths: readonly string[]): Map<string, Buffer> {
  return new Map(paths.map((path) => [path, readFileSync(projectPath(root, path))]))
}

function assertSameBytes(expected: Map<string, Buffer>, actual: Map<string, Buffer>, label: string): void {
  assert(expected.size === actual.size, `${label} output count changed`)
  for (const [path, expectedBytes] of expected) {
    const actualBytes = actual.get(path)
    assert(actualBytes != null, `${label} is missing generated output: ${path}`)
    assert(expectedBytes.equals(actualBytes), `${label} generated different bytes: ${path}`)
  }
}

export function buildEnterpriseGeneratedManifest(
  publicRoot: string,
  privateRoot: string,
): EnterpriseGeneratedManifest {
  const inputs = ENTERPRISE_GENERATOR_AUTHORITY_INPUTS.map((path): EnterpriseGeneratedManifestInput => {
    const authority = authorityForInput(path)
    const bytes = readFileSync(projectPath(authorityRoot(publicRoot, privateRoot, authority), path))
    return { authority, path, sha256: sha256(bytes), bytes: bytes.byteLength }
  })
  const paths = new Set<string>()
  const outputs = buildEnterpriseGeneratedOutputs(publicRoot, privateRoot).map((output) => {
    const path = relativeProjectPath(privateRoot, output.path)
    assert(!paths.has(path), `Duplicate Enterprise generated output: ${path}`)
    paths.add(path)
    const bytes = Buffer.from(output.content)
    return { path, sha256: sha256(bytes), bytes: bytes.byteLength }
  })
  return {
    schemaVersion: 2,
    edition: 'enterprise',
    generator: 'tooling/src/enterprise-compose.ts#buildEnterpriseGeneratedOutputs',
    inputs,
    outputs,
  }
}

export function writeEnterpriseGeneratedManifest(
  publicRoot: string,
  privateRoot: string,
): EnterpriseGeneratedManifest {
  const manifest = buildEnterpriseGeneratedManifest(publicRoot, privateRoot)
  const path = projectPath(privateRoot, ENTERPRISE_GENERATED_MANIFEST_PATH)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

export function readEnterpriseGeneratedManifest(privateRoot: string): EnterpriseGeneratedManifest {
  const manifest = JSON.parse(
    readFileSync(projectPath(privateRoot, ENTERPRISE_GENERATED_MANIFEST_PATH), 'utf8'),
  ) as EnterpriseGeneratedManifest
  assert(manifest.schemaVersion === 2, 'Unsupported Enterprise generated manifest schema')
  assert(manifest.edition === 'enterprise', 'Enterprise generated manifest edition changed')
  assert(
    manifest.generator === 'tooling/src/enterprise-compose.ts#buildEnterpriseGeneratedOutputs',
    'Unknown Enterprise generated manifest producer',
  )
  assert(Array.isArray(manifest.inputs), 'Enterprise generated manifest inputs must be an array')
  assert(
    JSON.stringify(manifest.inputs.map(({ authority, path }) => ({ authority, path }))) === JSON.stringify(
      ENTERPRISE_GENERATOR_AUTHORITY_INPUTS.map((path) => ({ authority: authorityForInput(path), path })),
    ),
    'Enterprise generated manifest authority input inventory changed',
  )
  const paths = new Set<string>()
  for (const input of manifest.inputs) {
    projectPath(authorityRoot(privateRoot, privateRoot, input.authority), input.path)
    const key = `${input.authority}:${input.path}`
    assert(!paths.has(key), `Duplicate Enterprise manifest input path: ${key}`)
    paths.add(key)
    assert(/^[0-9a-f]{64}$/.test(input.sha256), `Invalid Enterprise input hash: ${key}`)
    assert(Number.isSafeInteger(input.bytes) && input.bytes >= 0, `Invalid Enterprise input byte count: ${key}`)
  }
  for (const output of manifest.outputs) {
    projectPath(privateRoot, output.path)
    assert(!paths.has(output.path), `Duplicate Enterprise manifest path: ${output.path}`)
    paths.add(output.path)
    assert(/^[0-9a-f]{64}$/.test(output.sha256), `Invalid Enterprise generated hash: ${output.path}`)
    assert(Number.isSafeInteger(output.bytes) && output.bytes >= 0, `Invalid Enterprise generated byte count: ${output.path}`)
  }
  return manifest
}

export function assertEnterpriseGeneratedManifestCurrent(
  publicRoot: string,
  privateRoot: string,
): EnterpriseGeneratedManifest {
  const actual = readEnterpriseGeneratedManifest(privateRoot)
  const expected = buildEnterpriseGeneratedManifest(publicRoot, privateRoot)
  assert(JSON.stringify(actual) === JSON.stringify(expected), 'Enterprise generated manifest is stale or incomplete')
  for (const input of actual.inputs) {
    const bytes = readFileSync(projectPath(authorityRoot(publicRoot, privateRoot, input.authority), input.path))
    assert(bytes.byteLength === input.bytes, `Enterprise authority input byte count is stale: ${input.path}`)
    assert(sha256(bytes) === input.sha256, `Enterprise authority input hash is stale: ${input.path}`)
  }
  for (const output of actual.outputs) {
    const bytes = readFileSync(projectPath(privateRoot, output.path))
    assert(bytes.byteLength === output.bytes, `Enterprise generated byte count is stale: ${output.path}`)
    assert(sha256(bytes) === output.sha256, `Enterprise generated output hash is stale: ${output.path}`)
  }
  return actual
}

export function verifyEnterpriseDeletionRegeneration(
  publicRoot: string,
  privateRoot: string,
): EnterpriseDeletionRegenerationResult {
  const manifest = assertEnterpriseGeneratedManifestCurrent(publicRoot, privateRoot)
  const paths = manifest.outputs.map((output) => output.path)
  const repositoryBytes = readOutputBytes(privateRoot, paths)
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'openim-enterprise-generated-deletion-'))
  try {
    for (const input of ENTERPRISE_GENERATOR_AUTHORITY_INPUTS) {
      const sourceRoot = authorityRoot(publicRoot, privateRoot, authorityForInput(input))
      copyProjectFile(sourceRoot, temporaryRoot, input)
    }
    generateEnterprise(temporaryRoot, temporaryRoot)
    const firstBytes = readOutputBytes(temporaryRoot, paths)
    assertSameBytes(repositoryBytes, firstBytes, 'First Enterprise clean regeneration')
    for (const output of paths) rmSync(projectPath(temporaryRoot, output), { force: true })
    generateEnterprise(temporaryRoot, temporaryRoot)
    const secondBytes = readOutputBytes(temporaryRoot, paths)
    assertSameBytes(firstBytes, secondBytes, 'Second Enterprise clean regeneration')
    assertSameBytes(repositoryBytes, secondBytes, 'Enterprise repository comparison')
    return { outputCount: paths.length, deterministic: true, repositoryIdentical: true }
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
}
