import { execFileSync, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  cpSync,
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import { traditionalUniAppFixtureFiles } from './uniapp-consumer-compile.js'
import { scanReleaseSecrets } from './release-integrity.js'
import { resolveUniToolchainProfile, type UniToolchainProfileV2 } from './uni-toolchain.js'

export type LocalSurface = 'uniapp-vue2' | 'uniapp-vue3' | 'uniappx'
export type LocalPlatform = 'android' | 'ios'
export type LocalCommand = 'doctor' | 'prepare' | 'build' | 'run' | 'test'
export type LocalMatrixTier = 'pr' | 'nightly' | 'rc'
export type LocalEvidenceState = 'NOT_RUN' | 'COMPILE_PASS' | 'ASSEMBLE_PASS' | 'SMOKE_PASS' | 'FULL_PASS' | 'BLOCKED'

export interface LocalProductPlugin {
  id: string
  source: string
  dependencies?: string[]
  androidNamespace?: string
  androidGradleTemplate?: string
}

export interface LocalAndroidHostOptions {
  minSdk?: number
  abiFilters?: string[]
  dcloudLibraries?: string[]
  utsRegisterComponents?: Array<Record<string, string>>
  utsEasyCom?: Array<Record<string, string>>
}

export interface LocalIOSHostOptions {
  deploymentTarget?: string
  requiredFrameworks?: string[]
  uniappxRequiredFrameworks?: string[]
}

export interface LocalHostPreparation {
  script: string
  surfaces?: LocalSurface[]
}

export interface LocalAutomationAsset {
  source: string
  destination: string
  surfaces?: LocalSurface[]
  sourceEnvironment?: string
}

export interface LocalNativeArtifact {
  id: string
  path: string
}

export interface LocalProductDescriptor {
  schemaVersion: 1
  id: string
  displayName: string
  repositoryRoot: string
  uniappxSource: string
  surfaceSources?: Partial<Record<LocalSurface, string>>
  plugins: LocalProductPlugin[]
  automationAssets?: LocalAutomationAsset[]
  nativeArtifacts?: LocalNativeArtifact[]
  androidHost?: LocalAndroidHostOptions
  iosHost?: LocalIOSHostOptions
  hostPreparation?: Partial<Record<LocalPlatform, LocalHostPreparation>>
  classicVideo?: boolean
  classicAndroidLibraries?: string[]
  applicationIDs: Record<LocalSurface, string>
  dcloudAppIDs: Record<LocalSurface, string>
}

export interface ResolvedLocalProductDescriptor extends Omit<LocalProductDescriptor, 'repositoryRoot' | 'uniappxSource' | 'surfaceSources' | 'plugins' | 'automationAssets' | 'nativeArtifacts' | 'hostPreparation'> {
  descriptorPath: string
  repositoryRoot: string
  uniappxSource: string
  surfaceSources: Partial<Record<LocalSurface, string>>
  plugins: Array<{ id: string; source: string; dependencies?: string[]; androidNamespace?: string; androidGradleTemplate?: string }>
  automationAssets: Array<{ source: string; destination: string; surfaces?: LocalSurface[]; sourceEnvironment?: string }>
  nativeArtifacts: Array<{ id: string; path: string }>
  hostPreparation: Partial<Record<LocalPlatform, LocalHostPreparation>>
}

export interface RuntimeLockDocument {
  schemaVersion: 1
  pid: number
  runID: string
  product: string
  surface: LocalSurface
  platform: LocalPlatform
  deviceID: string | null
  startedAt: string
}

export interface LocalEvidenceV1 {
  schema: 'io.openim.uni.local-runtime-evidence/v1'
  runID: string
  state: LocalEvidenceState
  cloudPackaging: false
  startedAt: string
  finishedAt: string
  source: { revision: string; dirty: boolean }
  runner: { revision: string; dirty: boolean }
  product: string
  surface: LocalSurface
  platform: LocalPlatform
  suite: string
  profile: { id: string; path: string; sdkArchiveSha256: string }
  artifacts: Record<string, string>
  nativeArtifacts: Record<string, string>
  device: { id: string | null; os: string | null; architecture: string | null }
  redactions: { tokensPersisted: false; credentialsPersisted: false; serverAddressPersisted: false }
  error?: { stage: string; type: string }
}

export interface LocalRuntimeOptions {
  command: LocalCommand
  descriptorPath: string
  surface: LocalSurface
  platform: LocalPlatform
  suite: string
  deviceID?: string
  workspaceRoot?: string
  profilePath?: string
  runID?: string
}

const surfaces: readonly LocalSurface[] = ['uniapp-vue2', 'uniapp-vue3', 'uniappx']
const platforms: readonly LocalPlatform[] = ['android', 'ios']
const runnerRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function assertSafeIdentifier(value: string, label: string): void {
  assert(/^[a-z0-9][a-z0-9-]*$/.test(value), `${label} is not safe: ${value}`)
}

function assertSurface(value: string): asserts value is LocalSurface {
  assert(surfaces.includes(value as LocalSurface), `Unsupported surface: ${value}`)
}

function assertPlatform(value: string): asserts value is LocalPlatform {
  assert(platforms.includes(value as LocalPlatform), `Unsupported platform: ${value}`)
}

export function dcloudAppKeyEnvironmentName(surface: Exclude<LocalSurface, 'uniappx'>, platform: LocalPlatform): string {
  return `OPENIM_DCLOUD_APP_KEY_${platform.toUpperCase()}_${surface.replaceAll('-', '_').toUpperCase()}`
}

function genericDCloudAppKeyEnvironmentName(platform: LocalPlatform): string {
  return `OPENIM_DCLOUD_APP_KEY_${platform.toUpperCase()}`
}

function resolveDCloudAppKey(surface: LocalSurface, platform: LocalPlatform): string | null {
  if (surface === 'uniappx') return null
  const specific = process.env[dcloudAppKeyEnvironmentName(surface, platform)]
  if (specific != null && specific !== '') return specific
  const generic = process.env[genericDCloudAppKeyEnvironmentName(platform)]
  return generic != null && generic !== '' ? generic : null
}

function stripJSONComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function sha256(path: string): string {
  const digest = createHash('sha256')
  const descriptor = openSync(path, 'r')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  try {
    while (true) {
      const count = readSync(descriptor, buffer, 0, buffer.length, null)
      if (count === 0) break
      digest.update(buffer.subarray(0, count))
    }
  } finally {
    closeSync(descriptor)
  }
  return digest.digest('hex')
}

function git(repository: string, args: string[]): string {
  return execFileSync('git', ['-C', repository, ...args], { encoding: 'utf8' }).trim()
}

function sourceIdentity(repository: string): { revision: string; dirty: boolean } {
  return { revision: git(repository, ['rev-parse', 'HEAD']), dirty: git(repository, ['status', '--porcelain=v1', '--untracked-files=all']) !== '' }
}

function resolveDescriptorRelative(descriptorPath: string, value: string): string {
  const expanded = value.replace(/\$\{([A-Z0-9_]+)\}/g, (_match, name: string) => {
    const replacement = process.env[name]
    assert(replacement != null && replacement !== '', `Missing descriptor environment variable ${name}`)
    return replacement
  })
  return realpathSync(resolve(dirname(descriptorPath), expanded))
}

export function resolveProductDescriptor(path: string): ResolvedLocalProductDescriptor {
  const descriptorPath = realpathSync(resolve(path))
  const document = JSON.parse(readFileSync(descriptorPath, 'utf8')) as LocalProductDescriptor
  assert(document.schemaVersion === 1, 'Unsupported local product descriptor schema')
  assertSafeIdentifier(document.id, 'product id')
  for (const surface of surfaces) {
    assert(document.applicationIDs[surface]?.startsWith('io.openim.local.'), `Missing local application ID for ${surface}`)
    assert(document.dcloudAppIDs[surface]?.startsWith('__UNI__'), `Missing DCloud AppID for ${surface}`)
  }
  return {
    ...document,
    descriptorPath,
    repositoryRoot: resolveDescriptorRelative(descriptorPath, document.repositoryRoot),
    uniappxSource: resolveDescriptorRelative(descriptorPath, document.uniappxSource),
    surfaceSources: Object.fromEntries(Object.entries(document.surfaceSources ?? {}).map(([surface, source]) => [surface, resolveDescriptorRelative(descriptorPath, source)])),
    plugins: document.plugins.map((plugin) => ({
      id: plugin.id,
      source: resolveDescriptorRelative(descriptorPath, plugin.source),
      ...(plugin.dependencies != null ? { dependencies: plugin.dependencies } : {}),
      ...(plugin.androidNamespace != null ? { androidNamespace: plugin.androidNamespace } : {}),
      ...(plugin.androidGradleTemplate != null ? { androidGradleTemplate: resolveDescriptorRelative(descriptorPath, plugin.androidGradleTemplate) } : {}),
    })),
    automationAssets: (document.automationAssets ?? []).map((asset) => ({
      source: resolveDescriptorRelative(descriptorPath, asset.source),
      destination: asset.destination,
      ...(asset.surfaces != null ? { surfaces: asset.surfaces } : {}),
      ...(asset.sourceEnvironment != null ? { sourceEnvironment: asset.sourceEnvironment } : {}),
    })),
    nativeArtifacts: (document.nativeArtifacts ?? []).map((artifact) => ({ id: artifact.id, path: resolveDescriptorRelative(descriptorPath, artifact.path) })),
    hostPreparation: Object.fromEntries(Object.entries(document.hostPreparation ?? {}).map(([platform, preparation]) => [platform, {
      ...preparation,
      script: resolveDescriptorRelative(descriptorPath, preparation.script),
    }])),
  }
}

function ensureInside(root: string, target: string): void {
  const prefix = `${resolve(root)}${sep}`
  const resolved = resolve(target)
  assert(resolved.startsWith(prefix), `Refusing to operate outside local runtime root: ${resolved}`)
}

function isForbiddenStagingPath(path: string): boolean {
  const segments = path.split(/[\\/]+/).filter((segment) => segment !== '' && segment !== '.')
  const basename = segments.at(-1)?.toLowerCase() ?? ''
  if (segments.some((segment) => segment === '.runs' || segment.toLowerCase() === 'test-results' || segment.toLowerCase() === 'local-config')) return true
  if (basename === 'openim-test-config.json' || basename === '.openim-test-accounts.json' || basename === 'env.js') return true
  return /^local-config\.(?:js|json|ts|uts)$/i.test(basename)
}

function copyIntoStaging(source: string, destination: string, stagingRoot: string): void {
  cpSync(source, destination, {
    recursive: true,
    dereference: false,
    filter: (_source, target) => !isForbiddenStagingPath(relative(stagingRoot, target)),
  })
}

interface StagingSafetyFinding {
  path: string
  rule: string
}

function readStagingText(path: string): string | null {
  const content = readFileSync(path)
  const prefix = content.subarray(0, Math.min(content.length, 8192))
  if (prefix.includes(0)) return null
  return content.toString('utf8')
}

function containsConcreteServerAddress(content: string): boolean {
  const assignment = /\b(?:api_?(?:addr|address|url|base)|ws_?(?:addr|address|url|base)|server_?(?:addr|address|url)|endpoint|meeting_?(?:api_?)?url)\b["']?\s*[:=]\s*["'`]([^"'`\r\n]+)["'`]/gi
  for (const match of content.matchAll(assignment)) {
    const value = (match[1] ?? '').trim()
    if (value === '' || value.includes('<') || value.includes('${')) continue
    let hostname = ''
    try {
      const url = new URL(value)
      if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) continue
      hostname = url.hostname.toLowerCase()
    } catch {
      const host = value.match(/^(?:[a-z][a-z0-9+.-]*:\/\/)?([^/:\s]+)(?::\d+)?(?:\/|$)/i)?.[1]
      if (host == null) continue
      if (!/^(?:(?:\d{1,3}\.){3}\d{1,3}|(?:[a-z0-9-]+\.)+[a-z]{2,})$/i.test(host)) continue
      hostname = host.toLowerCase()
    }
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0' || hostname === '::1') continue
    if (hostname === 'example.com' || hostname.endsWith('.example') || hostname.endsWith('.invalid') || hostname.endsWith('.test')) continue
    return true
  }
  return false
}

