import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import test from 'node:test'
import {
  automationTarget,
  inspectAndroidBaseEntries,
} from '../../scripts/lib/local-base-inspection.mjs'
import {
  buildAutomationEnvironment,
  renderAutomationEnvironment,
} from '../../local-runtime/scripts/configure-automation-env.mjs'
import { runWithLocalNativeProfile } from '../../local-runtime/scripts/run-with-local-native-profile.mjs'

const root = resolve(import.meta.dirname, '../..')

test('Public workspace exposes local build, run, and automation entrypoints for Android and iOS', () => {
  const packageDocument = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>
  }
  const scripts = packageDocument.scripts ?? {}

  assert.equal(scripts['local:build:android'], 'bash local-runtime/scripts/build-local-android.sh')
  assert.equal(scripts['local:run:android'], 'bash local-runtime/scripts/run-local-android.sh')
  assert.equal(scripts['local:test:android'], 'bash local-runtime/scripts/test-local-android.sh')
  assert.equal(scripts['local:build:ios'], 'bash local-runtime/scripts/build-local-ios.sh')
  assert.equal(scripts['local:run:ios'], 'bash local-runtime/scripts/run-local-ios.sh')
  assert.equal(scripts['local:test:ios'], 'bash local-runtime/scripts/test-local-ios.sh')
})

test('local runtime harness is source-only and carries every regenerable entrypoint', () => {
  const required = [
    'README.md',
    'harness-lock.json',
    'scripts/build-local-android.sh',
    'scripts/rebuild-local-android-automation.sh',
    'scripts/run-local-android.sh',
    'scripts/test-local-android.sh',
    'scripts/build-local-ios.sh',
    'scripts/run-local-ios.sh',
    'scripts/test-local-ios.sh',
    'scripts/configure-native-android.mjs',
    'scripts/configure-automation-env.mjs',
    'scripts/prepare-local-native-artifacts.mjs',
    'scripts/prepare-automation-test-runtime.sh',
    'scripts/run-with-local-native-profile.mjs',
    'scripts/run-hbuilder-local.mjs',
    'scripts/provision-isolated-openim-server.sh',
    'server/configure-isolated-openim-server.rb',
    'server/start-isolated-openim-server.sh',
    'server/stop-isolated-openim-server.sh',
    'native-android-template/settings.gradle',
    'native-android-template/build.gradle',
    'native-android-template/gradle.properties',
    'native-android-template/gradle/libs.versions.toml',
    'native-android-template/app/build.gradle',
    'native-android-template/app/src/main/AndroidManifest.xml',
    'native-android-template/app/src/main/res/drawable/icon.xml',
    'native-android-template/uniappx/build.gradle',
    'native-android-template/unix-openim-sdk/build.gradle',
  ]

  for (const relativePath of required) {
    assert.equal(
      statSync(resolve(root, 'local-runtime', relativePath)).isFile(),
      true,
      relativePath,
    )
  }
})

test('local Android SDK host is classified as VDOM when websocket and UniAppActivity are embedded', () => {
  const result = inspectAndroidBaseEntries({
    dexPayloads: [
      Buffer.from('Luts/sdk/modules/DCloudUniWebsocket/;Lio/dcloud/uniapp/UniAppActivity;'),
    ],
  })
  assert.deepEqual(result, {
    hasWebSocket: true,
    hasVaporRuntime: false,
    hasClassicRuntime: true,
  })
})

