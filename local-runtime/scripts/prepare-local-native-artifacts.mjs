#!/usr/bin/env node

import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const localRuntimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const projectRoot = resolve(localRuntimeRoot, '..')

export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}
export function sha256Directory(path) {
  const files = []
  const walk = (directory) => {
    for (const name of readdirSync(directory).sort()) {
      const entry = join(directory, name)
      if (statSync(entry).isDirectory()) walk(entry)
      else files.push(entry)
    }
  }
  walk(path)
  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(relative(path, file))
    hash.update('\0')
    hash.update(readFileSync(file))
    hash.update('\0')
  }
  return hash.digest('hex')
}

function readLock(root) {
  return JSON.parse(readFileSync(resolve(root, 'toolchain.lock.json'), 'utf8'))
}

function validAndroid(path, expected) {
  return existsSync(path) && statSync(path).isFile() && sha256File(path) === expected
}

function validIOS(path, expected) {
  return existsSync(path) && statSync(path).isDirectory() && sha256Directory(path) === expected
}

function resolveCoreRoot(root, source, environment) {
  const explicit = environment[source.rootEnvironmentVariable]
  if (explicit) return resolve(explicit)
  for (const sibling of source.siblingDirectories) {
    const candidate = resolve(root, '..', sibling)
    if (existsSync(candidate)) return candidate
  }
  return ''
}

function copyVerifiedAndroid({ root, lock, environment }) {
  const target = resolve(root, lock.localOverridePath)
  if (validAndroid(target, lock.sha256)) return { path: target, sha256: lock.sha256, reused: true }

  const coreRoot = resolveCoreRoot(root, environment.source, environment.values)
  const source = environment.values.OPENIM_PUBLIC_ANDROID_AAR
    ? resolve(environment.values.OPENIM_PUBLIC_ANDROID_AAR)
    : resolve(coreRoot, lock.sourcePath)
  if (!validAndroid(source, lock.sha256)) {
    throw new Error(`Locked Public Android AAR is unavailable or stale: ${source}`)
  }
  mkdirSync(dirname(target), { recursive: true })
  cpSync(source, target)
  if (!validAndroid(target, lock.sha256)) throw new Error(`Copied Public Android AAR failed verification: ${target}`)
  return { path: target, sha256: lock.sha256, reused: false }
}

function extractedXCFrameworkFromZip(zipPath) {
  const directory = mkdtempSync(join(tmpdir(), 'openim-public-xcframework-'))
  execFileSync('ditto', ['-x', '-k', zipPath, directory])
  const direct = resolve(directory, 'OpenIMCore.xcframework')
  if (existsSync(direct)) return { directory, source: direct }
  const nested = readdirSync(directory)
    .map((name) => resolve(directory, name, 'OpenIMCore.xcframework'))
    .find((path) => existsSync(path))
  if (!nested) {
    rmSync(directory, { recursive: true, force: true })
    throw new Error(`OpenIMCore.xcframework is absent from ${zipPath}`)
  }
  return { directory, source: nested }
}

function copyVerifiedIOS({ root, lock, environment }) {
  const target = resolve(root, lock.localOverridePath)
  if (validIOS(target, lock.localOverrideInventorySha256)) {
    return { path: target, inventorySha256: lock.localOverrideInventorySha256, reused: true }
  }

  const coreRoot = resolveCoreRoot(root, environment.source, environment.values)
  const explicit = environment.values.OPENIM_PUBLIC_IOS_XCFRAMEWORK
  const sourcePath = explicit
    ? resolve(explicit)
    : resolve(coreRoot, lock.sourcePath.replace(/\.zip$/, ''))
  let source = sourcePath
  let temporary = ''
  if (!existsSync(source)) {
    const zipPath = resolve(coreRoot, lock.sourcePath)
    if (!existsSync(zipPath) || sha256File(zipPath) !== lock.zipSha256) {
      throw new Error(`Locked Public iOS XCFramework is unavailable: ${sourcePath}`)
    }
    const extracted = extractedXCFrameworkFromZip(zipPath)
    temporary = extracted.directory
    source = extracted.source
  }

  try {
    if (!validIOS(source, lock.localOverrideInventorySha256)) {
      throw new Error(`Locked Public iOS XCFramework inventory mismatch: ${source}`)
    }
    mkdirSync(dirname(target), { recursive: true })
    rmSync(target, { recursive: true, force: true })
    cpSync(source, target, { recursive: true, force: true, preserveTimestamps: true })
    if (!validIOS(target, lock.localOverrideInventorySha256)) {
      throw new Error(`Copied Public iOS XCFramework failed verification: ${target}`)
    }
  } finally {
    if (temporary) rmSync(temporary, { recursive: true, force: true })
  }
  return { path: target, inventorySha256: lock.localOverrideInventorySha256, reused: false }
}

export function prepareLocalNativeArtifacts({ root = projectRoot, platforms = ['android', 'ios'], environment = process.env } = {}) {
  const lock = readLock(root)
  const context = { source: lock.publicNative.source, values: environment }
  const result = {}
  if (platforms.includes('android')) {
    result.android = copyVerifiedAndroid({ root, lock: lock.publicNative.android, environment: context })
  }
  if (platforms.includes('ios')) {
    result.ios = copyVerifiedIOS({ root, lock: lock.publicNative.ios, environment: context })
  }
  return result
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const requested = process.argv.slice(2)
  const platforms = requested.length === 0 || requested.includes('all') ? ['android', 'ios'] : requested
  for (const platform of platforms) {
    if (platform !== 'android' && platform !== 'ios') throw new Error(`Unsupported platform: ${platform}`)
  }
  process.stdout.write(`${JSON.stringify(prepareLocalNativeArtifacts({ platforms }), null, 2)}\n`)
}
