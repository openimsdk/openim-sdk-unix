import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  createReadStream,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  closeSync,
} from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'

export interface OfflineSDKArchiveInput {
  archivePath: string
  sha256: string
  archiveRoot: string
}

export interface InstallOfflineSDKProfileInput {
  profileID: string
  hbuilderxVersion: string
  distribution: 'alpha' | 'release'
  toolchainsRoot: string
  android: OfflineSDKArchiveInput
  ios: OfflineSDKArchiveInput
}

interface InventorySummary {
  fileCount: number
  byteCount: number
  sha256: string
}

interface InstalledArchive {
  archiveFileName: string
  archiveSha256: string
  archiveRoot: string
  preservedArchivePath: string
  inventory: InventorySummary
}

export interface OfflineSDKProfile {
  schemaVersion: 1
  profileID: string
  hbuilderxVersion: string
  distribution: 'alpha' | 'release'
  dirty: false
  paths: {
    profileRoot: string
    profilePath: string
    activationScript: string
    androidSDKRoot: string
    iosSDKRoot: string
  }
  sources: {
    android: InstalledArchive
    ios: InstalledArchive
  }
  profilePath: string
}

function assertSafeIdentifier(value: string, label: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) throw new Error(`${label} is not a safe identifier: ${value}`)
}

function assertSha256(value: string, label: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`${label} must be a lowercase SHA-256 digest`)
}

async function fileSha256(path: string): Promise<string> {
  const digest = createHash('sha256')
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path)
    stream.on('data', (chunk) => digest.update(chunk))
    stream.on('error', reject)
    stream.on('end', resolvePromise)
  })
  return digest.digest('hex')
}

