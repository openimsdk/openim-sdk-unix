import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hasFailure, normalizeLog, runStreamingCommand, verifyToolchain } from './compile.js'
import { withLocalNativeProfile } from './native-profile.js'

type VueVersion = '2' | '3'
type Platform = 'android' | 'ios'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export interface TraditionalUniAppFixture {
  manifest: string
  pages: string
  app: string
  main: string
  page: string
  probe: string
}

export function traditionalUniAppFixtureFiles(vueVersion: VueVersion): TraditionalUniAppFixture {
  const main = vueVersion === '2'
    ? `import Vue from 'vue'\nimport App from './App'\n\nVue.config.productionTip = false\nApp.mpType = 'app'\nconst app = new Vue({ ...App })\napp.$mount()\n`
    : `import App from './App.vue'\nimport { createSSRApp } from 'vue'\n\nexport function createApp() {\n  const app = createSSRApp(App)\n  return { app }\n}\n`

  return {
    manifest: `${JSON.stringify({
      name: `unix-openim-sdk-uniapp-vue${vueVersion}-consumer`,
      appid: `__UNI__OPENIMV${vueVersion}`,
      versionName: '1.0.0',
      versionCode: '100',
      vueVersion,
      app: { distribute: {} },
      'app-android': { minSdkVersion: 21, distribute: {} },
      'app-ios': { deploymentTarget: '14.0', distribute: {} },
    }, null, 2)}\n`,
    pages: `${JSON.stringify({
      pages: [{ path: 'pages/index/index', style: { navigationBarTitleText: 'OpenIM consumer compile' } }],
      globalStyle: { navigationBarTextStyle: 'black', navigationBarBackgroundColor: '#ffffff' },
    }, null, 2)}\n`,
    app: `<script>\nexport default {\n  onLaunch() {}\n}\n</script>\n\n<style>\npage { background: #ffffff; }\n</style>\n`,
    main,
    page: `<template>\n  <view><text>{{ status }}</text></view>\n</template>\n\n<script>\nimport { runOpenIMCompileProbe } from '@/sdk-probe.uts'\n\nexport default {\n  data() {\n    return { status: 'ready' }\n  },\n  mounted() {\n    runOpenIMCompileProbe().then((value) => {\n      this.status = value\n    })\n  }\n}\n</script>\n`,
    probe: `import {\n  OpenIMPlatformAndroid,\n  OpenIMPlatformIOS,\n  initSDK,\n  getLoginStatus,\n  createTextMessage,\n  onConnectSuccess,\n  off\n} from '@/uni_modules/unix-openim-sdk'\n\nexport function runOpenIMCompileProbe(): Promise<string> {\n  const subscription = onConnectSuccess(() => {})\n  off(subscription)\n  return getLoginStatus().then((loginStatus) => {\n    return createTextMessage('compile probe').then((message) => {\n      return [\n        OpenIMPlatformAndroid.toString(),\n        OpenIMPlatformIOS.toString(),\n        typeof initSDK,\n        loginStatus.toString(),\n        (message == null).toString()\n      ].join(':')\n    })\n  })\n}\n`,
  }
}

export function removedTraditionalUniAppExportFixture(source: string): string {
  const removedName = ['off', 'Event'].join('')
  assert(source.includes('  off\n'), 'Traditional uni-app fixture does not import off')
  assert(source.includes('  off(subscription)'), 'Traditional uni-app fixture does not call off')
  return source
    .replace('  off\n', `  ${removedName}\n`)
    .replace('  off(subscription)', `  ${removedName}(subscription)`)
}

export function verifyTraditionalUniAppImports(source: string, interfaceSource: string): void {
  const importBody = /import\s*\{([\s\S]*?)\}\s*from\s*['"]@\/uni_modules\/unix-openim-sdk['"]/.exec(source)?.[1]
  assert(importBody != null, 'Traditional uni-app probe does not import the Public plugin root')
  const imports = importBody.split(',').map((name) => name.trim()).filter(Boolean)
  const exports = new Set(
    [...interfaceSource.matchAll(/export\s+(?:declare\s+)?(?:const|function|type|class)\s+([A-Za-z_][A-Za-z0-9_]*)/g)]
      .map((match) => match[1]),
  )
  for (const name of imports) assert(exports.has(name), `Traditional uni-app probe imports missing Public export: ${name}`)
}

function writeFixture(root: string, vueVersion: VueVersion, pluginRoot: string): void {
  const fixture = traditionalUniAppFixtureFiles(vueVersion)
  mkdirSync(join(root, 'pages/index'), { recursive: true })
  mkdirSync(join(root, 'uni_modules'), { recursive: true })
  writeFileSync(join(root, 'manifest.json'), fixture.manifest)
  writeFileSync(join(root, 'pages.json'), fixture.pages)
  writeFileSync(join(root, 'App.vue'), fixture.app)
  writeFileSync(join(root, 'main.js'), fixture.main)
  writeFileSync(join(root, 'sdk-probe.uts'), fixture.probe)
  writeFileSync(join(root, 'pages/index/index.vue'), fixture.page)
  cpSync(pluginRoot, join(root, 'uni_modules/unix-openim-sdk'), { recursive: true })
}

async function compileTraditionalProject(
  projectRoot: string,
  platform: Platform,
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
    assert(!result.timedOut, `${platform} traditional uni-app consumer compile timed out`)
    assert(result.status === 0, `${platform} traditional uni-app consumer compile exited ${String(result.status)}`)
    assert(!hasFailure(log), `${platform} traditional uni-app consumer compile reported a failure`)
    assert(/项目\s+.+编译成功/.test(log), `${platform} traditional uni-app consumer success marker is missing`)
    return log
  } finally {
    try {
      execFileSync(cliPath, ['project', 'close', '--path', projectRoot], { timeout: 15_000 })
    } catch {
      // The temporary fixture is removed below even if HBuilderX already closed it.
    }
  }
}

export async function verifyTraditionalUniAppConsumerCompile(root: string, platform: Platform): Promise<void> {
  const pluginRoot = join(root, 'uni_modules/unix-openim-sdk')
  const interfaceSource = readFileSync(join(pluginRoot, 'utssdk/interface.uts'), 'utf8')
  for (const vueVersion of ['2', '3'] as const) {
    const fixtureRoot = mkdtempSync(join(tmpdir(), `openim-uniapp-vue${vueVersion}-${platform}-`))
    try {
      writeFixture(fixtureRoot, vueVersion, pluginRoot)
      const probePath = join(fixtureRoot, 'sdk-probe.uts')
      const probeSource = readFileSync(probePath, 'utf8')
      verifyTraditionalUniAppImports(probeSource, interfaceSource)
      await withLocalNativeProfile(
        fixtureRoot,
        platform,
        () => compileTraditionalProject(fixtureRoot, platform, root),
      )

      const negativeProbe = removedTraditionalUniAppExportFixture(probeSource)
      let negativeFailure = ''
      try {
        verifyTraditionalUniAppImports(negativeProbe, interfaceSource)
      } catch (error) {
        negativeFailure = error instanceof Error ? error.message : String(error)
      }
      const removedName = ['off', 'Event'].join('')
      assert(negativeFailure.includes(removedName), `${platform} removed-export contract canary did not reject the retired export`)
      const evidenceRoot = join(root, 'test-results/consumer')
      mkdirSync(evidenceRoot, { recursive: true })
      writeFileSync(
        join(evidenceRoot, `uniapp-vue${vueVersion}-${platform}-removed-export.log`),
        `${negativeFailure}\n`,
      )
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true })
    }
  }
}
