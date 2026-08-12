#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pluginRelativePath = 'uni_modules/unix-openim-sdk'
const pluginRoot = resolve(projectRoot, pluginRelativePath)
const normalizedEpochSeconds = 315532800
const forbiddenPathPattern = /(?:^|\/)(?:app-harmony|libs|Frameworks|node_modules|unpackage|\.hbuilderx)(?:\/|$)|\.(?:aar|har|jar|so|dylib|a|framework|xcframework|apk|ipa|log)$/i
const forbiddenTextPatterns = [
  /\/Users\/[A-Za-z0-9._-]+\//,
  /\/Volumes\/[A-Za-z0-9._-]+\//,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/,
  /\bBearer\s+[A-Za-z0-9._~-]{20,}\b/i,
]

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function git(args) {
  return execFileSync('git', args, { cwd: projectRoot, encoding: 'utf8' }).trim()
}

function parseArguments(argv) {
  let outputDir = resolve(projectRoot, 'dist/public-marketplace')
  let allowDirty = false
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--allow-dirty') {
      allowDirty = true
    } else if (argument === '--output-dir' && index + 1 < argv.length) {
      outputDir = resolve(argv[index + 1])
      index += 1
    } else {
      throw new Error(`Unknown marketplace package argument: ${argument}`)
    }
  }
  return { outputDir, allowDirty }
}

function packagePathAllowed(path, files) {
  return path === 'package.json' || files.some((entry) => path === entry || path.startsWith(`${entry}/`))
}

function packageFiles(files) {
  const paths = ['package.json']
  const visit = (relativePath) => {
    const absolutePath = resolve(pluginRoot, relativePath)
    const stat = statSync(absolutePath)
    if (stat.isFile()) {
      paths.push(relativePath)
      return
    }
    if (!stat.isDirectory()) throw new Error(`Marketplace entry is not a regular file or directory: ${relativePath}`)
    for (const child of readdirSync(absolutePath).sort((left, right) => left.localeCompare(right, 'en'))) {
      visit(`${relativePath}/${child}`)
    }
  }
  for (const entry of files) visit(entry)
  return [...new Set(paths)]
    .filter((path) => packagePathAllowed(path, files) && !forbiddenPathPattern.test(path))
    .sort((left, right) => left.localeCompare(right, 'en'))
}

function validatePluginPackage(pluginPackage, files) {
  if (pluginPackage.id !== 'unix-openim-sdk') throw new Error('Marketplace plugin id must remain unix-openim-sdk')
  if (typeof pluginPackage.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(pluginPackage.version)) {
    throw new Error(`Marketplace plugin version must be stable semver, got ${String(pluginPackage.version)}`)
  }
  if (pluginPackage.dcloudext?.type !== 'uts') throw new Error('Marketplace dcloudext.type must remain uts')
  const app = pluginPackage.uni_modules?.platforms?.client?.['uni-app-x']?.app
  if (app?.harmony !== 'x') throw new Error('Public marketplace package must declare HarmonyOS unsupported')
  if (app.android?.extVersion !== pluginPackage.version || app.ios?.extVersion !== pluginPackage.version) {
    throw new Error('Marketplace version and Android/iOS extVersion must match')
  }
  const requiredEntries = ['LICENSE', 'README.md', 'CHANGELOG.md', 'MARKET_USAGE.md', 'utssdk']
  if (JSON.stringify(files) !== JSON.stringify(requiredEntries)) {
    throw new Error(`Marketplace files allowlist must be exactly ${requiredEntries.join(', ')}`)
  }
}

function validateSourceFiles(paths) {
  for (const path of paths) {
    if (forbiddenPathPattern.test(path)) throw new Error(`Forbidden marketplace path: ${path}`)
    const absolutePath = resolve(pluginRoot, path)
    const stat = statSync(absolutePath)
    if (!stat.isFile()) throw new Error(`Marketplace entry is not a regular file: ${path}`)
    const bytes = readFileSync(absolutePath)
    if (bytes.includes(0)) continue
    const text = bytes.toString('utf8')
    for (const pattern of forbiddenTextPatterns) {
      if (pattern.test(text)) throw new Error(`Sensitive or machine-specific text found in marketplace path: ${path}`)
    }
  }
}

