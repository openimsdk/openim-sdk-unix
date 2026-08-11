import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  harmonyContractMethodBindings,
  harmonyTypedMethods,
  renderHarmonyDriverBindings,
} from '../src/harmony-bindings.js'

function writeLockedHarmonyFixture(privateRoot: string): void {
  const packageRoot = join(privateRoot, 'har-staging/package')
  const declarations = [
    '  realMethod(params: RealReq, operationID?: string): Promise<RealResp>;',
    '  unsupportedMethod(params: UnsupportedReq, operationID?: string): Promise<UnsupportedResp>;',
  ]
  for (let index = 0; index < 3; index += 1) {
    declarations.push(`  filler${String(index).padStart(3, '0')}(operationID?: string): Promise<OpenIMSDKEmptyPayload>;`)
  }
  mkdirSync(join(packageRoot, 'src/main/ets'), { recursive: true })
  writeFileSync(
    join(packageRoot, 'src/main/ets/sdk-types.d.ets'),
    `export interface OpenIMSDK {\n${declarations.join('\n')}\n}\n`,
  )
  writeFileSync(join(packageRoot, 'oh-package.json5'), '{"version":"3.9.0-test"}\n')
  const harDir = join(privateRoot, 'uni_modules/unix-openim-sdk/utssdk/app-harmony/libs')
  mkdirSync(harDir, { recursive: true })
  execFileSync('tar', ['-czf', join(harDir, 'imsdk.har'), '-C', join(privateRoot, 'har-staging'), 'package'])

  const contractRoot = join(privateRoot, 'contracts')
  mkdirSync(join(contractRoot, 'base'), { recursive: true })
  mkdirSync(join(contractRoot, 'enterprise'), { recursive: true })
  mkdirSync(join(contractRoot, 'enterprise/native-abi'), { recursive: true })
  writeFileSync(join(contractRoot, 'base/contract.json'), JSON.stringify({
    callables: [
      { id: 1, name: 'realMethod', role: 'operation', binding: { harmony: { kind: 'native' } } },
      { id: 2, name: 'unsupportedMethod', role: 'operation', binding: { harmony: { kind: 'unsupported' } } },
    ],
  }))
  writeFileSync(join(contractRoot, 'enterprise/delta.json'), JSON.stringify({ callables: [] }))
  writeFileSync(join(contractRoot, 'enterprise/native-abi/harmony.json'), JSON.stringify({ responseEncoders: {} }))

  const driverRoot = join(privateRoot, 'sdk-src/native/harmony')
  mkdirSync(driverRoot, { recursive: true })
  writeFileSync(join(driverRoot, 'OpenIMHarmonyDriver.ets'), `import harmonySDK from '@openimsdk/imsdk'
// <openim-generated-harmony-imports>
// </openim-generated-harmony-imports>
export class OpenIMHarmonyDriver {
  // <openim-generated-harmony-operations>
  // </openim-generated-harmony-operations>
}
`)
}

test('locked Licensed HAR methods are filtered by contract capability bindings', () => {
  const privateRoot = mkdtempSync(join(tmpdir(), 'openim-harmony-bindings-'))
  try {
    writeLockedHarmonyFixture(privateRoot)
    assert.equal(harmonyTypedMethods(privateRoot).length, 5)
    assert.deepEqual(harmonyContractMethodBindings(privateRoot), [
      { callableID: 1, callableName: 'realMethod', methodName: 'realMethod' },
    ])
    const source = renderHarmonyDriverBindings(privateRoot)
    assert.match(source, /callBindingRealMethod/)
    assert.match(source, /RealReq/)
    assert.match(source, /RealResp/)
    assert.doesNotMatch(source, /callBindingUnsupportedMethod/)
    assert.doesNotMatch(source, /UnsupportedReq/)
    assert.doesNotMatch(source, /UnsupportedResp/)
    assert.doesNotMatch(source, /callBindingFiller/)
  } finally {
    rmSync(privateRoot, { recursive: true, force: true })
  }
})
