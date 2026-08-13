import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { archiveRuntimeArtifacts, cleanupLocalRun, listLocalRuns, localMatrixCells, LocalRuntimeLock, prepareStableProject, resolveProductDescriptor } from '../src/local-runtime-matrix.js'
import { configureNativeAndroid } from '../../local-runtime/scripts/configure-native-android.mjs'

function write(path: string, source: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, source)
}

function fixture(): { root: string; workspace: string; descriptor: string } {
  const root = mkdtempSync(join(tmpdir(), 'openim-local-matrix-'))
  execFileSync('git', ['init', '-q', root])
  execFileSync('git', ['-C', root, 'config', 'user.name', 'Test'])
  execFileSync('git', ['-C', root, 'config', 'user.email', 'test@example.invalid'])
  write(join(root, 'App.uvue'), '<template><view /></template>\n')
  write(join(root, 'main.uts'), 'import App from "./App.uvue"\n')
  write(join(root, 'manifest.json'), '{"appid":"__UNI__SOURCE","app-android":{},"app-ios":{}}\n')
  write(join(root, 'pages.json'), '{"pages":[]}\n')
  write(join(root, 'uni_modules/unix-openim-sdk/package.json'), '{"id":"unix-openim-sdk"}\n')
  const descriptor = join(root, 'local-runtime/products/public.json')
  write(descriptor, `${JSON.stringify({
    schemaVersion: 1,
    id: 'public',
    displayName: 'Public',
    repositoryRoot: '../..',
    uniappxSource: '../..',
    plugins: [{ id: 'unix-openim-sdk', source: '../../uni_modules/unix-openim-sdk' }],
    applicationIDs: {
      'uniapp-vue2': 'io.openim.local.public.uniappvue2',
      'uniapp-vue3': 'io.openim.local.public.uniappvue3',
      uniappx: 'io.openim.local.public.uniappx',
    },
    dcloudAppIDs: { 'uniapp-vue2': '__UNI__V2', 'uniapp-vue3': '__UNI__V3', uniappx: '__UNI__X' },
  }, null, 2)}\n`)
  execFileSync('git', ['-C', root, 'add', '.'])
  execFileSync('git', ['-C', root, 'commit', '-qm', 'fixture'])
  return { root, workspace: mkdtempSync(join(tmpdir(), 'openim-local-matrix-workspace-')), descriptor }
}

test('stable staging creates all three surfaces without mutating product sources', () => {
  const item = fixture()
  const descriptor = resolveProductDescriptor(item.descriptor)
  const before = execFileSync('git', ['-C', item.root, 'status', '--porcelain'], { encoding: 'utf8' })
  for (const surface of ['uniapp-vue2', 'uniapp-vue3', 'uniappx'] as const) {
    const project = prepareStableProject(descriptor, surface, item.workspace)
    const manifest = JSON.parse(readFileSync(join(project, 'manifest.json'), 'utf8'))
    assert.equal(manifest.name, `openim-public-${surface}`)
    assert.equal(manifest['app-android'].packageName, descriptor.applicationIDs[surface])
    assert.equal(manifest['app-ios'].bundleIdentifier, descriptor.applicationIDs[surface])
    assert.deepEqual(manifest['app-android'].distribute.modules['uni-websocket'], {})
    assert.deepEqual(manifest['app-ios'].distribute.modules['uni-websocket'], {})
    assert.equal(readFileSync(join(project, 'uni_modules/unix-openim-sdk/package.json'), 'utf8').includes('unix-openim-sdk'), true)
  }
  assert.equal(execFileSync('git', ['-C', item.root, 'status', '--porcelain'], { encoding: 'utf8' }), before)
})

test('stable staging retries bounded cleanup for large native framework trees', () => {
  const source = readFileSync(join(import.meta.dirname, '../src/local-runtime-matrix.ts'), 'utf8')

  assert.match(source, /rmSync\(backup, \{ recursive: true, force: true, maxRetries: 5, retryDelay: 200 \}\)/)
  assert.match(source, /rmSync\(staging, \{ recursive: true, force: true, maxRetries: 5, retryDelay: 200 \}\)/)
})

