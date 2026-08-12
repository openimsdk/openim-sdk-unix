import { execFileSync, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  copyFileSync,
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'

export type UniSurfaceFamily = 'uniapp' | 'uniappx'
export type UniNativePlatform = 'android' | 'ios'

export interface UniToolchainArchiveInput {
  archivePath: string
  archiveRoot: string
  sha256: string
}

export interface UniToolchainCatalogArchive {
  archiveFileName: string
  archiveRoot: string
  sha256: string
}

export interface UniToolchainCatalogV2 {
  schemaVersion: 2
  profileID: string
  hbuilderx: {
    version: string
    distribution: 'alpha' | 'release'
    cliSha256: string
  }
  hostTools?: {
    javaMajor: string
    gradleVersion: string
    xcodeVersion: string
    swiftVersion: string
    cocoapodsVersion: string
  }
  sdks: Record<UniSurfaceFamily, Record<UniNativePlatform, UniToolchainCatalogArchive>>
}

export interface UniToolchainInventory {
  fileCount: number
  byteCount: number
  sha256: string
}

export interface InstalledUniSDK {
  archiveFileName: string
  archiveSha256: string
  archiveRoot: string
  archivePath: string
  sdkRoot: string
  inventory: UniToolchainInventory
}

export interface UniToolchainProfileV2 {
  schemaVersion: 2
  profileID: string
  dirty: false
  profilePath: string
  profileRoot: string
  activationScript: string
  hbuilderx: UniToolchainCatalogV2['hbuilderx']
  hostTools: {
    hbuilderxCli: HostToolIdentity
    java: HostToolIdentity
    gradle: HostToolIdentity
    androidSDK: HostDirectoryIdentity
    xcode: HostToolIdentity
    swift: HostToolIdentity
    cocoapods: HostToolIdentity
  }
  sdks: Record<UniSurfaceFamily, Record<UniNativePlatform, InstalledUniSDK>>
}

export interface HostToolIdentity {
  path: string
  version: string
  sha256?: string
}

export interface HostDirectoryIdentity {
  path: string
  buildToolsVersions: string[]
  ndkVersions: string[]
}

export interface InstallUniToolchainProfileV2Input {
  catalog: UniToolchainCatalogV2
  toolchainsRoot: string
  archives: Record<UniSurfaceFamily, Record<UniNativePlatform, UniToolchainArchiveInput>>
  observedHostTools?: UniToolchainProfileV2['hostTools']
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function assertSafeIdentifier(value: string, label: string): void {
  assert(/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value), `${label} is not a safe identifier: ${value}`)
}

function assertSha256(value: string, label: string): void {
  assert(/^[a-f0-9]{64}$/.test(value), `${label} must be a lowercase SHA-256 digest`)
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
  const entries = execFileSync('unzip', ['-Z1', archivePath], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\n')
    .filter(Boolean)
  assert(entries.length > 0, `Uni SDK archive is empty: ${archivePath}`)
  for (const entry of entries) {
    assert(!entry.startsWith('/') && !entry.includes('\\') && !entry.split('/').includes('..'), `Unsafe path in Uni SDK archive: ${entry}`)
  }
}

function removeArchiveMetadata(root: string): void {
  for (const name of readdirSync(root)) {
    const path = join(root, name)
    if (name === '__MACOSX' || name === '.DS_Store' || name === '.git' || name.startsWith('._')) {
      rmSync(path, { recursive: true, force: true })
      continue
    }
    if (lstatSync(path).isDirectory()) removeArchiveMetadata(path)
  }
}

function assertInsideRoot(root: string, path: string): void {
  const resolvedRoot = `${realpathSync(root)}${sep}`
  const resolvedPath = realpathSync(path)
  assert(resolvedPath === resolvedRoot.slice(0, -1) || resolvedPath.startsWith(resolvedRoot), `Uni SDK symlink escapes profile root: ${path}`)
}

export function uniToolchainInventory(root: string): UniToolchainInventory {
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
        digest.update(`L\0${relativePath}\0${readlinkSync(path)}\0`)
      } else if (stat.isFile()) {
        const bytes = readFileSync(path)
        fileCount += 1
        byteCount += bytes.length
        digest.update(`F\0${relativePath}\0${bytes.length}\0`)
        digest.update(createHash('sha256').update(bytes).digest())
      } else {
        throw new Error(`Unsupported Uni SDK entry: ${path}`)
      }
    }
  }
  visit(root)
  return { fileCount, byteCount, sha256: digest.digest('hex') }
}

