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
import { buildGeneratedOutputs, generate } from './generate.js'
import { sha256 } from './source.js'

export const GENERATED_MANIFEST_PATH = 'contracts/base/generated-manifest.json'

export const PUBLIC_GENERATOR_AUTHORITY_INPUTS = [
  'contracts/base/contract.json',
  'sdk-src/uts/app-android/index.template.uts',
  'sdk-src/uts/app-ios/index.template.uts',
  'sdk-src/uts/app-android/events.prelude.uts',
  'sdk-src/uts/app-ios/events.prelude.uts',
  'sdk-src/native/android/OpenIMDriverRuntime.kt',
  'sdk-src/native/ios/OpenIMDriverRuntime.swift',
  'tooling/src/contract-integrity.ts',
  'tooling/src/generate.ts',
  'tooling/src/import-contract.ts',
  'tooling/src/model.ts',
  'tooling/src/platform-driver.ts',
  'tooling/src/source.ts',
  'tooling/src/test-contract.ts',
] as const

export interface GeneratedManifestArtifact {
  path: string
  sha256: string
  bytes: number
}

export interface GeneratedManifest {
  schemaVersion: 2
  edition: 'public'
  generator: 'tooling/src/generate.ts#buildGeneratedOutputs'
  inputs: GeneratedManifestArtifact[]
  outputs: GeneratedManifestArtifact[]
}

export interface DeletionRegenerationResult {
  outputCount: number
  deterministic: boolean
  repositoryIdentical: boolean
}