function runtimeEnvironmentSecrets(): string[] {
  const sensitiveName = /^(?:OPENIM|IM|DCLOUD)_[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|CREDENTIAL|API_KEY|APP_KEY)$/
  return [...new Set(Object.entries(process.env)
    .filter(([name, value]) => sensitiveName.test(name) && value != null && value.length >= 8)
    .map(([, value]) => value as string))]
}

function isRuntimeConfigurationSource(path: string): boolean {
  return /\.(?:json|js|cjs|mjs|ts|uts|vue|uvue|xml|plist|properties|gradle|sh|rb|java|kt|swift|h|m|mm)$/i.test(path)
}

export function assertLocalRuntimeStagingSafe(root: string): void {
  const findings: StagingSafetyFinding[] = []
  const environmentSecrets = runtimeEnvironmentSecrets()
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      const relativePath = relative(root, path).split(sep).join('/')
      if (isForbiddenStagingPath(relativePath)) {
        findings.push({ path: relativePath, rule: 'machine-local-state' })
        continue
      }
      if (entry.isDirectory()) {
        visit(path)
        continue
      }
      if (!entry.isFile()) continue
      const content = readStagingText(path)
      if (content == null) continue
      for (const finding of scanReleaseSecrets([{ path: relativePath, content }], []).findings) {
        findings.push({ path: finding.path, rule: finding.rule })
      }
      if (environmentSecrets.some((secret) => content.includes(secret))) findings.push({ path: relativePath, rule: 'environment-secret' })
      if (isRuntimeConfigurationSource(relativePath) && containsConcreteServerAddress(content)) {
        findings.push({ path: relativePath, rule: 'server-address' })
      }
    }
  }
  visit(root)
  findings.sort((left, right) => left.path.localeCompare(right.path) || left.rule.localeCompare(right.rule))
  assert(findings.length === 0, `Unsafe local runtime staging content:\n${findings.map((finding) => `${finding.path}: ${finding.rule}`).join('\n')}`)
}

