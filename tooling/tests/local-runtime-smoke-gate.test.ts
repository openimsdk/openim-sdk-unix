import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

const root = resolve(import.meta.dirname, '../..')

function writeBMP(path: string, paint: (bytes: Buffer, offset: number, width: number, height: number) => void): void {
  const width = 40
  const height = 40
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
  bytes.fill(32, offset + width * 8 * 4, offset + width * 32 * 4)
  paint(bytes, offset, width, height)
  writeFileSync(path, bytes)
}

test('runtime-ready log gate rejects splash, HBuilder Hello, loading, and a marker for another product', () => {
  const checker = resolve(root, 'local-runtime/hosts/verify-runtime-ready.mjs')
  const marker = 'OPENIM_LOCAL_RUNTIME_READY:v1:im-av:uniapp-vue3'
  const fixtures = [
    '[DCloud] HBuilder splash\nloading spinner\n',
    'HBuilder Hello\nHello HBuilder\n',
    '[openim-local] loading product resources\n',
    'OPENIM_LOCAL_RUNTIME_READY:v1:private:uniapp-vue3\n',
  ]
  for (const fixture of fixtures) {
    const result = spawnSync(process.execPath, [checker, '--marker', marker], { input: fixture, encoding: 'utf8' })
    assert.notEqual(result.status, 0, fixture)
    assert.match(result.stderr, /product-ready marker is missing/)
  }

  const accepted = spawnSync(process.execPath, [checker, '--marker', marker], {
    input: `[console] ${marker}\n`,
    encoding: 'utf8',
  })
  assert.equal(accepted.status, 0)
  assert.match(accepted.stdout, /product-ready marker verified/)
})

test('staging-only marker injector supports classic and uni-app x without touching product SDK files', () => {
  const injector = resolve(root, 'local-runtime/hosts/inject-runtime-ready-marker.mjs')
  const temporary = mkdtempSync(join(tmpdir(), 'openim-runtime-marker-'))
  const classic = join(temporary, 'classic')
  const uniappx = join(temporary, 'uniappx')
  mkdirSync(classic)
  mkdirSync(uniappx)
  writeFileSync(join(classic, 'main.js'), "import App from './App'\nexport default App\n")
  writeFileSync(join(uniappx, 'main.uts'), "import App from './App.uvue'\nexport default App\n")

  execFileSync(process.execPath, [injector, classic, 'private', 'uniapp-vue2'])
  execFileSync(process.execPath, [injector, uniappx, 'im-av', 'uniappx'])
  execFileSync(process.execPath, [injector, classic, 'private', 'uniapp-vue2'])

  const classicSource = readFileSync(join(classic, 'main.js'), 'utf8')
  const uniappxSource = readFileSync(join(uniappx, 'main.uts'), 'utf8')
  assert.equal(classicSource.match(/OPENIM_LOCAL_RUNTIME_READY/g)?.length, 1)
  assert.match(classicSource, /OPENIM_LOCAL_RUNTIME_READY:v1:private:uniapp-vue2/)
  assert.equal(uniappxSource.match(/OPENIM_LOCAL_RUNTIME_READY/g)?.length, 1)
  assert.match(uniappxSource, /OPENIM_LOCAL_RUNTIME_READY:v1:im-av:uniappx/)
  assert.equal(readFileSync(join(classic, 'main.js'), 'utf8').includes('token'), false)
})

test('two-frame stability gate accepts a settled page and rejects a page transition', () => {
  const checker = resolve(root, 'local-runtime/hosts/verify-stable-bmp.mjs')
  const temporary = mkdtempSync(join(tmpdir(), 'openim-runtime-stable-'))
  const settledA = join(temporary, 'settled-a.bmp')
  const settledB = join(temporary, 'settled-b.bmp')
  const transition = join(temporary, 'transition.bmp')
  writeBMP(settledA, () => {})
  writeBMP(settledB, (bytes, offset, width) => {
    bytes.fill(40, offset + (20 * width + 20) * 4, offset + (20 * width + 21) * 4)
  })
  writeBMP(transition, (bytes, offset, width) => {
    bytes.fill(230, offset + width * 8 * 4, offset + width * 32 * 4)
  })

  assert.match(execFileSync(process.execPath, [checker, settledA, settledB], { encoding: 'utf8' }), /stable frame verified/)
  const rejected = spawnSync(process.execPath, [checker, settledA, transition], { encoding: 'utf8' })
  assert.notEqual(rejected.status, 0)
  assert.match(rejected.stderr, /frames are not stable/)
})

test('Android and iOS runtime smoke require the exact staged marker and two stable product frames', () => {
  const android = readFileSync(resolve(root, 'local-runtime/hosts/run-android.sh'), 'utf8')
  const ios = readFileSync(resolve(root, 'local-runtime/hosts/run-ios.sh'), 'utf8')
  const buildAndroid = readFileSync(resolve(root, 'local-runtime/hosts/build-android.sh'), 'utf8')
  const buildIOS = readFileSync(resolve(root, 'local-runtime/hosts/build-ios.sh'), 'utf8')

  for (const source of [android, ios]) {
    assert.match(source, /OPENIM_LOCAL_RUNTIME_READY:v1:/)
    assert.match(source, /verify-runtime-ready\.mjs/)
    assert.match(source, /verify-stable-bmp\.mjs/)
    assert.match(source, /product-launch\.previous\.bmp/)
    assert.match(source, /product-ready marker was not observed/)
  }
  assert.match(android, /logcat -c/)
  assert.match(android, /logcat -d/)
  assert.match(ios, /simctl launch --stdout=/)
  assert.match(ios, /simctl launch --stdout=.*--stderr=/)
  assert.match(ios, /mktemp -d/)
  assert.match(buildAndroid, /inject-runtime-ready-marker\.mjs/)
  assert.match(buildIOS, /inject-runtime-ready-marker\.mjs/)
})