export interface AuthorityRegenerationResult {
  outputCount: number
  deterministic: boolean
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function relativeProjectPath(root: string, path: string): string {
  const projectRoot = resolve(root)
  const value = relative(projectRoot, resolve(path))
  assert(value.length > 0, `Generated output cannot be the project root: ${path}`)
  assert(!isAbsolute(value) && value !== '..' && !value.startsWith(`..${sep}`), `Generated output escapes project root: ${path}`)
  return value.split(sep).join('/')
}

function projectPath(root: string, path: string): string {
  assert(path.length > 0 && !isAbsolute(path), `Manifest path must be project-relative: ${path}`)
  const normalized = path.split('/').join(sep)
  const resolved = resolve(root, normalized)
  relativeProjectPath(root, resolved)
  return resolved
}

function copyProjectFile(sourceRoot: string, destinationRoot: string, path: string): void {
  const source = projectPath(sourceRoot, path)
  const destination = projectPath(destinationRoot, path)
  mkdirSync(dirname(destination), { recursive: true })
  copyFileSync(source, destination)
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

export function buildGeneratedManifest(root: string): GeneratedManifest {
  const inputs = PUBLIC_GENERATOR_AUTHORITY_INPUTS.map((path): GeneratedManifestArtifact => {
    const bytes = readFileSync(projectPath(root, path))
    return { path, sha256: sha256(bytes), bytes: bytes.byteLength }
  })
  const outputs = buildGeneratedOutputs(root)
  const paths = new Set<string>()
  const entries = outputs.map((output): GeneratedManifestArtifact => {
    const path = relativeProjectPath(root, output.path)
    assert(!paths.has(path), `Duplicate generated output: ${path}`)
    paths.add(path)
    const bytes = Buffer.from(output.content)
    return { path, sha256: sha256(bytes), bytes: bytes.byteLength }
  })
  return {
    schemaVersion: 2,
    edition: 'public',
    generator: 'tooling/src/generate.ts#buildGeneratedOutputs',
    inputs,
    outputs: entries,
  }
}

export function writeGeneratedManifest(root: string): GeneratedManifest {
  const manifest = buildGeneratedManifest(root)
  const path = projectPath(root, GENERATED_MANIFEST_PATH)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

export function readGeneratedManifest(root: string): GeneratedManifest {
  const manifest = JSON.parse(readFileSync(projectPath(root, GENERATED_MANIFEST_PATH), 'utf8')) as GeneratedManifest
  assert(manifest.schemaVersion === 2, 'Unsupported generated manifest schema')
  assert(manifest.edition === 'public', 'Generated manifest must describe the public edition')
  assert(manifest.generator === 'tooling/src/generate.ts#buildGeneratedOutputs', 'Unknown generated manifest producer')
  assert(Array.isArray(manifest.inputs), 'Generated manifest inputs must be an array')
  assert(Array.isArray(manifest.outputs), 'Generated manifest outputs must be an array')
  assert(
    JSON.stringify(manifest.inputs.map((input) => input.path)) === JSON.stringify(PUBLIC_GENERATOR_AUTHORITY_INPUTS),
    'Generated manifest authority input inventory changed',
  )
  const paths = new Set<string>()
  for (const [kind, artifacts] of [['input', manifest.inputs], ['output', manifest.outputs]] as const) {
    for (const artifact of artifacts) {
      projectPath(root, artifact.path)
      const key = `${kind}:${artifact.path}`
      assert(!paths.has(key), `Duplicate generated manifest ${kind} path: ${artifact.path}`)
      paths.add(key)
      assert(/^[0-9a-f]{64}$/.test(artifact.sha256), `Invalid generated ${kind} hash: ${artifact.path}`)
      assert(Number.isSafeInteger(artifact.bytes) && artifact.bytes >= 0, `Invalid generated ${kind} byte count: ${artifact.path}`)
    }
  }
  return manifest
}

export function assertGeneratedManifestCurrent(root: string): GeneratedManifest {
  const actual = readGeneratedManifest(root)
  const expected = buildGeneratedManifest(root)
  assert(JSON.stringify(actual) === JSON.stringify(expected), 'Generated manifest is stale or incomplete')
  for (const input of actual.inputs) {
    const bytes = readFileSync(projectPath(root, input.path))
    assert(bytes.byteLength === input.bytes, `Generator authority input byte count is stale: ${input.path}`)
    assert(sha256(bytes) === input.sha256, `Generator authority input hash is stale: ${input.path}`)
  }
  for (const output of actual.outputs) {
    const bytes = readFileSync(projectPath(root, output.path))
    assert(bytes.byteLength === output.bytes, `Generated output byte count is stale: ${output.path}`)
    assert(sha256(bytes) === output.sha256, `Generated output hash is stale: ${output.path}`)
  }
  return actual
}

export function verifyDeletionRegeneration(root: string): DeletionRegenerationResult {
  const manifest = assertGeneratedManifestCurrent(root)
  const paths = manifest.outputs.map((output) => output.path)
  const repositoryBytes = readOutputBytes(root, paths)
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'openim-generated-deletion-'))

  try {
    for (const input of PUBLIC_GENERATOR_AUTHORITY_INPUTS) copyProjectFile(root, temporaryRoot, input)
    for (const output of paths) copyProjectFile(root, temporaryRoot, output)
    copyProjectFile(root, temporaryRoot, GENERATED_MANIFEST_PATH)

    for (const output of paths) rmSync(projectPath(temporaryRoot, output), { force: true })
    generate(temporaryRoot)
    const firstBytes = readOutputBytes(temporaryRoot, paths)
    assertSameBytes(repositoryBytes, firstBytes, 'First clean regeneration')

    for (const output of paths) rmSync(projectPath(temporaryRoot, output), { force: true })
    generate(temporaryRoot)
    const secondBytes = readOutputBytes(temporaryRoot, paths)
    assertSameBytes(firstBytes, secondBytes, 'Second clean regeneration')
    assertSameBytes(repositoryBytes, secondBytes, 'Repository comparison')

    return { outputCount: paths.length, deterministic: true, repositoryIdentical: true }
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
}

/**
 * Verifies the Public projection from authoritative inputs without comparing
 * it to uni_modules. Private worktrees intentionally commit an Enterprise
 * projection at those paths and verify that projection with its own manifest.
 */
export function verifyPublicAuthorityRegeneration(root: string): AuthorityRegenerationResult {
  const expectedOutputs = buildGeneratedOutputs(root)
  const paths = expectedOutputs.map((output) => relativeProjectPath(root, output.path))
  const expectedBytes = new Map(expectedOutputs.map((output, index) => [paths[index]!, Buffer.from(output.content)]))
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'openim-public-authority-'))
  try {
    for (const input of PUBLIC_GENERATOR_AUTHORITY_INPUTS) copyProjectFile(root, temporaryRoot, input)
    generate(temporaryRoot)
    const firstBytes = readOutputBytes(temporaryRoot, paths)
    assertSameBytes(expectedBytes, firstBytes, 'First Public authority regeneration')
    for (const output of paths) rmSync(projectPath(temporaryRoot, output), { force: true })
    generate(temporaryRoot)
    const secondBytes = readOutputBytes(temporaryRoot, paths)
    assertSameBytes(firstBytes, secondBytes, 'Second Public authority regeneration')
    return { outputCount: paths.length, deterministic: true }
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
}
