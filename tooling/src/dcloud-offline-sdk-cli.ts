import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

import { installOfflineSDKProfile, resolveOfflineSDKProfile, verifyOfflineSDKProfile } from './dcloud-offline-sdk.js'

interface CatalogArchive {
  archiveFileName: string
  archiveRoot: string
  sha256: string
}

interface CatalogProfile {
  hbuilderxVersion: string
  distribution: 'alpha' | 'release'
  android: CatalogArchive
  ios: CatalogArchive
}

interface Catalog {
  schemaVersion: number
  profiles: Record<string, CatalogProfile>
}

function parseArguments(argv: string[]): { command: string; values: Map<string, string> } {
  const command = argv[0] ?? ''
  const values = new Map<string, string>()
  for (let index = 1; index < argv.length; index += 1) {
    const key = argv[index]
    const value = argv[index + 1]
    if (key == null || !key.startsWith('--') || value == null || value.startsWith('--')) throw new Error(`Invalid DCloud offline SDK argument near ${key ?? '<end>'}`)
    values.set(key.slice(2), value)
    index += 1
  }
  return { command, values }
}

function required(values: Map<string, string>, key: string): string {
  const value = values.get(key)
  if (value == null || value === '') throw new Error(`Missing required argument --${key}`)
  return value
}

function defaultCatalogPath(): string {
  const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  return join(sourceRoot, 'local-runtime/dcloud-offline-sdk-catalog.json')
}

function defaultRoot(): string {
  return process.env.OPENIM_UNI_TOOLCHAINS_ROOT ?? join(homedir(), 'Library/Developer/OpenIM/UniToolchains')
}

function loadCatalog(path: string): Catalog {
  const catalog = JSON.parse(readFileSync(path, 'utf8')) as Catalog
  if (catalog.schemaVersion !== 1) throw new Error(`Unsupported DCloud offline SDK catalog schema: ${catalog.schemaVersion}`)
  return catalog
}

async function main(): Promise<void> {
  const { command, values } = parseArguments(process.argv.slice(2))
  const catalogPath = resolve(values.get('catalog') ?? defaultCatalogPath())
  const root = resolve(values.get('root') ?? defaultRoot())
  const profileID = values.get('profile') ?? process.env.OPENIM_DCLOUD_OFFLINE_PROFILE_ID ?? ''
  if (command === 'install') {
    const catalog = loadCatalog(catalogPath)
    const selected = catalog.profiles[profileID]
    if (selected == null) throw new Error(`DCloud offline SDK profile is absent from catalog: ${profileID}`)
    const profile = await installOfflineSDKProfile({
      profileID,
      hbuilderxVersion: selected.hbuilderxVersion,
      distribution: selected.distribution,
      toolchainsRoot: join(root, 'dcloud'),
      android: {
        archivePath: resolve(required(values, 'android-archive')),
        sha256: selected.android.sha256,
        archiveRoot: selected.android.archiveRoot,
      },
      ios: {
        archivePath: resolve(required(values, 'ios-archive')),
        sha256: selected.ios.sha256,
        archiveRoot: selected.ios.archiveRoot,
      },
    })
    process.stdout.write(`${JSON.stringify(profile, null, 2)}\n`)
    return
  }
  if (command === 'verify') {
    const explicit = values.get('profile-path')
    const profile = explicit != null
      ? verifyOfflineSDKProfile(resolve(explicit))
      : resolveOfflineSDKProfile({ toolchainsRoot: join(root, 'dcloud'), profileID })
    process.stdout.write(`${JSON.stringify(profile, null, 2)}\n`)
    return
  }
  if (command === 'resolve') {
    const explicit = values.get('profile-path')
    const profile = resolveOfflineSDKProfile({
      ...(explicit == null ? {} : { profilePath: explicit }),
      toolchainsRoot: join(root, 'dcloud'),
      profileID,
    })
    process.stdout.write(`${JSON.stringify(profile, null, 2)}\n`)
    return
  }
  throw new Error('Usage: dcloud-offline-sdk-cli <install|verify|resolve> --profile <id> [--root <path>]')
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