function requiredPaths(family: UniSurfaceFamily, platform: UniNativePlatform, root: string): string[] {
  if (family === 'uniapp' && platform === 'android') {
    return [
      'SDK/libs/lib.5plus.base-release.aar',
      'SDK/libs/uniapp-v8-release.aar',
      'SDK/libs/utsplugin-release.aar',
      'UniPlugin-Hello-AS/app/build.gradle',
    ].map((path) => join(root, path))
  }
  if (family === 'uniapp' && platform === 'ios') {
    return [
      'SDK/UTS/DCloudUTSConfig.h',
      'SDK/Libs/DCloudUTSFoundation.framework',
      'HBuilder-Hello/HBuilder-Hello.xcodeproj/project.pbxproj',
      'HBuilder-Hello/UTSPlugins',
    ].map((path) => join(root, path))
  }
  if (family === 'uniappx' && platform === 'android') {
    return [
      'SDK/libs/uts-runtime-release.aar',
      'plugins/uts-kotlin-gradle-plugin-0.0.1.jar',
      'plugins/uts-kotlin-compiler-plugin-0.0.1.jar',
      'uniappxnativepackage/app/build.gradle',
      'uniappxnativepackage/uniappx/build.gradle',
    ].map((path) => join(root, path))
  }
  return [
    'SDK/Libs/DCloudUniappRuntime.xcframework/Info.plist',
    'SDK/Libs/DCloudUTSFoundation.xcframework/Info.plist',
    'UniAppXDemo/UniAppXDemo.xcodeproj/project.pbxproj',
    'UniAppXDemo/UniAppXDemo/UniAppBridge.swift',
  ].map((path) => join(root, path))
}

function verifyXCFrameworkSlices(infoPlist: string): void {
  const json = execFileSync('plutil', ['-convert', 'json', '-o', '-', infoPlist], { encoding: 'utf8' })
  const document = JSON.parse(json) as { AvailableLibraries?: Array<{ SupportedPlatform?: string; SupportedPlatformVariant?: string; SupportedArchitectures?: string[] }> }
  const libraries = document.AvailableLibraries ?? []
  assert(libraries.some((item) => item.SupportedPlatform === 'ios' && item.SupportedPlatformVariant == null && item.SupportedArchitectures?.includes('arm64') === true), `${infoPlist} has no iOS arm64 device slice`)
  assert(libraries.some((item) => item.SupportedPlatform === 'ios' && item.SupportedPlatformVariant === 'simulator' && item.SupportedArchitectures?.includes('arm64') === true && item.SupportedArchitectures?.includes('x86_64') === true), `${infoPlist} has no arm64/x86_64 simulator slice`)
}

function verifySDKRoot(family: UniSurfaceFamily, platform: UniNativePlatform, root: string): void {
  for (const path of requiredPaths(family, platform, root)) assert(existsSync(path), `Uni SDK profile is missing required path: ${path}`)
  if (family === 'uniappx' && platform === 'ios') {
    verifyXCFrameworkSlices(join(root, 'SDK/Libs/DCloudUniappRuntime.xcframework/Info.plist'))
    verifyXCFrameworkSlices(join(root, 'SDK/Libs/DCloudUTSFoundation.xcframework/Info.plist'))
  }
}

function executablePath(command: string): string {
  if (command.includes('/') && existsSync(command)) return realpathSync(command)
  const result = spawnSync('/usr/bin/which', [command], { encoding: 'utf8' })
  return result.status === 0 && result.stdout.trim() !== '' ? realpathSync(result.stdout.trim()) : 'unavailable'
}

