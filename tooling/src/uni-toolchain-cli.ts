#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  installUniToolchainProfile,
  resolveUniToolchainProfile,
  type UniToolchainCatalogV2,
} from './uni-toolchain.js'

function argumentsMap(argv: string[]): { command: string; values: Map<string, string> } {
  const command = argv[0] ?? ''
  const values = new Map<string, string>()
  for (let index = 1; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (name == null || !name.startsWith('--') || value == null) throw new Error(`Invalid argument near ${name ?? '<end>'}`)
    values.set(name.slice(2), value)
  }
  return { command, values }
}

function required(values: Map<string, string>, name: string): string {
  const value = values.get(name)
  if (value == null || value === '') throw new Error(`Missing --${name}`)
  return resolve(value)
}

async function main(): Promise<void> {
  const { command, values } = argumentsMap(process.argv.slice(2))
  if (command === 'verify' || command === 'resolve') {
    const profile = resolveUniToolchainProfile(values.get('profile') ?? process.env.OPENIM_UNI_TOOLCHAIN_PROFILE ?? '')
    process.stdout.write(`${JSON.stringify(profile, null, 2)}\n`)
    return
  }
  if (command === 'install') {
    const catalogPath = required(values, 'catalog')
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as UniToolchainCatalogV2
    const profile = await installUniToolchainProfile({
      catalog,
      toolchainsRoot: required(values, 'root'),
      archives: {
        uniapp: {
          android: { archivePath: required(values, 'uniapp-android'), archiveRoot: catalog.sdks.uniapp.android.archiveRoot, sha256: catalog.sdks.uniapp.android.sha256 },
          ios: { archivePath: required(values, 'uniapp-ios'), archiveRoot: catalog.sdks.uniapp.ios.archiveRoot, sha256: catalog.sdks.uniapp.ios.sha256 },
        },
        uniappx: {
          android: { archivePath: required(values, 'uniappx-android'), archiveRoot: catalog.sdks.uniappx.android.archiveRoot, sha256: catalog.sdks.uniappx.android.sha256 },
          ios: { archivePath: required(values, 'uniappx-ios'), archiveRoot: catalog.sdks.uniappx.ios.archiveRoot, sha256: catalog.sdks.uniappx.ios.sha256 },
        },
      },
    })
    process.stdout.write(`${JSON.stringify(profile, null, 2)}\n`)
    return
  }
  throw new Error('Usage: uni-toolchain-cli <install|verify|resolve> [options]')
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