test('product descriptors resolve explicit environment-backed delivery inputs without persisting machine paths', () => {
  const item = fixture()
  const document = JSON.parse(readFileSync(item.descriptor, 'utf8'))
  document.plugins[0].source = '${OPENIM_TEST_PLUGIN_SOURCE}'
  writeFileSync(item.descriptor, `${JSON.stringify(document, null, 2)}\n`)
  process.env.OPENIM_TEST_PLUGIN_SOURCE = join(item.root, 'uni_modules/unix-openim-sdk')
  try {
    const descriptor = resolveProductDescriptor(item.descriptor)
    assert.equal(descriptor.plugins[0]!.source, realpathSync(process.env.OPENIM_TEST_PLUGIN_SOURCE!))
  } finally {
    delete process.env.OPENIM_TEST_PLUGIN_SOURCE
  }
})

test('product descriptors may supply canonical traditional surface sources', () => {
  const item = fixture()
  write(join(item.root, 'canonical-vue3/App.vue'), '<template><view>canonical AV host</view></template>\n')
  write(join(item.root, 'canonical-vue3/main.js'), 'export function createApp() {}\n')
  write(join(item.root, 'canonical-vue3/manifest.json'), '{"appid":"__UNI__SOURCE","app-android":{},"app-ios":{}}\n')
  write(join(item.root, 'canonical-vue3/pages.json'), '{"pages":[]}\n')
  const document = JSON.parse(readFileSync(item.descriptor, 'utf8'))
  document.surfaceSources = { 'uniapp-vue3': '../../canonical-vue3' }
  writeFileSync(item.descriptor, `${JSON.stringify(document, null, 2)}\n`)
  const descriptor = resolveProductDescriptor(item.descriptor)
  const project = prepareStableProject(descriptor, 'uniapp-vue3', item.workspace)
  assert.match(readFileSync(join(project, 'App.vue'), 'utf8'), /canonical AV host/)
  assert.equal(JSON.parse(readFileSync(join(project, 'manifest.json'), 'utf8')).vueVersion, '3')
})

test('Public descriptor never aliases the uni-app x page into a traditional Vue page', () => {
  const descriptor = JSON.parse(
    readFileSync(join(import.meta.dirname, '../..', 'local-runtime/products/public.json'), 'utf8'),
  ) as {
    automationAssets?: Array<{ source?: string; destination?: string; surfaces?: string[] }>
  }
  const invalid = (descriptor.automationAssets ?? []).filter((asset) =>
    asset.source?.endsWith('.uvue') === true
      && asset.destination?.endsWith('.vue') === true
      && (asset.surfaces ?? []).some((surface) => surface.startsWith('uniapp-vue')),
  )
  assert.deepEqual(invalid, [])
})

test('global lock refuses live ownership and reclaims only a dead PID', () => {
  const root = mkdtempSync(join(tmpdir(), 'openim-local-lock-'))
  const document = { schemaVersion: 1 as const, pid: process.pid, runID: 'first', product: 'public', surface: 'uniappx' as const, platform: 'android' as const, deviceID: null, startedAt: new Date().toISOString() }
  const first = new LocalRuntimeLock(root, document)
  assert.throws(() => new LocalRuntimeLock(root, { ...document, runID: 'second' }), /already locked/)
  first.release()
  writeFileSync(join(root, 'global.lock.json'), `${JSON.stringify({ ...document, pid: 999999, runID: 'dead' })}\n`)
  const recovered = new LocalRuntimeLock(root, { ...document, runID: 'recovered' })
  recovered.release()
})

test('run listing and cleanup are bounded by evidence identity', () => {
  const root = mkdtempSync(join(tmpdir(), 'openim-local-runs-'))
  write(join(root, '.runs/run-a/evidence.json'), `${JSON.stringify({ schema: 'io.openim.uni.local-runtime-evidence/v1', runID: 'run-a' })}\n`)
  assert.equal(listLocalRuns(root).length, 1)
  cleanupLocalRun(root, 'run-a')
  assert.equal(listLocalRuns(root).length, 0)
  mkdirSync(join(root, '.runs/not-a-run'), { recursive: true })
  assert.throws(() => cleanupLocalRun(root, 'not-a-run'), /unrecognized/)
  assert.throws(() => cleanupLocalRun(root, '../escape'), /Invalid runID/)
})