test('local Android host embeds the DCloud automation pull activity used by uniapp.test', () => {
  const source = readFileSync(resolve(root, 'local-runtime/scripts/build-local-android.sh'), 'utf8')
  const rebuild = readFileSync(resolve(root, 'local-runtime/scripts/rebuild-local-android-automation.sh'), 'utf8')
  const gradle = readFileSync(resolve(root, 'local-runtime/native-android-template/app/build.gradle'), 'utf8')
  assert.match(source, /debug-server-release\.aar/)
  assert.match(source, /PullDebugActivity/)
  assert.match(gradle, /debugImplementation 'com\.squareup\.leakcanary:leakcanary-android:2\.14'/)
  assert.match(source, /uni-showLoading-release\.aar/)
  assert.match(source, /uni-modal-release\.aar/)
  assert.match(source, /uni-actionSheet-release\.aar/)
  assert.match(rebuild, /cache\/\.app-android\/src\/index\.kt/)
  assert.match(rebuild, /OPENIM_AUTOMATOR_PORT/)
  assert.match(rebuild, /install -r -g/)
  assert.match(rebuild, /io\.dcloud\.uniapp\.UniAppActivity/)
})

test('iOS automation target follows simulator versus physical-device selection', () => {
  assert.equal(automationTarget('android', 'device'), 'app-android')
  assert.equal(automationTarget('ios', 'simulator'), 'app-ios-simulator')
  assert.equal(automationTarget('ios', 'device'), 'app-ios')
})

test('local iOS build compiles the simulator module before assembling the locked host', () => {
  const source = readFileSync(resolve(root, 'local-runtime/scripts/build-local-ios.sh'), 'utf8')
  assert.match(source, /run-with-local-native-profile\.mjs/)
  assert.match(source, /--compile true/)
  assert.match(source, /uts_standard_simulator/)
  assert.match(source, /plugins\/uniappx-launcher\/base\/Pandora_simulator\.app/)
  assert.match(source, /optool.*install/)
  assert.match(source, /compiled_wrapper_sha/)
  assert.match(source, /host_wrapper_sha/)
  assert.match(source, /HBuilderX did not produce an iOS local host/)
  assert.match(source, /unrecognized OpenIMCore UUID/)
})