function copyNormalizedFiles(paths, stageRoot) {
  const epoch = new Date(normalizedEpochSeconds * 1000)
  return paths.map((path) => {
    const archivePath = `${pluginRelativePath}/${path}`
    const target = resolve(stageRoot, archivePath)
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(resolve(pluginRoot, path), target)
    chmodSync(target, 0o644)
    utimesSync(target, epoch, epoch)
    return archivePath
  })
}

function createArchive(stageRoot, archivePath, archiveEntries) {
  rmSync(archivePath, { force: true })
  execFileSync('zip', ['-X', '-q', archivePath, ...archiveEntries], {
    cwd: stageRoot,
    env: { ...process.env, TZ: 'UTC' },
  })
}

export function buildMarketplacePackage(options = {}) {
  const outputDir = resolve(options.outputDir ?? resolve(projectRoot, 'dist/public-marketplace'))
  const allowDirty = options.allowDirty === true
  const status = git(['status', '--porcelain=v1', '--untracked-files=all'])
  if (!allowDirty && status.length > 0) throw new Error('Marketplace package requires a clean Git worktree')

  const pluginPackage = JSON.parse(readFileSync(resolve(pluginRoot, 'package.json'), 'utf8'))
  const files = Array.isArray(pluginPackage.files) ? pluginPackage.files : []
  validatePluginPackage(pluginPackage, files)
  const sourceFiles = packageFiles(files)
  for (const required of ['package.json', 'LICENSE', 'README.md', 'CHANGELOG.md', 'MARKET_USAGE.md', 'utssdk/interface.uts', 'utssdk/unierror.uts']) {
    if (!sourceFiles.includes(required)) throw new Error(`Marketplace package is missing required file: ${required}`)
  }
  validateSourceFiles(sourceFiles)

  mkdirSync(outputDir, { recursive: true })
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'openim-public-marketplace-'))
  try {
    const stageRoot = resolve(temporaryRoot, 'stage')
    mkdirSync(stageRoot, { recursive: true })
    const archiveEntries = copyNormalizedFiles(sourceFiles, stageRoot)
    const archiveName = `unix-openim-sdk-${pluginPackage.version}-marketplace.zip`
    const archivePath = resolve(outputDir, archiveName)
    createArchive(stageRoot, archivePath, archiveEntries)

    const listedEntries = execFileSync('unzip', ['-Z1', archivePath], { encoding: 'utf8' }).trim().split('\n').filter(Boolean)
    if (JSON.stringify(listedEntries) !== JSON.stringify(archiveEntries)) {
      throw new Error('Marketplace archive entries differ from the deterministic allowlist')
    }

    const manifest = {
      schemaVersion: 1,
      pluginID: pluginPackage.id,
      version: pluginPackage.version,
      repository: pluginPackage.repository,
      gitRevision: git(['rev-parse', 'HEAD']),
      dirty: status.length > 0,
      sourceDateEpoch: normalizedEpochSeconds,
      nativeDependencies: {
        android: 'io.openim:core-sdk:3.8.3-patch15',
        ios: 'OpenIMSDKCore:3.8.3-hotfix.15-dynamic.1',
      },
      archive: {
        fileName: archiveName,
        sha256: sha256(readFileSync(archivePath)),
        size: statSync(archivePath).size,
      },
      files: sourceFiles.map((path) => {
        const bytes = readFileSync(resolve(pluginRoot, path))
        return { path, sha256: sha256(bytes), size: bytes.length }
      }),
    }
    const manifestName = `unix-openim-sdk-${pluginPackage.version}-marketplace-manifest.json`
    const manifestPath = resolve(outputDir, manifestName)
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    const sumsPath = resolve(outputDir, 'SHA256SUMS')
    writeFileSync(sumsPath, `${manifest.archive.sha256}  ${archiveName}\n${sha256(readFileSync(manifestPath))}  ${manifestName}\n`)
    return { archivePath, manifestPath, sumsPath, manifest }
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
}

if (process.argv[1] != null && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = buildMarketplacePackage(parseArguments(process.argv.slice(2)))
    console.log(`Marketplace archive: ${result.archivePath}`)
    console.log(`Marketplace SHA-256: ${result.manifest.archive.sha256}`)
    console.log(`Marketplace manifest: ${result.manifestPath}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