test('assembled APK and app evidence is archived below the immutable run directory', () => {
  const root = mkdtempSync(join(tmpdir(), 'openim-local-artifact-archive-'))
  const runRoot = join(root, 'run-a')
  mkdirSync(runRoot, { recursive: true })
  write(join(root, 'source.apk'), 'apk bytes')
  write(join(root, 'Source.app/Info.plist'), 'app bytes')

  const archived = archiveRuntimeArtifacts({
    apkPath: join(root, 'source.apk'),
    appPath: join(root, 'Source.app'),
    apkSha256: 'fixture',
  }, runRoot)

  assert.equal(readFileSync(archived.apkPath!, 'utf8'), 'apk bytes')
  assert.equal(readFileSync(join(archived.appPath!, 'Info.plist'), 'utf8'), 'app bytes')
  assert.equal(archived.apkSha256, 'fixture')
  assert.equal(archived.apkPath!.startsWith(join(runRoot, 'artifacts')), true)
  assert.equal(archived.appPath!.startsWith(join(runRoot, 'artifacts')), true)
})

test('evidence binds both product source and the shared runner revision', () => {
  const source = readFileSync(new URL('../src/local-runtime-matrix.ts', import.meta.url), 'utf8')
  assert.match(source, /runner: sourceIdentity\(runnerRoot\)/)
})

test('matrix tiers implement the promised compile, smoke and full coverage', () => {
  const pr = localMatrixCells('pr')
  assert.equal(pr.length, 6)
  assert.equal(pr.every((cell) => cell.command === 'build' && cell.suite === 'smoke'), true)

  for (const tier of ['nightly', 'rc'] as const) {
    const cells = localMatrixCells(tier)
    assert.equal(cells.length, 6)
    assert.deepEqual(cells.filter((cell) => cell.surface === 'uniapp-vue2').map((cell) => cell.command), ['run', 'run'])
    assert.equal(cells.filter((cell) => cell.surface !== 'uniapp-vue2').every((cell) => cell.command === 'test' && cell.suite === 'full'), true)
  }
})

test('runner source rejects HBuilder and native compiler failures hidden behind exit zero', () => {
  const source = readFileSync(new URL('../src/local-runtime-matrix.ts', import.meta.url), 'utf8')
  assert.match(source, /\\\[tsl\\\]\\s\+ERROR/)
  assert.match(source, /BUILD FAILED/)
  assert.match(source, /reported a compiler failure despite exiting successfully/)
  assert.match(source, /OPENIM_LOCAL_CLASSIC_VIDEO: descriptor\.classicVideo === true \? '1' : '0'/)
  assert.match(source, /OPENIM_DCLOUD_APP_KEY_ANDROID/)
  assert.match(source, /OPENIM_DCLOUD_APP_KEY_IOS/)
  assert.match(source, /required for traditional uni-app runtime acceptance/)
})

test('uni-app x iOS host builds only the simulator architecture exported by HBuilderX', () => {
  const source = readFileSync(new URL('../../local-runtime/hosts/build-uniappx-ios.sh', import.meta.url), 'utf8')
  const configure = readFileSync(new URL('../../local-runtime/hosts/configure-uniappx-ios.mjs', import.meta.url), 'utf8')
  assert.match(source, /DCloudUTSExtAPI\.framework\/DCloudUTSExtAPI/)
  assert.match(source, /lipo -archs/)
  assert.match(source, /ARCHS="\$exported_archs"/)
  assert.match(source, /ONLY_ACTIVE_ARCH=YES/)
  assert.match(source, /descriptor\.plugins/)
  assert.match(source, /XCFrameworkIntermediates\/\$pod_name/)
  assert.match(source, /Duplicate embedded framework/)
  assert.match(source, /Expected generated iOS wrapper framework/)
  assert.match(configure, /s\.exclude_files = \['src\/Tests\/\*\*\/\*'\]/)
  assert.match(configure, /openimLocalRuntimeAutoStart/)
  assert.match(configure, /pushWithDefaultAnimation/)
  assert.match(configure, /OTHER_LDFLAGS/)
  assert.match(configure, /\$\(inherited\) -ObjC/)
  assert.match(source, /current ar archive/)
  assert.match(source, /Removed static framework from generated app bundle/)
  assert.match(source, /codesign --force --sign - "\$framework"/)
  assert.match(source, /codesign --force --deep --sign - "\$app"/)
  assert.match(source, /codesign --verify --deep --strict "\$app"/)
  assert.doesNotMatch(source, /codesign --verify --deep --strict "\$app"[^\n]*\|\| true/)
})

