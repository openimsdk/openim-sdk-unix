import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import {
  compilePlatform,
  hasFailure,
  normalizeLog,
  runStreamingCommand,
  verifyToolchain,
} from './compile.js'
import { withLocalNativeProfile } from './native-profile.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export function removedEventControlFixture(source: string): string {
  const currentName = 'offAll'
  const removedName = ['off', 'Event'].join('')
  assert(source.includes(currentName), 'Consumer fixture does not use offAll')
  return source.replaceAll(currentName, removedName)
}

function copyConsumerProject(root: string): string {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'openim-consumer-compile-'))
  const excluded = new Set(['.git', 'node_modules', 'test-results', 'unpackage', '.omx'])
  cpSync(root, temporaryRoot, {
    recursive: true,
    filter: (source) => source === root || !excluded.has(basename(source)),
  })
  return temporaryRoot
}

async function compileRemovedConsumer(
  projectRoot: string,
  platform: 'android' | 'ios',
  toolchainRoot: string,
): Promise<string> {
  const cliPath = verifyToolchain(toolchainRoot, { verifyPublicNative: false }).hbuilderx.cliPath
  execFileSync(cliPath, ['project', 'open', '--path', projectRoot], { timeout: 15_000 })
  try {
    const args = [
      'launch',
      `app-${platform}`,
      '--project',
      projectRoot,
      '--compile',
      'true',
      '--cleanCache',
      'true',
      '--continue-on-error',
      'false',
    ]
    if (platform === 'ios') args.push('--iosTarget', 'simulator')
    const result = await runStreamingCommand(cliPath, args, {
      cwd: projectRoot,
      timeoutMs: 10 * 60_000,
      heartbeatMs: 15_000,
    })
    const log = normalizeLog(result.log)
    assert(result.timedOut === false, `${platform} negative consumer compile timed out`)
    const removedExportFailure = /is not exported by/.test(log)
    assert(
      result.status !== 0 || hasFailure(log) || removedExportFailure,
      `${platform} unexpectedly compiled a consumer importing the removed export`,
    )
    return log
  } finally {
    try {
      execFileSync(cliPath, ['project', 'close', '--path', projectRoot], { timeout: 15_000 })
    } catch {
      // The temporary project is still removed; a failed close must not mask
      // the consumer compiler result.
    }
  }
}

export async function verifyEventControlConsumerCompile(
  root: string,
  platform: 'android' | 'ios',
): Promise<void> {
  await withLocalNativeProfile(root, platform, () => compilePlatform(root, platform, root, { verifyPublicNative: false }))

  const temporaryRoot = copyConsumerProject(root)
  try {
    const pagePath = join(temporaryRoot, 'pages/index/index.uvue')
    writeFileSync(pagePath, removedEventControlFixture(readFileSync(pagePath, 'utf8')))
    const log = await withLocalNativeProfile(
      temporaryRoot,
      platform,
      () => compileRemovedConsumer(temporaryRoot, platform, root),
    )
    assert(log.includes(['off', 'Event'].join('')), `${platform} negative compile did not fail on the removed export`)
    const evidenceDirectory = join(root, 'test-results/consumer')
    mkdirSync(evidenceDirectory, { recursive: true })
    writeFileSync(join(evidenceDirectory, `${platform}-removed-event-control.log`), log)
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
}