function toolIdentity(command: string, args: string[], includeSha = false, environment: NodeJS.ProcessEnv = process.env): HostToolIdentity {
  const path = executablePath(command)
  if (path === 'unavailable') return { path, version: 'unavailable' }
  const result = spawnSync(path, args, { encoding: 'utf8', env: environment })
  const version = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim().replaceAll('\n', ' | ')
  assert(result.status === 0 && version !== '', `Unable to identify host tool: ${path}`)
  return { path, version, ...(includeSha ? { sha256: fileSha256Sync(path) } : {}) }
}

function directoryVersions(root: string, directory: string): string[] {
  const path = join(root, directory)
  if (!existsSync(path)) return []
  return readdirSync(path).filter((name) => !name.startsWith('.')).sort((left, right) => left.localeCompare(right, 'en'))
}

function resolveAndroidSDKRoot(): string {
  const candidates = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, join(process.env.HOME ?? '', 'Library/Android/sdk')]
  return candidates.find((candidate) => candidate != null && existsSync(candidate)) ?? 'unavailable'
}

function resolveGradle(expectedVersion?: string): string {
  const explicit = process.env.OPENIM_GRADLE_BIN
  if (explicit != null && existsSync(explicit)) return explicit
  const command = executablePath('gradle')
  if (command !== 'unavailable') return command
  const wrapperRoot = join(process.env.HOME ?? '', '.gradle/wrapper/dists')
  if (!existsSync(wrapperRoot)) return 'unavailable'
  const candidates: string[] = []
  const visit = (directory: string): void => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name)
      const stat = lstatSync(path)
      if (stat.isDirectory()) visit(path)
      else if (name === 'gradle' && path.includes('/bin/')) candidates.push(path)
    }
  }
  visit(wrapperRoot)
  if (expectedVersion != null) {
    const expected = candidates.find((path) => path.includes(`/gradle-${expectedVersion}/bin/gradle`))
    if (expected != null) return expected
  }
  return candidates.sort().at(-1) ?? 'unavailable'
}