test('iOS runtime smoke rejects a launched process that still renders a blank page', () => {
  const source = readFileSync(new URL('../../local-runtime/hosts/run-ios.sh', import.meta.url), 'utf8')
  assert.match(source, /OPENIM_LOCAL_IOS_READY_TIMEOUT_SECONDS:-20/)
  assert.match(source, /OPENIM_LOCAL_IOS_READY_POLL_SECONDS:-2/)
  assert.match(source, /while true/)
  assert.match(source, /SECONDS >= ready_deadline/)
  assert.match(source, /simctl io.*screenshot/)
  assert.match(source, /verify-nonblank-bmp\.mjs/)
})

test('Android runtime smoke waits for rendered product content', () => {
  const source = readFileSync(new URL('../../local-runtime/hosts/run-android.sh', import.meta.url), 'utf8')
  assert.match(source, /OPENIM_LOCAL_ANDROID_READY_TIMEOUT_SECONDS:-20/)
  assert.match(source, /OPENIM_LOCAL_ANDROID_READY_POLL_SECONDS:-2/)
  assert.match(source, /exec-out screencap -p/)
  assert.match(source, /verify-nonblank-bmp\.mjs/)
})

test('iOS runtime screenshot classifier rejects blank content and accepts rendered content', () => {
  const root = mkdtempSync(join(tmpdir(), 'openim-local-bmp-'))
  const makeBMP = (path: string, content: boolean, systemChrome = false): void => {
    const width = 32
    const height = 32
    const offset = 54
    const bytes = Buffer.alloc(offset + width * height * 4, 255)
    bytes.write('BM')
    bytes.writeUInt32LE(bytes.length, 2)
    bytes.writeUInt32LE(offset, 10)
    bytes.writeUInt32LE(40, 14)
    bytes.writeInt32LE(width, 18)
    bytes.writeInt32LE(-height, 22)
    bytes.writeUInt16LE(1, 26)
    bytes.writeUInt16LE(32, 28)
    if (content) bytes.fill(20, offset + width * 8 * 4, offset + width * 24 * 4)
    if (systemChrome) {
      for (let y = 0; y < height; y += 1) {
        bytes.fill(20, offset + (y * width) * 4, offset + (y * width + 2) * 4)
        bytes.fill(20, offset + (y * width + width - 2) * 4, offset + (y * width + width) * 4)
      }
      bytes.fill(20, offset + width * (height - 2) * 4)
    }
    writeFileSync(path, bytes)
  }
  const blank = join(root, 'blank.bmp')
  const chromeOnly = join(root, 'chrome-only.bmp')
  const content = join(root, 'content.bmp')
  makeBMP(blank, false)
  makeBMP(chromeOnly, false, true)
  makeBMP(content, true)
  const checker = new URL('../../local-runtime/hosts/verify-nonblank-bmp.mjs', import.meta.url)
  const rejected = spawnSync(process.execPath, [checker.pathname, blank], { encoding: 'utf8' })
  assert.notEqual(rejected.status, 0)
  assert.match(rejected.stderr, /blank page/)
  const chromeRejected = spawnSync(process.execPath, [checker.pathname, chromeOnly], { encoding: 'utf8' })
  assert.notEqual(chromeRejected.status, 0)
  assert.match(chromeRejected.stderr, /blank page/)
  assert.match(execFileSync(process.execPath, [checker.pathname, content], { encoding: 'utf8' }), /content ratio/)
})