function copyUniAppXSource(source: string, target: string): void {
  const entries = ['App.uvue', 'main.uts', 'manifest.json', 'pages.json', 'pages', 'static', 'uni.scss']
  for (const name of entries) {
    const input = join(source, name)
    if (existsSync(input)) copyIntoStaging(input, join(target, name), target)
  }
}

function copySurfaceSource(source: string, target: string, surface: LocalSurface): void {
  const entries = surface === 'uniappx'
    ? ['App.uvue', 'main.uts', 'manifest.json', 'pages.json', 'pages', 'static', 'uni.scss']
    : ['App.vue', 'main.js', 'manifest.json', 'pages.json', 'pages', 'static', 'uni.scss']
  for (const name of entries) {
    const input = join(source, name)
    if (existsSync(input)) copyIntoStaging(input, join(target, name), target)
  }
}

function writeTraditionalFixture(target: string, surface: Exclude<LocalSurface, 'uniappx'>): void {
  const vue = surface === 'uniapp-vue2' ? '2' : '3'
  const fixture = traditionalUniAppFixtureFiles(vue)
  mkdirSync(join(target, 'pages/index'), { recursive: true })
  writeFileSync(join(target, 'manifest.json'), fixture.manifest)
  writeFileSync(join(target, 'pages.json'), fixture.pages)
  writeFileSync(join(target, 'App.vue'), fixture.app)
  writeFileSync(join(target, 'main.js'), fixture.main)
  writeFileSync(join(target, 'sdk-probe.js'), fixture.probe)
  writeFileSync(join(target, 'pages/index/index.vue'), fixture.page)
}