function hostTools(catalog: UniToolchainCatalogV2): UniToolchainProfileV2['hostTools'] {
  const hbuilderxCandidates = [
    process.env.OPENIM_HBUILDERX_CLI,
    '/Applications/HBuilderX-Alpha.app/Contents/MacOS/cli',
    '/Applications/HBuilderX.app/Contents/MacOS/cli',
  ]
  const hbuilderxCli = hbuilderxCandidates.find((path) => path != null && existsSync(path))
  assert(hbuilderxCli != null, 'HBuilderX CLI is unavailable')
  const hbuilderIdentity = toolIdentity(hbuilderxCli, ['version'], true)
  assert(hbuilderIdentity.sha256 === catalog.hbuilderx.cliSha256, `HBuilderX CLI SHA-256 mismatch: ${hbuilderIdentity.path}`)
  const javaCandidates = [
    process.env.OPENIM_JAVA_BIN,
    '/Applications/HBuilderX-Alpha.app/Contents/HBuilderX/plugins/amazon-corretto/bin/java',
    '/Applications/HBuilderX.app/Contents/HBuilderX/plugins/amazon-corretto/bin/java',
    executablePath('java'),
  ]
  const java = javaCandidates.find((path) => path != null && path !== 'unavailable' && existsSync(path))
  assert(java != null, 'Java runtime is unavailable')
  const gradle = resolveGradle(catalog.hostTools?.gradleVersion)
  assert(gradle !== 'unavailable', 'Gradle runtime is unavailable')
  const androidSDKRoot = resolveAndroidSDKRoot()
  assert(androidSDKRoot !== 'unavailable', 'Android SDK is unavailable')
  const result: UniToolchainProfileV2['hostTools'] = {
    hbuilderxCli: hbuilderIdentity,
    java: toolIdentity(java, ['-version'], true),
    gradle: toolIdentity(gradle, ['--version'], true, { ...process.env, JAVA_HOME: dirname(dirname(realpathSync(java))) }),
    androidSDK: {
      path: realpathSync(androidSDKRoot),
      buildToolsVersions: directoryVersions(androidSDKRoot, 'build-tools'),
      ndkVersions: directoryVersions(androidSDKRoot, 'ndk'),
    },
    xcode: toolIdentity('xcodebuild', ['-version']),
    swift: toolIdentity('swift', ['--version']),
    cocoapods: toolIdentity('pod', ['--version']),
  }
  if (catalog.hostTools != null) {
    assert(result.java.version.includes(`version \"${catalog.hostTools.javaMajor}.`), `Java major version mismatch: ${result.java.version}`)
    assert(result.gradle.version.includes(`Gradle ${catalog.hostTools.gradleVersion}`), `Gradle version mismatch: ${result.gradle.version}`)
    assert(result.xcode.version.includes(`Xcode ${catalog.hostTools.xcodeVersion}`), `Xcode version mismatch: ${result.xcode.version}`)
    assert(result.swift.version.includes(`Swift version ${catalog.hostTools.swiftVersion}`), `Swift version mismatch: ${result.swift.version}`)
    assert(result.cocoapods.version === catalog.hostTools.cocoapodsVersion, `CocoaPods version mismatch: ${result.cocoapods.version}`)
  }
  return result
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

function activationScript(profile: UniToolchainProfileV2): string {
  return [
    '# Generated by OpenIM Uni toolchain installer. Do not edit.',
    `export OPENIM_UNI_TOOLCHAIN_PROFILE=${shellQuote(profile.profilePath)}`,
    '',
  ].join('\n')
}

function readProfile(profilePath: string): UniToolchainProfileV2 {
  const profile = JSON.parse(readFileSync(profilePath, 'utf8')) as UniToolchainProfileV2
  assert(profile.schemaVersion === 2, `Unsupported Uni toolchain profile schema: ${String(profile.schemaVersion)}`)
  return profile
}

export function verifyUniToolchainProfile(profilePath: string): UniToolchainProfileV2 {
  const profile = readProfile(resolve(profilePath))
  for (const family of ['uniapp', 'uniappx'] as const) {
    for (const platform of ['android', 'ios'] as const) {
      const sdk = profile.sdks[family][platform]
      verifySDKRoot(family, platform, sdk.sdkRoot)
      assert(existsSync(sdk.archivePath), `Preserved ${family}/${platform} archive is missing: ${sdk.archivePath}`)
      assert(fileSha256Sync(sdk.archivePath) === sdk.archiveSha256, `Preserved ${family}/${platform} archive SHA-256 mismatch`)
      assert(JSON.stringify(uniToolchainInventory(sdk.sdkRoot)) === JSON.stringify(sdk.inventory), `Installed ${family}/${platform} inventory mismatch`)
    }
  }
  return profile
}

function existingProfileMatches(profile: UniToolchainProfileV2, input: InstallUniToolchainProfileV2Input): boolean {
  if (profile.profileID !== input.catalog.profileID || profile.hbuilderx.cliSha256 !== input.catalog.hbuilderx.cliSha256) return false
  return (['uniapp', 'uniappx'] as const).every((family) =>
    (['android', 'ios'] as const).every((platform) => profile.sdks[family][platform].archiveSha256 === input.archives[family][platform].sha256),
  )
}

export async function installUniToolchainProfile(input: InstallUniToolchainProfileV2Input): Promise<UniToolchainProfileV2> {
  assert(input.catalog.schemaVersion === 2, 'Uni toolchain catalog must use schemaVersion 2')
  assertSafeIdentifier(input.catalog.profileID, 'profileID')
  const root = resolve(input.toolchainsRoot)
  const profileRoot = join(root, 'profiles', input.catalog.profileID)
  const profilePath = join(profileRoot, 'profile.json')
  if (existsSync(profileRoot)) {
    assert(existsSync(profilePath), `Uni toolchain profile root exists without profile.json: ${profileRoot}`)
    const existing = verifyUniToolchainProfile(profilePath)
    assert(existingProfileMatches(existing, input), `Uni toolchain profile exists with different immutable inputs: ${input.catalog.profileID}`)
    return existing
  }

  for (const family of ['uniapp', 'uniappx'] as const) {
    for (const platform of ['android', 'ios'] as const) {
      const archive = input.archives[family][platform]
      const catalogArchive = input.catalog.sdks[family][platform]
      assertSha256(archive.sha256, `${family}/${platform} SHA-256`)
      assert(archive.sha256 === catalogArchive.sha256 && archive.archiveRoot === catalogArchive.archiveRoot, `${family}/${platform} input does not match catalog`)
      assert(statSync(archive.archivePath).isFile(), `${family}/${platform} archive is not a file: ${archive.archivePath}`)
      const actual = await fileSha256(archive.archivePath)
      assert(actual === archive.sha256, `${family}/${platform} archive SHA-256 mismatch: expected ${archive.sha256}, got ${actual}`)
      validateArchiveEntries(archive.archivePath)
    }
  }

  mkdirSync(dirname(profileRoot), { recursive: true })
  const stagingRoot = join(dirname(profileRoot), `.${input.catalog.profileID}.staging-${process.pid}-${randomUUID()}`)
  try {
    const stagedProfile = join(stagingRoot, 'profile')
    mkdirSync(join(stagedProfile, 'archives'), { recursive: true })
    const installed = {} as UniToolchainProfileV2['sdks']
    for (const family of ['uniapp', 'uniappx'] as const) {
      installed[family] = {} as Record<UniNativePlatform, InstalledUniSDK>
      for (const platform of ['android', 'ios'] as const) {
        const archive = input.archives[family][platform]
        const extractRoot = join(stagingRoot, `extract-${family}-${platform}`)
        mkdirSync(extractRoot, { recursive: true })
        execFileSync('ditto', ['-x', '-k', archive.archivePath, extractRoot])
        removeArchiveMetadata(extractRoot)
        const extractedRoot = join(extractRoot, archive.archiveRoot)
        verifySDKRoot(family, platform, extractedRoot)
        const relativeSDKRoot = join('sdks', family, platform)
        const stagedSDKRoot = join(stagedProfile, relativeSDKRoot)
        mkdirSync(dirname(stagedSDKRoot), { recursive: true })
        renameSync(extractedRoot, stagedSDKRoot)
        const archiveName = `${family}-${platform}.zip`
        copyFileSync(archive.archivePath, join(stagedProfile, 'archives', archiveName))
        installed[family][platform] = {
          archiveFileName: basename(archive.archivePath),
          archiveSha256: archive.sha256,
          archiveRoot: archive.archiveRoot,
          archivePath: join(profileRoot, 'archives', archiveName),
          sdkRoot: join(profileRoot, relativeSDKRoot),
          inventory: uniToolchainInventory(stagedSDKRoot),
        }
      }
    }
    const profile: UniToolchainProfileV2 = {
      schemaVersion: 2,
      profileID: input.catalog.profileID,
      dirty: false,
      profilePath,
      profileRoot,
      activationScript: join(profileRoot, 'activate.zsh'),
      hbuilderx: input.catalog.hbuilderx,
      hostTools: input.observedHostTools ?? hostTools(input.catalog),
      sdks: installed,
    }
    writeFileSync(join(stagedProfile, 'profile.json'), `${JSON.stringify(profile, null, 2)}\n`)
    writeFileSync(join(stagedProfile, 'activate.zsh'), activationScript(profile), { mode: 0o644 })
    renameSync(stagedProfile, profileRoot)
    return verifyUniToolchainProfile(profilePath)
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true })
  }
}

export function resolveUniToolchainProfile(profilePath = process.env.OPENIM_UNI_TOOLCHAIN_PROFILE ?? ''): UniToolchainProfileV2 {
  assert(profilePath !== '', 'OPENIM_UNI_TOOLCHAIN_PROFILE is required')
  return verifyUniToolchainProfile(resolve(profilePath))
}
