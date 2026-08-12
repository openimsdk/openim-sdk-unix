import assert from 'node:assert/strict'
import test from 'node:test'
import {
  removedTraditionalUniAppExportFixture,
  traditionalUniAppFixtureFiles,
  verifyTraditionalUniAppImports,
} from '../src/uniapp-consumer-compile.js'

for (const vueVersion of ['2', '3'] as const) {
  test(`traditional uni-app Vue ${vueVersion} fixture has the expected project and plugin seams`, () => {
    const fixture = traditionalUniAppFixtureFiles(vueVersion)
    const manifest = JSON.parse(fixture.manifest)
    assert.equal(manifest.vueVersion, vueVersion)
    assert.equal(manifest['app-android'].minSdkVersion, 21)
    assert.equal(manifest['app-ios'].deploymentTarget, '14.0')
    assert.match(fixture.page, /runOpenIMCompileProbe/)
    assert.match(fixture.probe, /OpenIMPlatformAndroid/)
    assert.match(fixture.probe, /OpenIMPlatformIOS/)
    assert.match(fixture.probe, /initSDK/)
    assert.match(fixture.probe, /getLoginStatus/)
    assert.match(fixture.probe, /createTextMessage/)
    assert.match(fixture.probe, /onConnectSuccess/)
    assert.match(fixture.probe, /off\(subscription\)/)
    if (vueVersion === '2') assert.match(fixture.main, /new Vue/)
    else assert.match(fixture.main, /createSSRApp/)
  })
}

test('traditional uni-app removed-export fixture is a sensitive negative canary', () => {
  const source = traditionalUniAppFixtureFiles('3').probe
  const exported = source.replace("from '@/uni_modules/unix-openim-sdk'", '')
    .replace(/^\s{2}([A-Za-z][A-Za-z0-9]*),?$/gm, 'export declare function $1(): void')
  assert.doesNotThrow(() => verifyTraditionalUniAppImports(source, exported))
  const removed = removedTraditionalUniAppExportFixture(source)
  assert.doesNotMatch(removed, /\boff\(subscription\)/)
  assert.match(removed, /offEvent/)
  assert.throws(() => verifyTraditionalUniAppImports(removed, exported), /offEvent/)
})