function overlayManifest(target: string, descriptor: ResolvedLocalProductDescriptor, surface: LocalSurface): void {
  const path = join(target, 'manifest.json')
  const manifest = JSON.parse(stripJSONComments(readFileSync(path, 'utf8'))) as Record<string, unknown>
  manifest.name = `openim-${descriptor.id}-${surface}`
  manifest.appid = descriptor.dcloudAppIDs[surface]
  manifest.versionName = '1.0.0'
  manifest.versionCode = '100'
  manifest.vueVersion = surface === 'uniapp-vue2' ? '2' : '3'
  const android = (manifest['app-android'] ?? {}) as Record<string, unknown>
  android.packageName = descriptor.applicationIDs[surface]
  const androidDistribute = (android.distribute ?? {}) as Record<string, unknown>
  const androidModules = (androidDistribute.modules ?? {}) as Record<string, unknown>
  androidModules['uni-websocket'] = {}
  androidDistribute.modules = androidModules
  android.distribute = androidDistribute
  manifest['app-android'] = android
  const ios = (manifest['app-ios'] ?? {}) as Record<string, unknown>
  ios.bundleIdentifier = descriptor.applicationIDs[surface]
  const iosDistribute = (ios.distribute ?? {}) as Record<string, unknown>
  const iosModules = (iosDistribute.modules ?? {}) as Record<string, unknown>
  iosModules['uni-websocket'] = {}
  iosDistribute.modules = iosModules
  ios.distribute = iosDistribute
  manifest['app-ios'] = ios
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`)
}

function writeStageMetadata(target: string, descriptor: ResolvedLocalProductDescriptor, surface: LocalSurface): void {
  const identity = sourceIdentity(descriptor.repositoryRoot)
  writeFileSync(join(target, '.openim-local-runtime.json'), `${JSON.stringify({ schemaVersion: 1, product: descriptor.id, surface, source: identity }, null, 2)}\n`)
}

function copyAutomationAssets(target: string, descriptor: ResolvedLocalProductDescriptor, surface: LocalSurface): void {
  for (const asset of descriptor.automationAssets) {
    if (asset.surfaces != null && !asset.surfaces.includes(surface)) continue
    assert(!asset.destination.startsWith('/') && !asset.destination.split('/').includes('..'), `Unsafe automation asset destination: ${asset.destination}`)
    if (asset.sourceEnvironment != null) {
      assert(/^[A-Z][A-Z0-9_]*$/.test(asset.sourceEnvironment), `Unsafe automation asset source environment: ${asset.sourceEnvironment}`)
    }
    assert(!isForbiddenStagingPath(asset.destination), `Automation asset destination is machine-local runtime state: ${asset.destination}`)
    const configuredSource = asset.sourceEnvironment == null ? null : process.env[asset.sourceEnvironment]
    const source = configuredSource == null || configuredSource === '' ? asset.source : realpathSync(resolve(configuredSource))
    const destination = join(target, asset.destination)
    ensureInside(target, destination)
    mkdirSync(dirname(destination), { recursive: true })
    copyIntoStaging(source, destination, target)
  }
}

function artifactDigest(path: string): string {
  if (statSync(path).isFile()) return sha256(path)
  const digest = createHash('sha256')
  const visit = (directory: string): void => {
    for (const name of readdirSync(directory).sort()) {
      const item = join(directory, name)
      const relativePath = relative(path, item).split(sep).join('/')
      const stat = statSync(item)
      if (stat.isDirectory()) {
        digest.update(`D\0${relativePath}\0`)
        visit(item)
      } else if (stat.isFile()) {
        digest.update(`F\0${relativePath}\0${stat.size}\0${sha256(item)}\0`)
      }
    }
  }
  visit(path)
  return digest.digest('hex')
}

export function prepareStableProject(descriptor: ResolvedLocalProductDescriptor, surface: LocalSurface, workspaceRoot: string): string {
  const productRoot = join(resolve(workspaceRoot), descriptor.id)
  const target = join(productRoot, surface)
  ensureInside(workspaceRoot, target)
  mkdirSync(productRoot, { recursive: true })
  const staging = mkdtempSync(join(productRoot, `.${surface}.staging-`))
  const backup = join(productRoot, `.${surface}.backup-${process.pid}-${randomUUID()}`)
  try {
    const surfaceSource = descriptor.surfaceSources[surface]
    if (surfaceSource != null) copySurfaceSource(surfaceSource, staging, surface)
    else if (surface === 'uniappx') copyUniAppXSource(descriptor.uniappxSource, staging)
    else writeTraditionalFixture(staging, surface)
    copyAutomationAssets(staging, descriptor, surface)
    mkdirSync(join(staging, 'uni_modules'), { recursive: true })
    for (const plugin of descriptor.plugins) copyIntoStaging(plugin.source, join(staging, 'uni_modules', plugin.id), staging)
    overlayManifest(staging, descriptor, surface)
    writeStageMetadata(staging, descriptor, surface)
    assertLocalRuntimeStagingSafe(staging)
    if (existsSync(target)) renameSync(target, backup)
    renameSync(staging, target)
    rmSync(backup, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    return target
  } catch (error) {
    rmSync(staging, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    if (existsSync(backup) && !existsSync(target)) renameSync(backup, target)
    throw error
  }
}

function isPIDRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export class LocalRuntimeLock {
  readonly path: string
  readonly document: RuntimeLockDocument

  constructor(root: string, document: RuntimeLockDocument) {
    mkdirSync(root, { recursive: true })
    this.path = join(root, 'global.lock.json')
    this.document = document
    if (existsSync(this.path)) {
      const existing = JSON.parse(readFileSync(this.path, 'utf8')) as RuntimeLockDocument
      if (isPIDRunning(existing.pid)) throw new Error(`Local runtime is already locked by PID ${existing.pid}, run ${existing.runID}`)
      rmSync(this.path)
    }
    const descriptor = openSync(this.path, 'wx', 0o600)
    try {
      writeFileSync(descriptor, `${JSON.stringify(document, null, 2)}\n`)
    } finally {
      closeSync(descriptor)
    }
  }

  release(): void {
    if (!existsSync(this.path)) return
    const existing = JSON.parse(readFileSync(this.path, 'utf8')) as RuntimeLockDocument
    if (existing.runID === this.document.runID && existing.pid === this.document.pid) rmSync(this.path)
  }
}

function detectDevice(platform: LocalPlatform, requested?: string): { id: string | null; os: string | null; architecture: string | null } {
  if (platform === 'android') {
    const adb = process.env.OPENIM_ADB_BIN ?? join(process.env.HOME ?? '', 'Library/Android/sdk/platform-tools/adb')
    if (!existsSync(adb)) return { id: requested ?? null, os: null, architecture: null }
    const id = requested ?? spawnSync(adb, ['devices'], { encoding: 'utf8' }).stdout.split('\n').map((line) => line.split(/\s+/)).find((parts) => parts[1] === 'device')?.[0] ?? null
    if (id == null) return { id: null, os: null, architecture: null }
    const prop = (name: string): string | null => spawnSync(adb, ['-s', id, 'shell', 'getprop', name], { encoding: 'utf8' }).stdout.trim() || null
    return { id, os: prop('ro.build.version.release'), architecture: prop('ro.product.cpu.abi') }
  }
  const devices = spawnSync('xcrun', ['simctl', 'list', 'devices', 'booted', '-j'], { encoding: 'utf8' })
  if (devices.status !== 0) return { id: requested ?? null, os: null, architecture: null }
  const document = JSON.parse(devices.stdout) as { devices?: Record<string, Array<{ udid?: string; name?: string; state?: string }>> }
  const candidate = Object.entries(document.devices ?? {}).flatMap(([runtime, values]) =>
    values.map((value) => ({ ...value, runtime })),
  ).find((value) => value.udid === requested || (requested == null && value.state === 'Booted' && /iPhone/.test(value.name ?? '')))
  if (candidate?.udid == null) return { id: requested ?? null, os: null, architecture: null }
  const architecture = spawnSync('xcrun', ['simctl', 'spawn', candidate.udid, '/usr/sbin/sysctl', '-n', 'hw.machine'], { encoding: 'utf8' }).stdout.trim() || null
  return {
    id: candidate.udid,
    os: candidate.runtime.replace(/^com\.apple\.CoreSimulator\.SimRuntime\./, '').replaceAll('-', '.'),
    architecture,
  }
}

function hostScript(command: Exclude<LocalCommand, 'doctor' | 'prepare'>, platform: LocalPlatform): string {
  return join(runnerRoot, 'local-runtime/hosts', `${command}-${platform}.sh`)
}

export function prepareHostProject(
  descriptor: ResolvedLocalProductDescriptor,
  surface: LocalSurface,
  platform: LocalPlatform,
  project: string,
  runRoot: string,
  environment: NodeJS.ProcessEnv,
): boolean {
  const preparation = descriptor.hostPreparation[platform]
  if (preparation == null || (preparation.surfaces != null && !preparation.surfaces.includes(surface))) return false
  ensureInside(descriptor.repositoryRoot, preparation.script)
  assert(existsSync(preparation.script), `Missing ${platform} host preparation script: ${preparation.script}`)
  const stdoutPath = join(runRoot, `prepare-${platform}.stdout.log`)
  const stderrPath = join(runRoot, `prepare-${platform}.stderr.log`)
  const stdout = openSync(stdoutPath, 'wx', 0o600)
  const stderr = openSync(stderrPath, 'wx', 0o600)
  let result
  try {
    result = spawnSync('bash', [preparation.script], {
      cwd: descriptor.repositoryRoot,
      stdio: ['ignore', stdout, stderr],
      env: {
        ...environment,
        OPENIM_LOCAL_PROJECT_ROOT: project,
        OPENIM_LOCAL_PRODUCT_DESCRIPTOR: descriptor.descriptorPath,
        OPENIM_LOCAL_PRODUCT: descriptor.id,
        OPENIM_LOCAL_SURFACE: surface,
        OPENIM_LOCAL_PLATFORM: platform,
        OPENIM_LOCAL_RUN_ROOT: runRoot,
      },
    })
  } finally {
    closeSync(stdout)
    closeSync(stderr)
  }
  assert(result.status === 0, `${platform} host preparation failed with exit ${String(result.status)}`)
  return true
}

function executeHost(command: Exclude<LocalCommand, 'doctor' | 'prepare'>, options: LocalRuntimeOptions, descriptor: ResolvedLocalProductDescriptor, project: string, profile: UniToolchainProfileV2, runRoot: string): Record<string, string> {
  const script = hostScript(command, options.platform)
  assert(existsSync(script), `Missing local runtime host adapter: ${script}`)
  const hostEnvironment: NodeJS.ProcessEnv = {
    ...process.env,
    OPENIM_LOCAL_PROJECT_ROOT: project,
    OPENIM_LOCAL_PRODUCT_DESCRIPTOR: descriptor.descriptorPath,
    OPENIM_LOCAL_PRODUCT: descriptor.id,
    OPENIM_LOCAL_SURFACE: options.surface,
    OPENIM_LOCAL_PLATFORM: options.platform,
    OPENIM_LOCAL_SUITE: options.suite,
    OPENIM_LOCAL_RUN_ROOT: runRoot,
    OPENIM_LOCAL_APPLICATION_ID: descriptor.applicationIDs[options.surface],
    OPENIM_ANDROID_PACKAGE: descriptor.applicationIDs[options.surface],
    OPENIM_LOCAL_DCLOUD_APP_ID: descriptor.dcloudAppIDs[options.surface],
    OPENIM_UNI_TOOLCHAIN_PROFILE: profile.profilePath,
    OPENIM_TEST_DEVICE_ID: options.deviceID ?? '',
    OPENIM_CLOUD_PACKAGING: 'false',
    OPENIM_LOCAL_CLASSIC_VIDEO: descriptor.classicVideo === true ? '1' : '0',
  }
  prepareHostProject(descriptor, options.surface, options.platform, project, runRoot, hostEnvironment)
  const stdoutPath = join(runRoot, `${command}.stdout.log`)
  const stderrPath = join(runRoot, `${command}.stderr.log`)
  const stdout = openSync(stdoutPath, 'wx', 0o600)
  const stderr = openSync(stderrPath, 'wx', 0o600)
  const dcloudAppKey = resolveDCloudAppKey(options.surface, options.platform)
  const genericDCloudAppKeyName = genericDCloudAppKeyEnvironmentName(options.platform)
  let result
  try {
    result = spawnSync('bash', [script], {
      cwd: runnerRoot,
      stdio: ['ignore', stdout, stderr],
      env: {
        ...hostEnvironment,
        ...(dcloudAppKey != null ? { [genericDCloudAppKeyName]: dcloudAppKey } : {}),
      },
    })
  } finally {
    closeSync(stdout)
    closeSync(stderr)
  }
  assert(result.status === 0, `${command} ${options.platform} failed with exit ${String(result.status)}`)
  const compilerOutput = `${readFileSync(stdoutPath, 'utf8')}\n${readFileSync(stderrPath, 'utf8')}`
  assert(!/(?:\[tsl\]\s+ERROR|项目\s+\S+\s+编译失败|项目\s+\S+\s+导出失败|BUILD FAILED)/.test(compilerOutput), `${command} ${options.platform} reported a compiler failure despite exiting successfully`)
  const artifactsPath = join(runRoot, 'artifacts.json')
  return existsSync(artifactsPath) ? JSON.parse(readFileSync(artifactsPath, 'utf8')) as Record<string, string> : {}
}

export function archiveRuntimeArtifacts(artifacts: Record<string, string>, runRoot: string): Record<string, string> {
  const archived = { ...artifacts }
  const archiveRoot = join(resolve(runRoot), 'artifacts')
  for (const key of ['apkPath', 'appPath'] as const) {
    const source = artifacts[key]
    if (source == null || !existsSync(source)) continue
    mkdirSync(archiveRoot, { recursive: true })
    const target = join(archiveRoot, `${key}-${basename(source)}`)
    ensureInside(archiveRoot, target)
    cpSync(source, target, { recursive: statSync(source).isDirectory(), preserveTimestamps: true })
    archived[key] = target
  }
  return archived
}

function stateFor(command: LocalCommand, suite: string): LocalEvidenceState {
  if (command === 'build') return 'ASSEMBLE_PASS'
  if (command === 'run') return 'SMOKE_PASS'
  if (command === 'test') return suite === 'full' ? 'FULL_PASS' : 'SMOKE_PASS'
  return 'NOT_RUN'
}

function writeEvidence(path: string, evidence: LocalEvidenceV1): void {
  writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 })
}

export function runLocalRuntime(options: LocalRuntimeOptions): { project: string; runRoot: string; evidence: LocalEvidenceV1 } {
  assertSurface(options.surface)
  assertPlatform(options.platform)
  const descriptor = resolveProductDescriptor(options.descriptorPath)
  const profile = resolveUniToolchainProfile(options.profilePath)
  const workspaceRoot = resolve(options.workspaceRoot ?? process.env.OPENIM_LOCAL_WORKSPACE_ROOT ?? '/Volumes/workspace/work/openim-uni-runtime-workspaces')
  const runID = options.runID ?? `${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${randomUUID()}`
  const startedAt = new Date().toISOString()
  const runRoot = join(workspaceRoot, '.runs', runID)
  ensureInside(workspaceRoot, runRoot)
  assert(!existsSync(runRoot), `Run evidence is immutable and already exists: ${runID}`)
  mkdirSync(runRoot, { recursive: true, mode: 0o700 })
  const lock = new LocalRuntimeLock(join(workspaceRoot, '.locks'), {
    schemaVersion: 1,
    pid: process.pid,
    runID,
    product: descriptor.id,
    surface: options.surface,
    platform: options.platform,
    deviceID: options.deviceID ?? null,
    startedAt,
  })
  const device = detectDevice(options.platform, options.deviceID)
  const identity = sourceIdentity(descriptor.repositoryRoot)
  let project = join(workspaceRoot, descriptor.id, options.surface)
  let evidence: LocalEvidenceV1 = {
    schema: 'io.openim.uni.local-runtime-evidence/v1',
    runID,
    state: 'NOT_RUN',
    cloudPackaging: false,
    startedAt,
    finishedAt: startedAt,
    source: identity,
    runner: sourceIdentity(runnerRoot),
    product: descriptor.id,
    surface: options.surface,
    platform: options.platform,
    suite: options.suite,
    profile: {
      id: profile.profileID,
      path: profile.profilePath,
      sdkArchiveSha256: profile.sdks[options.surface === 'uniappx' ? 'uniappx' : 'uniapp'][options.platform].archiveSha256,
    },
    artifacts: {},
    nativeArtifacts: Object.fromEntries(descriptor.nativeArtifacts.map((artifact) => [artifact.id, artifactDigest(artifact.path)])),
    device,
    redactions: { tokensPersisted: false, credentialsPersisted: false, serverAddressPersisted: false },
  }
  try {
    if (options.surface !== 'uniappx' && (options.command === 'run' || options.command === 'test')) {
      const credential = dcloudAppKeyEnvironmentName(options.surface, options.platform)
      assert(resolveDCloudAppKey(options.surface, options.platform) != null, `${credential} is required for traditional uni-app runtime acceptance`)
    }
    project = prepareStableProject(descriptor, options.surface, workspaceRoot)
    if (options.command !== 'doctor' && options.command !== 'prepare') {
      evidence.artifacts = archiveRuntimeArtifacts(
        executeHost(options.command, options, descriptor, project, profile, runRoot),
        runRoot,
      )
    }
    evidence.state = stateFor(options.command, options.suite)
    return { project, runRoot, evidence }
  } catch (error) {
    evidence.state = 'BLOCKED'
    evidence.error = { stage: options.command, type: error instanceof Error ? error.constructor.name : 'UnknownError' }
    throw error
  } finally {
    evidence.finishedAt = new Date().toISOString()
    writeEvidence(join(runRoot, 'evidence.json'), evidence)
    lock.release()
  }
}

export function listLocalRuns(workspaceRoot: string): Array<{ runID: string; evidence: LocalEvidenceV1 }> {
  const root = join(resolve(workspaceRoot), '.runs')
  if (!existsSync(root)) return []
  return readdirSync(root).sort().flatMap((runID) => {
    const path = join(root, runID, 'evidence.json')
    return existsSync(path) ? [{ runID, evidence: JSON.parse(readFileSync(path, 'utf8')) as LocalEvidenceV1 }] : []
  })
}

export function cleanupLocalRun(workspaceRoot: string, runID: string): void {
  assert(/^[A-Za-z0-9._-]+$/.test(runID), 'Invalid runID')
  const target = join(resolve(workspaceRoot), '.runs', runID)
  ensureInside(join(resolve(workspaceRoot), '.runs'), target)
  assert(existsSync(join(target, 'evidence.json')), `Refusing to clean an unrecognized run directory: ${target}`)
  rmSync(target, { recursive: true })
}

export function fileArtifact(path: string): Record<string, string> {
  return { path: resolve(path), sha256: sha256(path), bytes: String(statSync(path).size) }
}

export interface LocalMatrixCell {
  surface: LocalSurface
  platform: LocalPlatform
  command: Extract<LocalCommand, 'build' | 'run' | 'test'>
  suite: 'smoke' | 'full'
}

export interface LocalMatrixResult {
  cell: LocalMatrixCell
  runID: string
  state: LocalEvidenceState
  evidencePath: string
  errorType?: string
}

export function localMatrixCells(tier: LocalMatrixTier): LocalMatrixCell[] {
  return surfaces.flatMap((surface) => platforms.map((platform): LocalMatrixCell => {
    if (tier === 'pr') return { surface, platform, command: 'build', suite: 'smoke' }
    if (surface === 'uniapp-vue2') return { surface, platform, command: 'run', suite: 'smoke' }
    return { surface, platform, command: 'test', suite: 'full' }
  }))
}

export function runLocalMatrix(options: {
  descriptorPath: string
  tier: LocalMatrixTier
  workspaceRoot?: string
  profilePath?: string
  deviceID?: string
  runPrefix?: string
}): LocalMatrixResult[] {
  const descriptor = resolveProductDescriptor(options.descriptorPath)
  const prefix = options.runPrefix ?? `${descriptor.id}-${options.tier}-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`
  const results: LocalMatrixResult[] = []
  for (const cell of localMatrixCells(options.tier)) {
    const runID = `${prefix}-${cell.surface}-${cell.platform}`
    try {
      const result = runLocalRuntime({
        command: cell.command,
        descriptorPath: descriptor.descriptorPath,
        surface: cell.surface,
        platform: cell.platform,
        suite: cell.suite,
        runID,
        ...(options.workspaceRoot != null ? { workspaceRoot: options.workspaceRoot } : {}),
        ...(options.profilePath != null ? { profilePath: options.profilePath } : {}),
        ...(options.deviceID != null ? { deviceID: options.deviceID } : {}),
      })
      results.push({ cell, runID, state: result.evidence.state, evidencePath: join(result.runRoot, 'evidence.json') })
    } catch (error) {
      const workspaceRoot = resolve(options.workspaceRoot ?? process.env.OPENIM_LOCAL_WORKSPACE_ROOT ?? '/Volumes/workspace/work/openim-uni-runtime-workspaces')
      const evidencePath = join(workspaceRoot, '.runs', runID, 'evidence.json')
      const evidence = JSON.parse(readFileSync(evidencePath, 'utf8')) as LocalEvidenceV1
      results.push({ cell, runID, state: evidence.state, evidencePath, errorType: error instanceof Error ? error.constructor.name : 'UnknownError' })
    }
  }
  return results
}
