import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { cleanupLocalRun, listLocalRuns, localMatrixCells, LocalRuntimeLock, prepareStableProject, resolveProductDescriptor } from '../src/local-runtime-matrix.js'
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
  const av = readFileSync(join(root, 'openim-av-runtime/build.gradle'), 'utf8')
  assert.match(settings, /include ':unix-openim-sdk'/)
  assert.match(settings, /include ':openim-av-runtime'/)
  assert.match(app, /minSdk 24/)
  assert.match(app, /abiFilters 'arm64-v8a'/)
  assert.match(app, /implementation project\(':openim-av-runtime'\)/)
  assert.match(app, /example\.VideoComponent/)
  assert.match(av, /namespace 'uts\.sdk\.modules\.openimAvRuntime'/)
  assert.match(av, /implementation project\(':unix-openim-sdk'\)/)
})
