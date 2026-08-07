import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

interface ToolchainLock {
  hbuilderx: {
    version: string
    cliPath: string
    cliSha256: string
    utsPluginManifestPath: string
    utsPluginManifestSha256: string
  }
  publicNative: {
    source: {
      repository: string
      revision: string
      defaultRoot: string
      rootEnvironmentVariable: string
    }
    android: {
      sourcePath: string
      sha256: string
      localOverridePath: string
      externalCoordinate: string
      externalAbiStatus: string
    }
    ios: {
      sourcePath: string
      zipSha256: string
      extractedInventorySha256: string
      localOverridePath: string
      externalPod: string
      externalVersion: string
      externalAbiStatus: string
    }
  }
}

export interface ToolchainVerificationOptions {
  verifyPublicNative?: boolean
}

export interface CompilePlatformOptions {
  verifyPublicNative?: boolean
}

export type CompilePlatform = 'android' | 'ios' | 'harmony'

export interface StreamingCommandOptions {
  cwd: string
  timeoutMs: number
  heartbeatMs: number
  terminateGraceMs?: number
  maxBufferBytes?: number
  onOutput?: (stream: 'stdout' | 'stderr', chunk: string) => void
  onHeartbeat?: (message: string) => void
}

export interface StreamingCommandResult {
  status: number | null
  signal: NodeJS.Signals | null
  log: string
  timedOut: boolean
  bufferExceeded: boolean
  durationMs: number
  spawnError: string | null
}

function terminateProcessGroup(child: ReturnType<typeof spawn>, signal: NodeJS.Signals): void {
  if (child.pid == null) return
  if (process.platform !== 'win32') {
    try {
      process.kill(-child.pid, signal)
      return
    } catch {
      // Fall through when the child did not establish a process group.
    }
  }
  try {
    child.kill(signal)
  } catch {
    // The process may have exited between the timeout and termination attempt.
  }
}

