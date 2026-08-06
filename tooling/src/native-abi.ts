import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { CompilePlatform } from './compile.js'
import { verifyToolchain } from './compile.js'
import { sha256 } from './source.js'

interface NativeLock {
  publicNative: {
    source: { revision: string; defaultRoot: string; rootEnvironmentVariable: string }
    android: { sourcePath: string; sha256: string }
    ios: { sourcePath: string; zipSha256: string; extractedInventorySha256: string }
  }
}

function writeText(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, value.endsWith('\n') ? value : `${value}\n`)
}

function command(commandName: string, args: string[], encoding: 'utf8'): string
function command(commandName: string, args: string[], encoding: 'buffer'): Buffer
function command(commandName: string, args: string[], encoding: 'utf8' | 'buffer'): string | Buffer {
  return execFileSync(commandName, args, {
    encoding: encoding === 'utf8' ? 'utf8' : 'buffer',
    maxBuffer: 128 * 1024 * 1024,
  })
}

function normalizeJavap(value: string): string {
  return value
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('Compiled from '))
    .join('\n')
    .trim()
}

function androidABI(aarPath: string): { text: string; classCount: number; methodCount: number } {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'openim-native-abi-'))
  const classesPath = join(temporaryDirectory, 'classes.jar')
  writeFileSync(classesPath, command('unzip', ['-p', aarPath, 'classes.jar'], 'buffer'))
  const entries = command('jar', ['tf', classesPath], 'utf8')
    .split(/\r?\n/)
    .filter((entry) => /^(?:open_im_sdk|open_im_sdk_callback)\/.+\.class$/.test(entry))
    .filter((entry) => !entry.includes('$'))
    .map((entry) => entry.replaceAll('/', '.').replace(/\.class$/, ''))
    .sort()
  const sections: string[] = []
  let methodCount = 0
  for (const className of entries) {
    const output = normalizeJavap(command('javap', ['-classpath', classesPath, '-public', className], 'utf8'))
    methodCount += output.split(/\r?\n/).filter((line) => line.trim().startsWith('public ')).length
    sections.push(`## ${className}\n${output}`)
  }
  return { text: sections.join('\n\n'), classCount: entries.length, methodCount }
}

function iosHeader(zipPath: string, name: string): string {
  const path = `OpenIMCore.xcframework/ios-arm64/OpenIMCore.framework/Headers/${name}`
  return command('unzip', ['-p', zipPath, path], 'utf8').trim()
}

function iosABI(zipPath: string): { text: string; declarationCount: number } {
  const callback = iosHeader(zipPath, 'Open_im_sdk_callback.objc.h')
  const sdk = iosHeader(zipPath, 'Open_im_sdk.objc.h')
  const text = `## Open_im_sdk_callback.objc.h\n${callback}\n\n## Open_im_sdk.objc.h\n${sdk}`
  const declarationCount = text.split(/\r?\n/).filter((line) => /^(?:FOUNDATION_EXPORT|[-+] \()/.test(line.trim())).length
  return { text, declarationCount }
}

export function importNativeABI(root: string): void {
  verifyToolchain(root)
  const lock = JSON.parse(readFileSync(join(root, 'toolchain.lock.json'), 'utf8')) as NativeLock
  const nativeRoot = process.env[lock.publicNative.source.rootEnvironmentVariable] ?? lock.publicNative.source.defaultRoot
  const aarPath = join(nativeRoot, lock.publicNative.android.sourcePath)
  const zipPath = join(nativeRoot, lock.publicNative.ios.sourcePath)
  const android = androidABI(aarPath)
  const ios = iosABI(zipPath)
  writeText(join(root, 'contracts/base/native-abi/android.txt'), android.text)
  writeText(join(root, 'contracts/base/native-abi/ios.txt'), ios.text)
  writeText(
    join(root, 'contracts/base/native-abi/manifest.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        sourceRevision: lock.publicNative.source.revision,
        android: {
          artifactSha256: lock.publicNative.android.sha256,
          abiSha256: sha256(android.text),
          classes: android.classCount,
          declarations: android.methodCount,
        },
        ios: {
          artifactSha256: lock.publicNative.ios.zipSha256,
          inventorySha256: lock.publicNative.ios.extractedInventorySha256,
          abiSha256: sha256(ios.text),
          declarations: ios.declarationCount,
        },
      },
      null,
      2,
    ),
  )
}