test('classic Android host removes legacy manifest package declarations from generated plugins', () => {
  const source = readFileSync(new URL('../../local-runtime/hosts/configure-classic-android.mjs', import.meta.url), 'utf8')
  assert.match(source, /replace\(\/\\s\+package=/)
  assert.match(source, /src\/main\/AndroidManifest\.xml/)
  assert.match(source, /descriptor\.androidHost\?\.minSdk/)
  assert.match(source, /replace\(\/minSdkVersion\\s\+\\d\+\//)
  assert.match(source, /pluginDocument\?\.androidNamespace/)
  assert.match(source, /buildFeatures \{ buildConfig true \}/)
  assert.match(source, /UTSHooksClassArray/)
  assert.match(source, /UTSRegisterComponents/)
  assert.match(source, /UTSEasyCom/)
  assert.match(source, /useLegacyPackaging true/)
  assert.match(source, /android:extractNativeLibs="true"/)
  const build = readFileSync(new URL('../../local-runtime/hosts/build-classic-android.sh', import.meta.url), 'utf8')
  assert.match(build, /classicAndroidLibraries/)
  assert.match(build, /Required classic Android library is missing/)
})

test('classic iOS host aligns every plugin to the product deployment target', () => {
  const source = readFileSync(new URL('../../local-runtime/hosts/configure-classic-ios.mjs', import.meta.url), 'utf8')
  assert.match(source, /descriptor\.iosHost\?\.deploymentTarget/)
  assert.match(source, /config\.deploymentTarget = deploymentTarget/)
  assert.match(source, /platform :ios, '\$\{deploymentTarget\}'/)
  assert.match(source, /OPENIM_DCLOUD_APP_KEY_IOS/)
  assert.match(source, /dcloud_appkey/)
  const build = readFileSync(new URL('../../local-runtime/hosts/build-classic-ios.sh', import.meta.url), 'utf8')
  assert.match(build, /IPHONEOS_DEPLOYMENT_TARGET="\$deployment_target"/)
  const common = readFileSync(new URL('../../local-runtime/scripts/common.sh', import.meta.url), 'utf8')
  assert.match(common, /iosHost\?\.requiredFrameworks/)
  assert.match(common, /iosHost\?\.uniappxRequiredFrameworks/)
  assert.match(common, /Expected exactly one \$framework\.framework/)
  assert.doesNotMatch(common, /verify_required_ios_frameworks\(\) \{\n\s+local app=/)
})

test('uni-app x Android host derives a multi-plugin dependency graph from the product descriptor', () => {
  const root = mkdtempSync(join(tmpdir(), 'openim-local-android-host-'))
  cpSync(new URL('../../local-runtime/native-android-template', import.meta.url), root, { recursive: true })
  const avTemplate = join(root, 'av-template.gradle')
  writeFileSync(avTemplate, readFileSync(join(root, 'plugin/build.gradle'), 'utf8'))
  configureNativeAndroid({
    manifest: { appid: '__UNI__MULTI' },
    root,
    descriptor: {
      androidHost: {
        minSdk: 24,
        abiFilters: ['arm64-v8a'],
        utsRegisterComponents: [{ name: 'video', class: 'example.VideoComponent' }],
      },
      plugins: [
        { id: 'unix-openim-sdk', androidNamespace: 'uts.sdk.modules.unixOpenimSdk' },
        { id: 'openim-av-runtime', androidNamespace: 'uts.sdk.modules.openimAvRuntime', dependencies: ['unix-openim-sdk'], androidGradleTemplate: avTemplate },
      ],
    },
    environment: { OPENIM_ANDROID_PACKAGE: 'io.openim.local.imav.uniappx' },
  })
  const settings = readFileSync(join(root, 'settings.gradle'), 'utf8')
  const app = readFileSync(join(root, 'app/build.gradle'), 'utf8')
  const page = readFileSync(join(root, 'uniappx/build.gradle'), 'utf8')
  const av = readFileSync(join(root, 'openim-av-runtime/build.gradle'), 'utf8')
  assert.match(settings, /include ':unix-openim-sdk'/)
  assert.match(settings, /include ':openim-av-runtime'/)
  assert.match(app, /minSdk 24/)
  assert.match(app, /abiFilters 'arm64-v8a'/)
  assert.match(app, /implementation project\(':openim-av-runtime'\)/)
  assert.match(page, /implementation project\(':openim-av-runtime'\)/)
  assert.match(app, /UTSRegisterComponents/)
  assert.match(app, /example\.VideoComponent/)
  assert.match(app, /\\\\\\"name/)
  assert.match(av, /namespace 'uts\.sdk\.modules\.openimAvRuntime'/)
  assert.match(av, /implementation project\(':unix-openim-sdk'\)/)
})