export function runStreamingCommand(
  command: string,
  args: string[],
  options: StreamingCommandOptions,
): Promise<StreamingCommandResult> {
  const startedAt = Date.now()
  const maxBufferBytes = options.maxBufferBytes ?? 64 * 1024 * 1024
  const terminateGraceMs = options.terminateGraceMs ?? 5_000
  const chunks: string[] = []
  let bufferedBytes = 0
  let timedOut = false
  let bufferExceeded = false
  let spawnError: string | null = null

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let finished = false
    let forceKillTimer: NodeJS.Timeout | null = null

    const emit = (stream: 'stdout' | 'stderr', chunk: string): void => {
      if (options.onOutput) options.onOutput(stream, chunk)
      else if (stream === 'stdout') process.stdout.write(chunk)
      else process.stderr.write(chunk)
      const bytes = Buffer.byteLength(chunk)
      if (bufferedBytes + bytes <= maxBufferBytes) {
        chunks.push(chunk)
        bufferedBytes += bytes
      } else if (!bufferExceeded) {
        bufferExceeded = true
        terminateProcessGroup(child, 'SIGTERM')
      }
    }

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => emit('stdout', chunk))
    child.stderr?.on('data', (chunk: string) => emit('stderr', chunk))

    const heartbeat = setInterval(() => {
      const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1_000)
      const message = `[compile] still running (${elapsedSeconds}s)\n`
      if (options.onHeartbeat) options.onHeartbeat(message)
      else process.stderr.write(message)
    }, options.heartbeatMs)

    const timeout = setTimeout(() => {
      timedOut = true
      terminateProcessGroup(child, 'SIGTERM')
      forceKillTimer = setTimeout(() => terminateProcessGroup(child, 'SIGKILL'), terminateGraceMs)
    }, options.timeoutMs)

    const finish = (status: number | null, signal: NodeJS.Signals | null): void => {
      if (finished) return
      finished = true
      clearInterval(heartbeat)
      clearTimeout(timeout)
      if (forceKillTimer != null) clearTimeout(forceKillTimer)
      resolve({
        status,
        signal,
        log: chunks.join(''),
        timedOut,
        bufferExceeded,
        durationMs: Date.now() - startedAt,
        spawnError,
      })
    }

    child.on('error', (error) => {
      spawnError = error.message
      finish(null, null)
    })
    child.on('close', finish)
  })
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function sha256Directory(path: string): string {
  const files: string[] = []
  const walk = (directory: string): void => {
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

export function normalizeLog(log: string): string {
  return log
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, '')
}

const HARMONY_PROGRESS_LINE = /(?:HBuilderX Version|项目 .+开始编译|正在编译中|UTS编译完毕|ready in|开始构建鸿蒙工程|DevEco Studio|安装鸿蒙工程|依赖成功|开始制作运行包|运行包制作成功|运行包制作失败|未正确配置鸿蒙应用的包名|没有配置签名证书|未配置相关数字证书|已停止运行)/
const HARMONY_FAILURE_LINE = /(?:Compiler Error|COMPILE RESULT|BUILD FAILED|编译失败|构建失败|制作失败|\berror\s*:|\bERROR:|at uni_modules\/unix-openim-sdk)/i

export function createHarmonyOutputFilter(write: (line: string) => void): {
  push: (stream: 'stdout' | 'stderr', chunk: string) => void
  flush: () => void
} {
  const remainders: Record<'stdout' | 'stderr', string> = { stdout: '', stderr: '' }
  let previous = ''
  let packageProgressSeen = false
  const emit = (line: string): void => {
    const clean = normalizeLog(line).trim()
    if (clean === '' || (!HARMONY_PROGRESS_LINE.test(clean) && !HARMONY_FAILURE_LINE.test(clean))) return
    if (clean.includes('开始制作运行包')) {
      if (packageProgressSeen) return
      packageProgressSeen = true
    }
    const dedupe = clean.replace(/\.{2,}$/g, '')
    if (dedupe === previous) return
    previous = dedupe
    write(clean)
  }
  return {
    push: (stream, chunk) => {
      const text = `${remainders[stream]}${chunk}`.replaceAll('\r', '\n')
      const lines = text.split('\n')
      remainders[stream] = lines.pop() ?? ''
      for (const line of lines) emit(line)
    },
    flush: () => {
      emit(remainders.stdout)
      emit(remainders.stderr)
      remainders.stdout = ''
      remainders.stderr = ''
    },
  }
}

function failureExcerpt(log: string): string {
  const lines = normalizeLog(log).replaceAll('\r', '\n').split('\n')
  const selected = new Set<number>()
  for (let index = 0; index < lines.length; index += 1) {
    if (!HARMONY_FAILURE_LINE.test(lines[index] ?? '')) continue
    for (let nearby = Math.max(0, index - 2); nearby <= Math.min(lines.length - 1, index + 4); nearby += 1) {
      selected.add(nearby)
    }
  }
  return [...selected].sort((left, right) => left - right).map((index) => lines[index]).join('\n').trim()
}

export function verifyToolchain(
  root: string,
  options: ToolchainVerificationOptions = {},
): ToolchainLock {
  const lock = JSON.parse(readFileSync(join(root, 'toolchain.lock.json'), 'utf8')) as ToolchainLock
  const cliPath = process.env.OPENIM_HBUILDERX_CLI ?? lock.hbuilderx.cliPath
  if (sha256File(cliPath) !== lock.hbuilderx.cliSha256) throw new Error(`HBuilderX CLI hash mismatch: ${cliPath}`)
  if (sha256File(lock.hbuilderx.utsPluginManifestPath) !== lock.hbuilderx.utsPluginManifestSha256) {
    throw new Error(`HBuilderX UTS plugin hash mismatch: ${lock.hbuilderx.utsPluginManifestPath}`)
  }
  if (options.verifyPublicNative === false) {
    return { ...lock, hbuilderx: { ...lock.hbuilderx, cliPath } }
  }
  const nativeRoot = process.env[lock.publicNative.source.rootEnvironmentVariable] ?? lock.publicNative.source.defaultRoot
  const androidSource = join(nativeRoot, lock.publicNative.android.sourcePath)
  const iosSource = join(nativeRoot, lock.publicNative.ios.sourcePath)
  if (sha256File(androidSource) !== lock.publicNative.android.sha256) {
    throw new Error(`Public Android native artifact hash mismatch: ${androidSource}`)
  }
  if (sha256File(iosSource) !== lock.publicNative.ios.zipSha256) {
    throw new Error(`Public iOS native artifact hash mismatch: ${iosSource}`)
  }
  const localAndroid = join(root, lock.publicNative.android.localOverridePath)
  const localIOS = join(root, lock.publicNative.ios.localOverridePath)
  if (sha256File(localAndroid) !== lock.publicNative.android.sha256) {
    throw new Error(`Public Android local override is stale: ${localAndroid}`)
  }
  if (sha256Directory(localIOS) !== lock.publicNative.ios.extractedInventorySha256) {
    throw new Error(`Public iOS local override is stale: ${localIOS}`)
  }
  return { ...lock, hbuilderx: { ...lock.hbuilderx, cliPath } }
}

export { sha256Directory }

function commandFor(root: string, platform: CompilePlatform, cliPath: string): { command: string; args: string[] } {
  if (platform === 'harmony') {
    return { command: cliPath, args: ['launch', 'app-harmony', '--project', root, '--compile', 'true'] }
  }
  return {
    command: cliPath,
    args: [
      'compile',
      `app-${platform}`,
      '--project',
      root,
      '--uni_module',
      'uni_modules/unix-openim-sdk',
    ],
  }
}

export function isSuccessful(platform: CompilePlatform, log: string): boolean {
  if (platform === 'harmony') {
    const utsSucceeded = /(?:UTS编译完毕|UTS.*编译成功|BUILD SUCCESSFUL|Build SUCCESSFUL)/i.test(log)
    const packageSucceeded = /(?:运行包制作成功|\.hap.*(?:success|成功)|BUILD SUCCESSFUL|Build SUCCESSFUL)/i.test(log)
    return utsSucceeded && packageSucceeded
  }
  return /项目\s+.+（模块\s+unix-openim-sdk）编译成功[。.]/.test(log)
}

export function hasFailure(log: string): boolean {
  return /(?:编译失败|构建失败|BUILD FAILED|Build failed|\berror\s*:|\bexception\s*:)/i.test(log)
}

function positiveEnvironmentNumber(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw == null || raw === '') return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive number`)
  return parsed
}

export async function compilePlatform(
  root: string,
  platform: CompilePlatform,
  toolchainRoot: string = root,
  options: CompilePlatformOptions = {},
): Promise<void> {
  const lock = verifyToolchain(toolchainRoot, options)
  const invocation = commandFor(root, platform, lock.hbuilderx.cliPath)
  const defaultTimeoutMs = platform === 'harmony' ? 10 * 60_000 : 5 * 60_000
  const timeoutMs = positiveEnvironmentNumber('OPENIM_COMPILE_TIMEOUT_MS', defaultTimeoutMs)
  const heartbeatMs = positiveEnvironmentNumber('OPENIM_COMPILE_HEARTBEAT_MS', 15_000)
  process.stderr.write(`[compile:${platform}] starting; timeout=${Math.floor(timeoutMs / 1_000)}s\n`)
  const harmonyOutput = createHarmonyOutputFilter((line) => process.stderr.write(`${line}\n`))
  const result = await runStreamingCommand(invocation.command, invocation.args, {
    cwd: root,
    timeoutMs,
    heartbeatMs,
    onOutput: (stream, chunk) => {
      if (platform === 'harmony') harmonyOutput.push(stream, chunk)
      else if (stream === 'stdout') process.stdout.write(chunk)
      else process.stderr.write(chunk)
    },
    onHeartbeat: (message) => process.stderr.write(`[compile:${platform}] ${message.slice('[compile] '.length)}`),
  })
  if (platform === 'harmony') harmonyOutput.flush()
  const rawLog = result.log
  const log = normalizeLog(rawLog)
  const observedVersion = /HBuilderX Version:\s*([^\s]+)/.exec(log)?.[1]
  const errors: string[] = []
  if (result.timedOut) errors.push(`hard timeout after ${timeoutMs}ms`)
  if (result.bufferExceeded) errors.push('compile log exceeded 64 MiB')
  if (result.spawnError != null) errors.push(`spawn failed: ${result.spawnError}`)
  if (result.status !== 0) errors.push(`exit code ${result.status ?? 'null'}`)
  if (observedVersion !== lock.hbuilderx.version) {
    errors.push(`toolchain version ${observedVersion ?? 'missing'} (expected ${lock.hbuilderx.version})`)
  }
  if (hasFailure(log)) errors.push('failure marker found in compile log')
  if (!isSuccessful(platform, log)) errors.push('explicit success marker missing')

  const evidenceDirectory = join(root, 'test-results/compile')
  mkdirSync(evidenceDirectory, { recursive: true })
  const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
  const evidence = {
    platform,
    timestamp,
    toolchainVersion: observedVersion ?? null,
    cliSha256: lock.hbuilderx.cliSha256,
    command: [invocation.command, ...invocation.args],
    shellExitCode: result.status,
    terminationSignal: result.signal,
    durationMs: result.durationMs,
    timeoutMs,
    timedOut: result.timedOut,
    bufferExceeded: result.bufferExceeded,
    explicitSuccess: isSuccessful(platform, log),
    failureMarker: hasFailure(log),
    logSha256: createHash('sha256').update(rawLog).digest('hex'),
  }
  writeFileSync(join(evidenceDirectory, `${timestamp}-${platform}.json`), `${JSON.stringify(evidence, null, 2)}\n`)
  writeFileSync(join(evidenceDirectory, `${timestamp}-${platform}.log`), rawLog)
  if (errors.length > 0) {
    const excerpt = failureExcerpt(rawLog)
    if (excerpt !== '') process.stderr.write(`[compile:${platform}] failure excerpt:\n${excerpt}\n`)
    throw new Error(`${platform} compile rejected: ${errors.join('; ')}`)
  }
  process.stderr.write(`[compile:${platform}] verified success in ${(result.durationMs / 1_000).toFixed(1)}s\n`)
}