test('local native profile restores the exact release config after a failed compile', () => {
  const temporary = mkdtempSync(resolve(tmpdir(), 'openim-public-local-profile-'))
  try {
    const configDirectory = resolve(temporary, 'uni_modules/unix-openim-sdk/utssdk/app-android')
    mkdirSync(configDirectory, { recursive: true })
    const configPath = resolve(configDirectory, 'config.json')
    const releaseBytes = '{\n  "dependencies": ["io.openim:core-sdk:3.8.3-patch15@aar"],\n  "minSdkVersion": 21\n}\n'
    const manifestBytes = '{\n  "appid": "__UNI__LOCAL",\n  "uni-app-x": { "vapor": true, "vapor-render-target": "bytecode" }\n}\n'
    writeFileSync(configPath, releaseBytes)
    writeFileSync(resolve(temporary, 'manifest.json'), manifestBytes)
    assert.throws(() => runWithLocalNativeProfile({
      root: temporary,
      platform: 'android',
      command: process.execPath,
      args: ['-e', 'process.exit(9)'],
    }), /exit code 9/)
    assert.equal(readFileSync(configPath, 'utf8'), releaseBytes)
    assert.equal(readFileSync(resolve(temporary, 'manifest.json'), 'utf8'), manifestBytes)
    assert.equal(existsSync(resolve(temporary, 'unpackage/local-runtime/native-profile/android.lock')), false)
    assert.equal(existsSync(resolve(temporary, 'unpackage/local-runtime/native-profile/android-config.backup')), false)
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
})

test('local native profile compiles source-render UTS without mutating the release manifest', () => {
  const temporary = mkdtempSync(resolve(tmpdir(), 'openim-public-local-render-profile-'))
  try {
    const configDirectory = resolve(temporary, 'uni_modules/unix-openim-sdk/utssdk/app-android')
    mkdirSync(configDirectory, { recursive: true })
    writeFileSync(resolve(configDirectory, 'config.json'), '{"dependencies":["locked"]}\n')
    const manifestPath = resolve(temporary, 'manifest.json')
    const manifestBytes = '{"appid":"__UNI__LOCAL","uni-app-x":{"vapor":true,"vapor-render-target":"bytecode"}}\n'
    writeFileSync(manifestPath, manifestBytes)
    const capturedPath = resolve(temporary, 'captured-manifest.json')
    const renderTargetPath = resolve(temporary, 'captured-render-target.txt')
    runWithLocalNativeProfile({
      root: temporary,
      platform: 'android',
      command: process.execPath,
      args: ['-e', 'const fs=require("node:fs"); fs.copyFileSync("manifest.json", process.env.CAPTURE_PATH); fs.writeFileSync(process.env.RENDER_TARGET_PATH, process.env.UNI_APP_X_VAPOR_RENDER_TARGET || "")'],
      environment: {
        ...process.env,
        CAPTURE_PATH: capturedPath,
        RENDER_TARGET_PATH: renderTargetPath,
      },
    })
    const duringCompile = JSON.parse(readFileSync(capturedPath, 'utf8'))
    assert.equal(duringCompile['uni-app-x'].vapor, false)
    assert.equal(duringCompile['uni-app-x']['vapor-render-target'], undefined)
    assert.equal(readFileSync(renderTargetPath, 'utf8'), '')
    assert.equal(readFileSync(manifestPath, 'utf8'), manifestBytes)
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
})

test('automation environment preserves Android and iOS bases without committing them', () => {
  const android = buildAutomationEnvironment({
    platform: 'android',
    basePath: '/tmp/android-base.apk',
    deviceID: 'emulator-local',
    appID: '__UNI__LOCAL',
    packageName: 'io.openim.public.local',
  })
  const both = buildAutomationEnvironment({
    previous: android,
    platform: 'ios',
    basePath: '/tmp/Pandora.app',
    deviceID: 'simulator-local',
    appID: '__UNI__LOCAL',
    packageName: 'io.dcloud.uniappx',
  })
  const rendered = renderAutomationEnvironment(both)
  assert.match(rendered, /android-base\.apk/)
  assert.match(rendered, /Pandora\.app/)
  assert.match(rendered, /is-custom-runtime/)
})

test('local runtime sources contain no tracked binaries, credentials, fixed server, or machine path', () => {
  const files: string[] = []
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name)
      if (entry.isDirectory()) walk(path)
      else files.push(path)
    }
  }
  walk(resolve(root, 'local-runtime'))
  const forbiddenBinary = /\.(?:aar|jar|apk|ipa|zip|xcframework)$/i
  const forbiddenSource = /(?:\/Users\/|\/Volumes\/|192\.168\.3\.34|openIM123|businessToken\s*[:=]\s*["'][^"']+)/
  for (const file of files) {
    assert.doesNotMatch(file, forbiddenBinary, file)
    const source = readFileSync(file, 'utf8')
    assert.doesNotMatch(source, forbiddenSource, file)
    if (file.endsWith('.sh')) execFileSync('bash', ['-n', file])
    if (file.endsWith('.mjs')) execFileSync(process.execPath, ['--check', file])
    if (file.endsWith('.json')) JSON.parse(source)
  }
})

test('isolated Public server harness cannot stop or reuse the commercial deployment', () => {
  const provision = readFileSync(resolve(root, 'local-runtime/scripts/provision-isolated-openim-server.sh'), 'utf8')
  const configure = readFileSync(resolve(root, 'local-runtime/server/configure-isolated-openim-server.rb'), 'utf8')
  const start = readFileSync(resolve(root, 'local-runtime/server/start-isolated-openim-server.sh'), 'utf8')
  const stop = readFileSync(resolve(root, 'local-runtime/server/stop-isolated-openim-server.sh'), 'utf8')

  assert.match(provision, /OPENIM_PUBLIC_SERVER_SSH/)
  assert.match(provision, /OPENIM_PUBLIC_SERVER_SOURCE/)
  assert.doesNotMatch(provision, /git[\s\S]*worktree[\s\S]*--detach/)
  assert.match(provision, /\.openim-public-test/)
  assert.match(configure, /openim-public-test/)
  assert.match(configure, /rootDirectory/)
  assert.match(configure, /openim-public-test-/)
  assert.match(configure, /Regexp\.last_match\(2\)/)
  assert.match(start, /pidfiles/)
  assert.match(start, /auth\/get_admin_token/)
  assert.match(start, /admin_token_ready/)
  assert.match(start, /share\.yml/)
  assert.doesNotMatch(start, /puts.*token|echo.*secret/)
  assert.match(stop, /OPENIM_PUBLIC_SERVER_SOURCE/)
  assert.match(stop, /command\.txt/)
  for (const source of [provision, configure, start, stop]) {
    assert.doesNotMatch(source, /mage\s+stop|killall|pkill/)
    assert.doesNotMatch(source, /192\.168\.3\.34|openIM123/)
  }
})

test('local harness lock follows the Public toolchain and iOS 14 contract', () => {
  const harness = JSON.parse(readFileSync(resolve(root, 'local-runtime/harness-lock.json'), 'utf8'))
  const toolchain = JSON.parse(readFileSync(resolve(root, 'toolchain.lock.json'), 'utf8'))
  assert.equal(harness.hbuilderx.version, toolchain.hbuilderx.version)
  assert.equal(harness.hbuilderx.cliSha256, toolchain.hbuilderx.cliSha256)
  assert.equal(harness.ios.minimumVersion, '14.0')
  assert.equal(harness.automation.hbuilderxPlugin, 'hbuilderx-for-uniapp-test')
  assert.equal(harness.automation.pluginVersion, '5.2.1')
  assert.equal(harness.automation.testLibraryVersion, '2.0.0')
})

test('local runtime tests prepare the official HBuilderX automation runtime without a global npm cache', () => {
  const preparePath = resolve(root, 'local-runtime/scripts/prepare-automation-test-runtime.sh')
  const androidTest = readFileSync(resolve(root, 'local-runtime/scripts/test-local-android.sh'), 'utf8')
  const iosTest = readFileSync(resolve(root, 'local-runtime/scripts/test-local-ios.sh'), 'utf8')
  const prepare = readFileSync(preparePath, 'utf8')

  assert.match(androidTest, /prepare-automation-test-runtime\.sh/)
  assert.match(iosTest, /prepare-automation-test-runtime\.sh/)
  assert.match(prepare, /automation\.hbuilderxPlugin/)
  assert.match(prepare, /installPlugin[\s\S]*--name[\s\S]*PLUGIN_NAME/)
  assert.match(prepare, /mktemp -d/)
  assert.match(prepare, /npm_config_cache/)
  assert.doesNotMatch(prepare, /rm\s+-rf\s+["']?\$?HOME/)
})

test('local automation pre-provisions accounts and requires an explicit server secret', () => {
  const runner = readFileSync(resolve(root, 'scripts/run-openim-automation.mjs'), 'utf8')
  const pageTest = readFileSync(resolve(root, 'pages/index/index.test.js'), 'utf8')
  const register = readFileSync(resolve(root, 'scripts/register-openim-test-accounts.mjs'), 'utf8')
  const androidTest = readFileSync(resolve(root, 'local-runtime/scripts/test-local-android.sh'), 'utf8')
  const iosTest = readFileSync(resolve(root, 'local-runtime/scripts/test-local-ios.sh'), 'utf8')

  assert.match(runner, /prepareAutomationAccountFixture/)
  assert.match(runner, /OPENIM_AUTOMATION_PREPROVISION/)
  assert.match(runner, /register-openim-test-accounts\.mjs/)
  assert.match(
    pageTest,
    /if \(Object\.prototype\.hasOwnProperty\.call\(existing, 'suiteFilter'\) \|\| process\.env\.OPENIM_AUTOMATION_REUSE === '1'\) \{\s*return\s*\}/,
  )
  assert.match(androidTest, /OPENIM_AUTOMATION_PREPROVISION=1/)
  assert.match(iosTest, /OPENIM_AUTOMATION_PREPROVISION=1/)
  assert.match(register, /env\.IM_SECRET \|\| ''/)
  assert.match(register, /IM_SECRET is required/)
  assert.doesNotMatch(register, /openIM123/)
})

test('Android automation runner rebuilds the static VDOM host for the allocated port', () => {
  const runner = readFileSync(resolve(root, 'scripts/run-openim-automation.mjs'), 'utf8')
  const androidTest = readFileSync(resolve(root, 'local-runtime/scripts/test-local-android.sh'), 'utf8')
  const androidRebuild = readFileSync(
    resolve(root, 'local-runtime/scripts/rebuild-local-android-automation.sh'),
    'utf8',
  )

  assert.match(androidTest, /OPENIM_LOCAL_ANDROID_AUTOMATION_REBUILD=1/)
  assert.match(runner, /OPENIM_LOCAL_ANDROID_AUTOMATION_REBUILD/)
  assert.match(runner, /rebuild-local-android-automation\.sh/)
  assert.match(runner, /allocatedRuntimePort/)
  assert.match(runner, /分配测试端口/)
  assert.match(runner, /automation resource sync/)
  assert.doesNotMatch(
    androidRebuild,
    /strings\s*\|\s*rg\s+-q/,
    'pipefail must not turn a successful endpoint match into an unzip SIGPIPE failure',
  )
})

test('local automation disables HBuilderX protocol debug while credentials cross the bridge', () => {
  const runner = readFileSync(resolve(root, 'scripts/run-openim-automation.mjs'), 'utf8')

  assert.match(runner, /hbuilderx-for-uniapp-test\.isDebug/)
  assert.match(runner, /disableAutomationProtocolDebug/)
  assert.match(runner, /restoreAutomationProtocolDebug/)
  assert.match(runner, /restoreAutomationEnvironment/)
  assert.match(runner, /'config', 'set', '--key', automationDebugConfigKey/)
  assert.match(runner, /writeAutomationProtocolDebug\('false'\)/)
})

test('local test wrappers restore env.js across the entire build, install, and automation chain', () => {
  for (const platform of ['android', 'ios']) {
    const source = readFileSync(
      resolve(root, `local-runtime/scripts/test-local-${platform}.sh`),
      'utf8',
    )
    assert.match(source, /local_automation_env_existed=false/)
    assert.match(source, /trap restore_local_automation_environment EXIT/)
    assert.match(source, /cp -p "\$local_automation_env_path" "\$local_automation_env_backup"/)
    assert.match(source, /rm -f "\$local_automation_env_path"/)
  }
})

test('iOS simulator automation primes the installed host before HBuilderX takes over relaunch', () => {
  const source = readFileSync(resolve(root, 'local-runtime/scripts/test-local-ios.sh'), 'utf8')
  assert.match(source, /OPENIM_TEST_VAPOR=false/)
  assert.doesNotMatch(source, /OPENIM_TEST_VAPOR=true/)
  assert.match(source, /PlistBuddy.+CFBundleIdentifier/)
  assert.match(source, /xcrun simctl launch "\$DEVICE_ID" "\$bundle_id"/)
  assert.ok(
    source.indexOf('xcrun simctl launch "$DEVICE_ID" "$bundle_id"')
      < source.indexOf('run-openim-automation.mjs" ios'),
  )
})

test('local iOS simulator run always replaces the installed host with the freshly compiled app', () => {
  const runner = readFileSync(resolve(root, 'local-runtime/scripts/run-local-ios.sh'), 'utf8')
  assert.match(runner, /simctl terminate "\$DEVICE_ID" "\$BUNDLE_ID"/)
  assert.match(runner, /simctl uninstall "\$DEVICE_ID" "\$BUNDLE_ID"/)
  assert.match(runner, /simctl install "\$DEVICE_ID" "\$APP_PATH"/)
  assert.doesNotMatch(runner, /if ! xcrun simctl get_app_container/)
})
