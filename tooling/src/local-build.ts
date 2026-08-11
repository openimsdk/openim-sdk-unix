import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  compilePlatform,
  hasFailure,
  normalizeLog,
  runStreamingCommand,
  sha256Directory,
  verifyToolchain,
} from './compile.js'
import { verifyPrivateNativeArtifacts, type MobileBuildPlatform } from './private-native.js'

interface ModuleArtifactEvidence {
  path: string
  size: number
  detail: string
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function positiveEnvironmentNumber(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw == null || raw === '') return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive number`)
  return parsed
}

function remove(path: string): void {
  rmSync(path, { force: true, recursive: true })
}

function cleanPlatformOutputs(privateRoot: string, platform: MobileBuildPlatform): void {
  const appPlatform = `app-${platform}`
  const targets = [
    join(privateRoot, 'unpackage/resources', appPlatform),
    join(privateRoot, 'unpackage/dist/build', appPlatform),
    join(privateRoot, 'unpackage/dist/build/.tsc', appPlatform),
    join(privateRoot, 'unpackage/dist/build/.uvue', appPlatform),
    join(privateRoot, `unpackage/cache/vapor/.${appPlatform}`),
  ]
  if (platform === 'android') {
    targets.push(
      join(
        privateRoot,
        'unpackage/cache/vapor/uts_standard_android/app-android/uts/uni_modules/unix-openim-sdk',
      ),
    )
  } else {
    for (const cacheName of ['uts_standard_ios', 'uts_standard_simulator']) {
      const cacheRoot = join(privateRoot, 'unpackage/cache/vapor', cacheName)
      const modules = join(cacheRoot, 'modules')
      targets.push(
        join(cacheRoot, 'app-ios/uts/uni_modules/unix-openim-sdk'),
        join(modules, 'OpenIMCore.framework'),
        join(modules, 'unimoduleUnixOpenimSdk.framework'),
        join(modules, 'unimoduleUnixOpenimSdk.framework.dSYM'),
      )
    }
  }
  for (const target of targets) remove(target)
}

function fileEvidence(path: string, detail: string): ModuleArtifactEvidence {
  const stats = statSync(path)
  assert(stats.isFile(), `Expected build artifact is not a file: ${path}`)
  assert(stats.size > 0, `Build artifact is empty: ${path}`)
  return { path, size: stats.size, detail }
}

function verifyModuleArtifacts(
  privateRoot: string,
  platform: MobileBuildPlatform,
): ModuleArtifactEvidence[] {
  if (platform === 'android') {
    const moduleRoot = join(
      privateRoot,
      'unpackage/cache/vapor/uts_standard_android/app-android/uts/uni_modules/unix-openim-sdk',
    )
    const dex = join(moduleRoot, 'classes.dex')
    const jar = join(moduleRoot, 'index.jar')
    const jarEntries = execFileSync('unzip', ['-Z1', jar], { encoding: 'utf8' }).trim().split('\n')
    assert(jarEntries.some((entry) => entry.endsWith('.class')), 'Android UTS jar contains no classes')
    return [
      fileEvidence(dex, 'Android UTS dex'),
      fileEvidence(jar, `${jarEntries.filter((entry) => entry.endsWith('.class')).length} classes`),
    ]
  }

  const cacheNames = ['uts_standard_ios', 'uts_standard_simulator']
  const cacheName = cacheNames.find((name) => {
    const binary = join(
      privateRoot,
      'unpackage/cache/vapor',
      name,
      'modules/unimoduleUnixOpenimSdk.framework/unimoduleUnixOpenimSdk',
    )
    try {
      return statSync(binary).isFile()
    } catch {
      return false
    }
  })
  assert(cacheName != null, 'iOS UTS compile produced no wrapper framework')
  const modules = join(privateRoot, 'unpackage/cache/vapor', cacheName, 'modules')
  const wrapper = join(
    modules,
    'unimoduleUnixOpenimSdk.framework/unimoduleUnixOpenimSdk',
  )
  const core = join(modules, 'OpenIMCore.framework/OpenIMCore')
  const wrapperHeader = execFileSync('otool', ['-hv', wrapper], { encoding: 'utf8' })
  assert(/\bDYLIB\b/.test(wrapperHeader), 'iOS UTS wrapper is not a dynamic library')
  const wrapperArchitectures = execFileSync('lipo', ['-archs', wrapper], { encoding: 'utf8' }).trim()
  const dependencies = execFileSync('otool', ['-L', wrapper], { encoding: 'utf8' })
  assert(dependencies.includes('OpenIMCore.framework/OpenIMCore'), 'iOS UTS wrapper does not link OpenIMCore')
  return [
    fileEvidence(wrapper, `iOS UTS dynamic framework (${cacheName}; ${wrapperArchitectures})`),
    fileEvidence(core, 'iOS OpenIMCore framework'),
  ]
}

export function isAppResourceSuccessful(platform: MobileBuildPlatform, log: string): boolean {
  const normalized = normalizeLog(log)
  return new RegExp(`导出\\s+${platform}\\s+成功`).test(normalized) && !hasFailure(normalized)
}

function verifyAppResource(
  privateRoot: string,
  platform: MobileBuildPlatform,
): { outputRoot: string; inventorySha256: string } {
  const outputRoot = join(privateRoot, 'unpackage/resources', `app-${platform}`)
  const appIds = readdirSync(outputRoot).filter((name) => name.startsWith('__UNI__'))
  assert(appIds.length === 1, `Expected one App ID directory in ${outputRoot}, found ${appIds.length}`)
  const www = join(outputRoot, appIds[0]!, 'www')
  fileEvidence(join(www, 'app-service.js'), `${platform} app service`)
  fileEvidence(join(www, 'manifest.json'), `${platform} resource manifest`)

  const pluginRoot = join(
    outputRoot,
    'uni_modules/unix-openim-sdk/utssdk',
    `app-${platform}`,
  )
  if (platform === 'android') {
    fileEvidence(join(pluginRoot, 'src/index.kt'), 'generated Android UTS source')
    fileEvidence(join(pluginRoot, 'libs/open_im_sdk.aar'), 'packaged Android native dependency')
  } else {
    fileEvidence(join(pluginRoot, 'src/index.swift'), 'generated iOS UTS source')
    fileEvidence(
      join(pluginRoot, 'Frameworks/OpenIMCore.xcframework/Info.plist'),
      'packaged iOS native dependency',
    )
  }
  return { outputRoot, inventorySha256: sha256Directory(outputRoot) }
}

function timestamp(): string {
  return new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
}

export async function buildPrivatePlatform(
  privateRoot: string,
  platform: MobileBuildPlatform,
  toolchainRoot: string,
): Promise<void> {
  const startedAt = new Date().toISOString()
  const evidenceDirectory = join(privateRoot, 'test-results/local-build')
  mkdirSync(evidenceDirectory, { recursive: true })
  const evidenceName = `${timestamp()}-${platform}`
  const evidencePath = join(evidenceDirectory, `${evidenceName}.json`)
  const logPath = join(evidenceDirectory, `${evidenceName}.log`)
  let phase = 'preflight'
  let moduleArtifacts: ModuleArtifactEvidence[] = []
  let publishLog = ''

  try {
    const lock = verifyToolchain(toolchainRoot, { verifyPublicNative: false })
    verifyPrivateNativeArtifacts(privateRoot, platform)
    cleanPlatformOutputs(privateRoot, platform)

    phase = 'module-compile'
    await compilePlatform(privateRoot, platform, toolchainRoot, { verifyPublicNative: false })
    moduleArtifacts = verifyModuleArtifacts(privateRoot, platform)

    phase = 'app-resource'
    const timeoutMs = positiveEnvironmentNumber('OPENIM_LOCAL_BUILD_TIMEOUT_MS', 5 * 60_000)
    const invocation = [
      'publish',
      `app-${platform}`,
      '--type',
      'appResource',
      '--project',
      privateRoot,
    ]
    const result = await runStreamingCommand(lock.hbuilderx.cliPath, invocation, {
      cwd: privateRoot,
      timeoutMs,
      heartbeatMs: 15_000,
      onOutput: (stream, chunk) => {
        if (stream === 'stdout') process.stdout.write(chunk)
        else process.stderr.write(chunk)
      },
      onHeartbeat: (message) => process.stderr.write(`[build:${platform}] ${message.slice('[compile] '.length)}`),
    })
    publishLog = result.log
    writeFileSync(logPath, publishLog)
    const errors: string[] = []
    if (result.timedOut) errors.push(`hard timeout after ${timeoutMs}ms`)
    if (result.bufferExceeded) errors.push('build log exceeded 64 MiB')
    if (result.spawnError != null) errors.push(`spawn failed: ${result.spawnError}`)
    if (result.status !== 0) errors.push(`exit code ${result.status ?? 'null'}`)
    if (!isAppResourceSuccessful(platform, publishLog)) errors.push('explicit appResource success marker missing or failure marker found')
    if (errors.length > 0) throw new Error(`${platform} appResource build rejected: ${errors.join('; ')}`)

    const resource = verifyAppResource(privateRoot, platform)
    phase = 'complete'
    writeFileSync(evidencePath, `${JSON.stringify({
      platform,
      startedAt,
      completedAt: new Date().toISOString(),
      phase,
      toolchainVersion: lock.hbuilderx.version,
      cliPath: lock.hbuilderx.cliPath,
      moduleArtifacts,
      appResource: resource,
      publishExitCode: result.status,
      publishExplicitSuccess: true,
    }, null, 2)}\n`)
    process.stderr.write(`[build:${platform}] verified local build: ${resource.outputRoot}\n`)
  } catch (error) {
    if (publishLog !== '') writeFileSync(logPath, publishLog)
    writeFileSync(evidencePath, `${JSON.stringify({
      platform,
      startedAt,
      failedAt: new Date().toISOString(),
      phase,
      moduleArtifacts,
      error: error instanceof Error ? error.message : String(error),
    }, null, 2)}\n`)
    throw error
  }
}