function fileSha256Sync(path: string): string {
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

function validateArchiveEntries(archivePath: string): void {
  const entries = execFileSync('unzip', ['-Z1', archivePath], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    .split('\n')
    .filter(Boolean)
  if (entries.length === 0) throw new Error(`Offline SDK archive is empty: ${archivePath}`)
  for (const entry of entries) {
    if (entry.startsWith('/') || entry.includes('\\') || entry.split('/').includes('..')) {
      throw new Error(`Unsafe path in offline SDK archive: ${entry}`)
    }
  }
}

function removeArchiveMetadata(root: string): void {
  for (const name of readdirSync(root)) {
    const path = join(root, name)
    if (name === '__MACOSX' || name === '.DS_Store' || name.startsWith('._')) {
      rmSync(path, { recursive: true, force: true })
      continue
    }
    if (lstatSync(path).isDirectory()) removeArchiveMetadata(path)
  }
}

function assertInsideRoot(root: string, path: string): void {
  const resolvedRoot = `${realpathSync(root)}${sep}`
  const resolvedPath = realpathSync(path)
  if (resolvedPath !== resolvedRoot.slice(0, -1) && !resolvedPath.startsWith(resolvedRoot)) {
    throw new Error(`Offline SDK symlink escapes its profile root: ${path}`)
  }
}

function inventorySummary(root: string): InventorySummary {
  const digest = createHash('sha256')
  let fileCount = 0
  let byteCount = 0
  const visit = (directory: string): void => {
    for (const name of readdirSync(directory).sort((left, right) => left.localeCompare(right, 'en'))) {
      const path = join(directory, name)
      const relativePath = relative(root, path).split(sep).join('/')
      const stat = lstatSync(path)
      if (stat.isDirectory()) {
        digest.update(`D\0${relativePath}\0`)
        visit(path)
      } else if (stat.isSymbolicLink()) {
        assertInsideRoot(root, path)
        const target = readlinkSync(path)
        digest.update(`L\0${relativePath}\0${target}\0`)
      } else if (stat.isFile()) {
        const bytes = readFileSync(path)
        fileCount += 1
        byteCount += bytes.length
        digest.update(`F\0${relativePath}\0${bytes.length}\0`)
        digest.update(createHash('sha256').update(bytes).digest())
      } else {
        throw new Error(`Unsupported offline SDK entry: ${path}`)
      }
    }
  }
  visit(root)
  return { fileCount, byteCount, sha256: digest.digest('hex') }
}

function assertRequiredSDKFiles(androidRoot: string, iosRoot: string): void {
  const required = [
    join(androidRoot, 'license.md'),
    join(androidRoot, 'SDK/libs/lib.5plus.base-release.aar'),
    join(androidRoot, 'SDK/libs/uniapp-v8-release.aar'),
    join(androidRoot, 'SDK/libs/utsplugin-release.aar'),
    join(androidRoot, 'HBuilder-HelloUniApp'),
    join(androidRoot, 'HBuilder-Integrate-AS'),
    join(androidRoot, 'UniPlugin-Hello-AS'),
    join(iosRoot, 'license.md'),
    join(iosRoot, 'SDK/UTS/DCloudUTSConfig.h'),
    join(iosRoot, 'SDK/Libs/liblibUI.a'),
    join(iosRoot, 'HBuilder-Hello'),
    join(iosRoot, 'HBuilder-uniPluginDemo'),
  ]
  for (const path of required) {
    if (!existsSync(path)) throw new Error(`Offline SDK profile is missing required path: ${path}`)
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

function activationScript(profile: OfflineSDKProfile): string {
  return [
    '# Generated by OpenIM DCloud offline SDK installer. Do not edit.',
    `export OPENIM_DCLOUD_OFFLINE_SDK_PROFILE=${shellQuote(profile.paths.profilePath)}`,
    `export OPENIM_DCLOUD_UNIAPP_ANDROID_SDK_ROOT=${shellQuote(profile.paths.androidSDKRoot)}`,
    `export OPENIM_DCLOUD_UNIAPP_IOS_SDK_ROOT=${shellQuote(profile.paths.iosSDKRoot)}`,
    '',
  ].join('\n')
}

function profileDocument(profileRoot: string, input: InstallOfflineSDKProfileInput, android: InstalledArchive, ios: InstalledArchive): OfflineSDKProfile {
  const profilePath = join(profileRoot, 'profile.json')
  return {
    schemaVersion: 1,
    profileID: input.profileID,
    hbuilderxVersion: input.hbuilderxVersion,
    distribution: input.distribution,
    dirty: false,
    paths: {
      profileRoot,
      profilePath,
      activationScript: join(profileRoot, 'activate.zsh'),
      androidSDKRoot: join(profileRoot, 'uniapp/android'),
      iosSDKRoot: join(profileRoot, 'uniapp/ios'),
    },
    sources: { android, ios },
    profilePath,
  }
}

function readProfile(path: string): OfflineSDKProfile {
  return JSON.parse(readFileSync(path, 'utf8')) as OfflineSDKProfile
}

export function verifyOfflineSDKProfile(profilePath: string): OfflineSDKProfile {
  const profile = readProfile(profilePath)
  assertRequiredSDKFiles(profile.paths.androidSDKRoot, profile.paths.iosSDKRoot)
  for (const [label, source] of [['Android', profile.sources.android], ['iOS', profile.sources.ios]] as const) {
    if (!existsSync(source.preservedArchivePath)) throw new Error(`${label} preserved offline SDK archive is missing: ${source.preservedArchivePath}`)
    const actualArchiveSha256 = fileSha256Sync(source.preservedArchivePath)
    if (actualArchiveSha256 !== source.archiveSha256) throw new Error(`${label} preserved offline SDK archive SHA-256 does not match ${profile.profileID}`)
  }
  const actualAndroid = inventorySummary(profile.paths.androidSDKRoot)
  const actualIOS = inventorySummary(profile.paths.iosSDKRoot)
  if (JSON.stringify(actualAndroid) !== JSON.stringify(profile.sources.android.inventory)) {
    throw new Error(`Installed Android offline SDK inventory does not match ${profile.profileID}`)
  }
  if (JSON.stringify(actualIOS) !== JSON.stringify(profile.sources.ios.inventory)) {
    throw new Error(`Installed iOS offline SDK inventory does not match ${profile.profileID}`)
  }
  return profile
}

function existingProfileMatches(profile: OfflineSDKProfile, input: InstallOfflineSDKProfileInput): boolean {
  return profile.profileID === input.profileID &&
    profile.hbuilderxVersion === input.hbuilderxVersion &&
    profile.distribution === input.distribution &&
    profile.sources.android.archiveSha256 === input.android.sha256 &&
    profile.sources.ios.archiveSha256 === input.ios.sha256
}

export async function installOfflineSDKProfile(input: InstallOfflineSDKProfileInput): Promise<OfflineSDKProfile> {
  assertSafeIdentifier(input.profileID, 'profileID')
  assertSafeIdentifier(input.hbuilderxVersion, 'hbuilderxVersion')
  assertSha256(input.android.sha256, 'Android archive SHA-256')
  assertSha256(input.ios.sha256, 'iOS archive SHA-256')
  const toolchainsRoot = resolve(input.toolchainsRoot)
  const profileRoot = join(toolchainsRoot, input.profileID)
  const existingProfilePath = join(profileRoot, 'profile.json')
  if (existsSync(profileRoot)) {
    if (!existsSync(existingProfilePath)) throw new Error(`Offline SDK profile root already exists without a profile: ${profileRoot}`)
    const existing = verifyOfflineSDKProfile(existingProfilePath)
    if (!existingProfileMatches(existing, input)) throw new Error(`Offline SDK profile already exists with different immutable inputs: ${input.profileID}`)
    return existing
  }

  for (const [label, archive] of [['Android', input.android], ['iOS', input.ios]] as const) {
    if (!statSync(archive.archivePath).isFile()) throw new Error(`${label} offline SDK archive is not a file: ${archive.archivePath}`)
    const actual = await fileSha256(archive.archivePath)
    if (actual !== archive.sha256) throw new Error(`${label} offline SDK archive SHA-256 mismatch: expected ${archive.sha256}, got ${actual}`)
    validateArchiveEntries(archive.archivePath)
  }

  mkdirSync(toolchainsRoot, { recursive: true })
  const stagingRoot = join(toolchainsRoot, `.${input.profileID}.staging-${process.pid}-${randomUUID()}`)
  try {
    const extractAndroid = join(stagingRoot, 'extract-android')
    const extractIOS = join(stagingRoot, 'extract-ios')
    mkdirSync(extractAndroid, { recursive: true })
    mkdirSync(extractIOS, { recursive: true })
    execFileSync('ditto', ['-x', '-k', input.android.archivePath, extractAndroid])
    execFileSync('ditto', ['-x', '-k', input.ios.archivePath, extractIOS])
    removeArchiveMetadata(extractAndroid)
    removeArchiveMetadata(extractIOS)

    const extractedAndroidRoot = join(extractAndroid, input.android.archiveRoot)
    const extractedIOSRoot = join(extractIOS, input.ios.archiveRoot)
    assertRequiredSDKFiles(extractedAndroidRoot, extractedIOSRoot)

    const stagedProfileRoot = join(stagingRoot, 'profile')
    mkdirSync(join(stagedProfileRoot, 'uniapp'), { recursive: true })
    mkdirSync(join(stagedProfileRoot, 'archives'), { recursive: true })
    renameSync(extractedAndroidRoot, join(stagedProfileRoot, 'uniapp/android'))
    renameSync(extractedIOSRoot, join(stagedProfileRoot, 'uniapp/ios'))
    copyFileSync(input.android.archivePath, join(stagedProfileRoot, 'archives/android.zip'))
    copyFileSync(input.ios.archivePath, join(stagedProfileRoot, 'archives/ios.zip'))
    const androidInventory = inventorySummary(join(stagedProfileRoot, 'uniapp/android'))
    const iosInventory = inventorySummary(join(stagedProfileRoot, 'uniapp/ios'))
    const profile = profileDocument(profileRoot, input, {
      archiveFileName: basename(input.android.archivePath),
      archiveSha256: input.android.sha256,
      archiveRoot: input.android.archiveRoot,
      preservedArchivePath: join(profileRoot, 'archives/android.zip'),
      inventory: androidInventory,
    }, {
      archiveFileName: basename(input.ios.archivePath),
      archiveSha256: input.ios.sha256,
      archiveRoot: input.ios.archiveRoot,
      preservedArchivePath: join(profileRoot, 'archives/ios.zip'),
      inventory: iosInventory,
    })
    writeFileSync(join(stagedProfileRoot, 'profile.json'), `${JSON.stringify(profile, null, 2)}\n`)
    writeFileSync(join(stagedProfileRoot, 'activate.zsh'), activationScript(profile), { mode: 0o644 })
    renameSync(stagedProfileRoot, profileRoot)
    return verifyOfflineSDKProfile(existingProfilePath)
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true })
  }
}

export function resolveOfflineSDKProfile(options: { profilePath?: string; toolchainsRoot?: string; profileID?: string } = {}): OfflineSDKProfile {
  const environmentProfile = process.env.OPENIM_DCLOUD_OFFLINE_SDK_PROFILE
  const explicitPath = options.profilePath ?? environmentProfile
  const profilePath = explicitPath != null && explicitPath !== ''
    ? resolve(explicitPath)
    : resolve(
      options.toolchainsRoot ?? process.env.OPENIM_DCLOUD_OFFLINE_TOOLCHAINS_ROOT ?? join(process.env.HOME ?? '', 'Library/Application Support/OpenIM/DCloudToolchains'),
      options.profileID ?? process.env.OPENIM_DCLOUD_OFFLINE_PROFILE_ID ?? '',
      'profile.json',
    )
  if (!existsSync(profilePath)) throw new Error(`DCloud offline SDK profile is unavailable: ${profilePath}`)
  return verifyOfflineSDKProfile(profilePath)
}
